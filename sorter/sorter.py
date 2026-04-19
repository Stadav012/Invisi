"""Invisi optical bean sorter — classifies cocoa beans via ResNet50/MobileNet INT8."""

import json
import logging
import os
import signal
import sys
import time

import cv2
import numpy as np
import onnxruntime as ort
import redis
import requests
import serial
from gpiozero import AngularServo
from picamera2 import Picamera2

_LOG_LEVEL = logging.DEBUG if os.getenv("VERBOSE", "0") == "1" else logging.INFO
logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("invisi.sorter")

# ---------------------------------------------------------------------------
# Configuration — all tunables are env-configurable
# ---------------------------------------------------------------------------

MODEL_PATH = os.getenv("MODEL_PATH", "/home/invisi/Desktop/invisi_models/Trained_MobileNetV3_INT8.onnx")
SERVO_PIN = int(os.getenv("SERVO_PIN", "18"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
POD_ID = os.getenv("POD_ID", "pod_01")

# --- Contour / bean detection ---
MIN_CONTOUR_AREA = int(os.getenv("MIN_CONTOUR_AREA", "1500"))
MAX_CONTOUR_AREA = int(os.getenv("MAX_CONTOUR_AREA", "80000"))
MIN_SOLIDITY = float(os.getenv("MIN_SOLIDITY", "0.5"))
MIN_ASPECT_RATIO = 0.3
MAX_ASPECT_RATIO = 3.5
EDGE_MARGIN_PX = 25
BEAN_PAD_PX = 15
ADAPTIVE_BLOCK_SIZE = int(os.getenv("ADAPTIVE_BLOCK_SIZE", "51"))
ADAPTIVE_C = int(os.getenv("ADAPTIVE_C", "10"))

# --- Color-based bean segmentation (HSV) ---
# Saturation is the primary discriminator:
#   white/grey cloth  → S ≈ 0–20   (nearly colourless)
#   dark threads      → V ≈ 0–50   (very dark regardless of S)
#   tan/brown bean    → S ≥ 30+    (visibly coloured, even if bright)
BEAN_SAT_MIN = int(os.getenv("BEAN_SAT_MIN", "30"))     # min S; raise if cloth bleeds through
BEAN_VAL_MIN = int(os.getenv("BEAN_VAL_MIN", "40"))     # min V; exclude dark threads / shadows
# Two-stage morphology:
#   OPEN  — erodes then dilates; kills small speckle noise from cloth texture
#   CLOSE — dilates then erodes; fills wrinkle lines and dark blemish holes inside the bean
MORPH_OPEN_SIZE  = int(os.getenv("MORPH_OPEN_SIZE",  "7"))   # remove cloth speckle (≤ kernel px)
MORPH_CLOSE_SIZE = int(os.getenv("MORPH_CLOSE_SIZE", "31"))  # fill bean interior gaps

# --- Debug window ---
DEBUG_WINDOW = os.getenv("DEBUG_WINDOW", "0") == "1"

# --- Brightness validation ---
MIN_BRIGHTNESS = int(os.getenv("MIN_BRIGHTNESS", "30"))

# --- Timing ---
CONVEYOR_BELT_DELAY_S = float(os.getenv("CONVEYOR_BELT_DELAY_S", "0.25"))
SORT_CLEARANCE_DELAY_S = float(os.getenv("SORT_CLEARANCE_DELAY_S", "0.5"))
# Time from classification (bean under camera) to gate actuation.
# Distance_between_camera_and_gate / belt_speed.
# At ~9cm camera-to-gate distance, 0.65s leaves 0.25s (CONVEYOR_BELT_DELAY_S) for the bean to clear.
CAMERA_TO_GATE_DELAY_S = float(os.getenv("CAMERA_TO_GATE_DELAY_S", "0.65"))
MIN_SORT_GAP_S = float(os.getenv("MIN_SORT_GAP_S", "0.3"))
BUFFER_FLUSH_FRAMES = 5
IDLE_SLEEP_S = 0.01

# --- Servo angles ---
SERVO_NEUTRAL = float(os.getenv("SERVO_NEUTRAL", "0"))
SERVO_GOOD = float(os.getenv("SERVO_GOOD", "180"))
SERVO_POOR = float(os.getenv("SERVO_POOR", "-180"))

# --- Classification ---
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.65"))
# Model convention (matches original working script): 0 = POOR BEAN, 1 = GOOD BEAN
LABELS = {0: "POOR BEAN", 1: "GOOD BEAN"}

# --- Smart sort algorithm ---
VOTES_REQUIRED = int(os.getenv("VOTES_REQUIRED", "1"))
VOTE_WINDOW_S = float(os.getenv("VOTE_WINDOW_S", "2.0"))
MAX_CONSECUTIVE_POOR = int(os.getenv("MAX_CONSECUTIVE_POOR", "5"))  # unused, kept for config compat
DRIFT_WINDOW = int(os.getenv("DRIFT_WINDOW", "30"))
DRIFT_POOR_RATIO = float(os.getenv("DRIFT_POOR_RATIO", "0.9"))
CENTROID_JUMP_PX = float(os.getenv("CENTROID_JUMP_PX", "50"))

# --- Camera ---
CAMERA_WARMUP_FRAMES = 15

# --- Tripwire zone (Y pixel range) ---
TRIPWIRE_Y_MIN = int(os.getenv("TRIPWIRE_Y_MIN", "120"))
TRIPWIRE_Y_MAX = int(os.getenv("TRIPWIRE_Y_MAX", "380"))

# --- Belt serial control ---
BELT_SERIAL_PORT = os.getenv("BELT_SERIAL_PORT", "/dev/ttyACM0")
BELT_BAUD_RATE = int(os.getenv("BELT_BAUD_RATE", "115200"))
BELT_SETTLE_S = float(os.getenv("BELT_SETTLE_S", "0.3"))

# --- Batch refresh ---
BATCH_REFRESH_INTERVAL_S = 60

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406])
IMAGENET_STD = np.array([0.229, 0.224, 0.225])
HEADLESS_MODE = os.getenv("HEADLESS_MODE", "0") == "1"

# Shutdown flag set by SIGTERM handler
_shutdown_requested = False


def _handle_sigterm(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info("SIGTERM received, shutting down gracefully")


signal.signal(signal.SIGTERM, _handle_sigterm)

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------


def init_redis():
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.ping()
        logger.info("Redis connected")
        return r
    except Exception as e:
        logger.warning(f"Redis unavailable, sorting will continue without logging: {e}")
        return None


def log_sorting_result(r, prediction, confidence, inference_ms, batch_id, votes_used):
    """Buffer sorting result in Redis. Silently skips if Redis is unavailable."""
    if r is None:
        return

    ts = int(time.time())
    entry = {
        "ts": ts,
        "batch_id": batch_id,
        "prediction": int(prediction),
        "label": LABELS[int(prediction)],
        "confidence": round(float(confidence), 4),
        "inference_ms": round(inference_ms, 1),
        "votes": votes_used,
    }

    try:
        key = f"{POD_ID}_sorting"
        r.zadd(key, {json.dumps(entry): ts})
        cutoff = ts - (72 * 3600)
        r.zremrangebyscore(key, "-inf", cutoff)
    except Exception as e:
        logger.warning(f"Redis write failed (sort still executed): {e}")


def fetch_active_batch_id():
    """Fetch the currently fermenting batch ID from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    url = f"{SUPABASE_URL}/rest/v1/batches?status=eq.fermenting&order=created_at.desc&limit=1&select=id"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        if data:
            return data[0]["id"]
    except Exception as e:
        logger.warning(f"Failed to fetch batch: {e}")

    return None


def init_hardware():
    """Initialize servo and AI model."""
    if not os.path.exists(MODEL_PATH):
        logger.error(f"Model file not found: {MODEL_PATH}")
        sys.exit(1)

    logger.info("Initializing hardware")
    gate = AngularServo(SERVO_PIN, min_angle=-180, max_angle=180)
    gate.angle = SERVO_NEUTRAL

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 2

    logger.info("Loading AI model")
    session = ort.InferenceSession(
        MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name

    return gate, session, input_name


# ---------------------------------------------------------------------------
# Belt control
# ---------------------------------------------------------------------------


class BeltController:
    """Serial interface to the Arduino conveyor motor."""

    def __init__(self):
        self.conn = None
        try:
            self.conn = serial.Serial(BELT_SERIAL_PORT, BELT_BAUD_RATE, timeout=3)
            time.sleep(2.5)  # Arduino resets on serial connect; wait for it to boot
            # Drain the full startup buffer — Arduino may send multiple lines before READY
            startup = ""
            while self.conn.in_waiting:
                startup = self.conn.readline().decode().strip()
            if not startup:
                # in_waiting was 0 but Arduino might just be slow; try one blocking read
                startup = self.conn.readline().decode().strip()
            logger.info(f"Belt connected: {startup}")
        except Exception as e:
            logger.warning(f"Belt serial unavailable ({BELT_SERIAL_PORT}): {e}")
            logger.warning("Running in camera-only mode (no belt control)")

    @property
    def available(self):
        return self.conn is not None

    def _send(self, cmd):
        if not self.available:
            return
        try:
            self.conn.reset_input_buffer()  # discard any stale bytes before reading response
            self.conn.write(cmd.encode())
            resp = self.conn.readline().decode().strip()
            if resp != "OK":
                logger.warning(f"Belt unexpected response to '{cmd}': {resp}")
        except Exception as e:
            logger.warning(f"Belt serial error: {e}")

    def forward(self):
        self._send("F")

    def stop(self):
        self._send("S")

    def nudge(self):
        """Short pulse at full duty, then auto-stops. Belt moves ~1-2 cm."""
        self._send("N")

    def clearance_pulse(self):
        """Short forward pulse to push bean past the gate, then auto-stops."""
        self._send("C")


# ---------------------------------------------------------------------------
# Vision pipeline
# ---------------------------------------------------------------------------


def softmax(logits):
    """Convert raw model logits to proper [0,1] probabilities."""
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()


def frame_brightness(frame):
    """Mean brightness of a frame (0-255). Used for low-light detection."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    return float(np.mean(gray))


def is_bean_contour(contour, frame_w, frame_h):
    """Reject shadows, belt edges, machinery, and noise."""
    area = cv2.contourArea(contour)
    if area < MIN_CONTOUR_AREA or area > MAX_CONTOUR_AREA:
        return False

    x, y, w, h = cv2.boundingRect(contour)

    if (x <= EDGE_MARGIN_PX or y <= EDGE_MARGIN_PX
            or (x + w) >= (frame_w - EDGE_MARGIN_PX)
            or (y + h) >= (frame_h - EDGE_MARGIN_PX)):
        return False

    aspect = w / h if h > 0 else 0
    if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
        return False

    hull_area = cv2.contourArea(cv2.convexHull(contour))
    solidity = area / hull_area if hull_area > 0 else 0
    if solidity < MIN_SOLIDITY:
        return False

    return True


def _build_bean_fg_mask(frame_rgb):
    """
    Saturation-primary HSV mask with two-stage morphology.

    Stage 1 — OPEN (erode→dilate):
        Kills small speckle noise from cloth weave / lighting gradients.
        Any white region smaller than MORPH_OPEN_SIZE is removed.

    Stage 2 — CLOSE (dilate→erode):
        Fills wrinkle lines and dark blemish holes inside the bean blob so
        the bean appears as one solid filled region for contour detection.
    """
    bgr = cv2.cvtColor(frame_rgb[:, :, :3], cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    raw = np.uint8((s >= BEAN_SAT_MIN) & (v >= BEAN_VAL_MIN)) * 255

    open_k = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (MORPH_OPEN_SIZE, MORPH_OPEN_SIZE)
    )
    opened = cv2.morphologyEx(raw, cv2.MORPH_OPEN, open_k)

    close_k = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (MORPH_CLOSE_SIZE, MORPH_CLOSE_SIZE)
    )
    return cv2.morphologyEx(opened, cv2.MORPH_CLOSE, close_k)


def _find_bean_contours(blurred, frame_w, frame_h):
    """
    Detection — Otsu primary (mirrors original working script), adaptive fallback.
    HSV colour mask is NOT used for detection; it exists only for debug visualisation.

    Two-tier contour selection per threshold pass:
      Tier 1 — shape-filtered (solidity, aspect ratio, edge margin): rejects noise for
               normal beans under good lighting.
      Tier 2 — largest-blob fallback (area only, no shape checks): mirrors the original
               script and catches dark/damaged/irregular beans that fail shape filters.

    Returns (contours, source).
    """
    for thresh_img, source in _threshold_candidates(blurred):
        contours, _ = cv2.findContours(thresh_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Tier 1: full shape filter (solidity, aspect ratio, edge margin, area bounds)
        shaped = [c for c in contours if is_bean_contour(c, frame_w, frame_h)]
        if shaped:
            return shaped, source

        # Tier 2: relaxed filter — area bounds only, plus a frame-coverage guard.
        # Skips solidity/edge-margin so dark/damaged beans at frame edges are caught.
        # The frame-coverage check prevents the belt cloth itself from being returned
        # as a bean when there is nothing on the belt (a full-frame contour is background).
        for c in sorted(contours, key=cv2.contourArea, reverse=True):
            area = cv2.contourArea(c)
            if area < MIN_CONTOUR_AREA:
                break  # sorted descending; nothing larger coming
            if area > MAX_CONTOUR_AREA:
                continue
            x, y, w, h = cv2.boundingRect(c)
            if w > frame_w * 0.75 or h > frame_h * 0.75:
                continue  # contour spans most of the frame = cloth background, not a bean
            return [c], f"{source}-raw"

    return [], "none"


def _threshold_candidates(blurred):
    """Yield (binary_mask, label) pairs in detection priority order."""
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    yield otsu, "otsu"

    adaptive = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, ADAPTIVE_BLOCK_SIZE, ADAPTIVE_C,
    )
    yield adaptive, "adaptive"


def _show_debug_window(frame_rgb, fg_mask, bean_contours, detection_source):
    """
    Three-panel debug window:
      LEFT   — HSV colour mask with detected contours
      CENTRE — live camera frame with contours + tripwire
      RIGHT  — exactly what the model receives (masked crop, background = grey)
    """
    frame_h, frame_w = frame_rgb.shape[:2]

    # --- Left: colour mask ---
    mask_bgr = cv2.cvtColor(fg_mask, cv2.COLOR_GRAY2BGR)
    cv2.drawContours(mask_bgr, bean_contours, -1, (0, 255, 0), 2)
    cv2.line(mask_bgr, (0, TRIPWIRE_Y_MIN), (frame_w, TRIPWIRE_Y_MIN), (0, 255, 255), 1)
    cv2.line(mask_bgr, (0, TRIPWIRE_Y_MAX), (frame_w, TRIPWIRE_Y_MAX), (0, 255, 255), 1)
    cv2.putText(mask_bgr, "COLOR MASK", (8, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
    cv2.putText(mask_bgr,
                f"SAT>={BEAN_SAT_MIN} VAL>={BEAN_VAL_MIN} O={MORPH_OPEN_SIZE} C={MORPH_CLOSE_SIZE}",
                (8, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 0), 1)

    # --- Centre: live camera ---
    cam_bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    cv2.drawContours(cam_bgr, bean_contours, -1, (0, 255, 0), 2)
    cv2.line(cam_bgr, (0, TRIPWIRE_Y_MIN), (frame_w, TRIPWIRE_Y_MIN), (0, 255, 255), 1)
    cv2.line(cam_bgr, (0, TRIPWIRE_Y_MAX), (frame_w, TRIPWIRE_Y_MAX), (0, 255, 255), 1)
    found_label = f"BEAN FOUND [{detection_source}]" if bean_contours else "NO BEAN"
    label_color = (0, 255, 0) if bean_contours else (0, 0, 255)
    cv2.putText(cam_bgr, found_label, (8, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, label_color, 2)
    cv2.putText(cam_bgr, "CAMERA", (8, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 0), 1)

    # --- Right: model input (last masked crop, scaled to frame height) ---
    if _last_model_crop_rgb is not None:
        model_view = cv2.cvtColor(_last_model_crop_rgb, cv2.COLOR_RGB2BGR)
        model_view = cv2.resize(model_view, (frame_w, frame_h))
    else:
        model_view = np.zeros((frame_h, frame_w, 3), dtype=np.uint8)
    cv2.putText(model_view, "MODEL INPUT", (8, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
    cv2.putText(model_view, "bg=imagenet grey", (8, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 0), 1)

    debug = np.hstack([mask_bgr, cam_bgr, model_view])

    max_w = 1400
    if debug.shape[1] > max_w:
        scale = max_w / debug.shape[1]
        debug = cv2.resize(debug, (max_w, int(debug.shape[0] * scale)))

    cv2.imshow("Invisi Debug", debug)


def find_bean(frame):
    """Detect the best bean-shaped contour. Returns (bbox, centroid) or (None, None)."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    frame_h, frame_w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    bean_contours, detection_source = _find_bean_contours(blurred, frame_w, frame_h)

    if DEBUG_WINDOW and not HEADLESS_MODE:
        # HSV mask is built here only for the debug visualisation panel — not used for detection.
        fg_mask = _build_bean_fg_mask(frame)
        _show_debug_window(frame, fg_mask, bean_contours, detection_source)

    if not bean_contours:
        return None, None

    best = max(bean_contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(best)
    pad = BEAN_PAD_PX
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(frame_w, x + w + pad)
    y2 = min(frame_h, y + h + pad)

    centroid = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
    return (x1, y1, x2, y2), centroid


# Last masked crop sent to the model — written by preprocess_roi, read by debug window.
_last_model_crop_rgb: np.ndarray | None = None


def preprocess_roi(frame, bbox):
    """Crop bbox and prepare the model input tensor (matches original working script)."""
    global _last_model_crop_rgb

    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    x1, y1, x2, y2 = bbox
    cropped = frame[y1:y2, x1:x2]

    resized = cv2.resize(cropped, (224, 224))
    _last_model_crop_rgb = resized.copy()

    img = resized.astype(np.float32) / 255.0
    img = (img - IMAGENET_MEAN) / IMAGENET_STD
    img = np.transpose(img, (2, 0, 1))
    return np.expand_dims(img, axis=0).astype(np.float32)


# ---------------------------------------------------------------------------
# Sort controller — stateful decision engine
# ---------------------------------------------------------------------------


def _centroid_distance(a, b):
    if a is None or b is None:
        return float("inf")
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


class SortController:
    """Multi-frame voting, centroid tracking, drift detection."""

    def __init__(self):
        self.votes = []
        self.vote_times_ms = []
        self.vote_start = 0.0
        self.vote_centroid = None

        self.last_sort_time = 0.0
        self.last_sorted_centroid = None
        self.consecutive_poor = 0
        self.drift_warning = False
        self.low_light = False
        self.recent_results = []

        self.stats = {
            "good": 0, "poor": 0, "rejected": 0,
            "missed": 0,
        }

    def is_same_bean(self, centroid):
        """Check if centroid belongs to the same bean we're currently tracking."""
        if self.vote_centroid is None:
            return True
        return _centroid_distance(centroid, self.vote_centroid) < CENTROID_JUMP_PX

    def is_recently_sorted_bean(self, centroid):
        """Suppress re-classification of a bean we just sorted (centroid-based cooldown)."""
        if time.time() - self.last_sort_time < MIN_SORT_GAP_S:
            return True
        if self.last_sorted_centroid is None:
            return False
        return _centroid_distance(centroid, self.last_sorted_centroid) < CENTROID_JUMP_PX

    @property
    def is_voting(self):
        if not self.votes:
            return False
        return (time.time() - self.vote_start) < VOTE_WINDOW_S

    def add_vote(self, prediction, confidence, inference_ms, centroid):
        """Register one frame's classification. Resets if centroid jumped (new bean)."""
        if self.votes and not self.is_same_bean(centroid):
            self._discard_votes_as_missed()

        if not self.votes:
            self.vote_start = time.time()
        self.votes.append((prediction, confidence))
        self.vote_times_ms.append(inference_ms)
        self.vote_centroid = centroid

    def ready_to_commit(self):
        if len(self.votes) >= VOTES_REQUIRED:
            return True
        if self.votes and (time.time() - self.vote_start) >= VOTE_WINDOW_S:
            return True
        return False

    def commit(self):
        """Tally votes. Returns (prediction, avg_confidence, vote_count, avg_inference_ms) or None."""
        if not self.votes:
            return None

        num_votes = len(self.votes)
        avg_infer = float(np.mean(self.vote_times_ms)) if self.vote_times_ms else 0

        good_votes = [(p, c) for p, c in self.votes if p == 1]
        poor_votes = [(p, c) for p, c in self.votes if p == 0]

        if len(good_votes) > len(poor_votes):
            winner = 1
            avg_conf = np.mean([c for _, c in good_votes])
        elif len(poor_votes) > len(good_votes):
            winner = 0
            avg_conf = np.mean([c for _, c in poor_votes])
        else:
            good_avg = np.mean([c for _, c in good_votes]) if good_votes else 0
            poor_avg = np.mean([c for _, c in poor_votes]) if poor_votes else 0
            winner = 1 if good_avg >= poor_avg else 0
            avg_conf = max(good_avg, poor_avg)

        self._clear_votes()

        if avg_conf < CONFIDENCE_THRESHOLD:
            self.stats["rejected"] += 1
            return None

        return winner, float(avg_conf), num_votes, avg_infer

    def record_sort(self, prediction, centroid):
        """Update state after a bean is physically sorted."""
        self.last_sort_time = time.time()
        self.last_sorted_centroid = centroid

        if prediction == 0:
            self.stats["poor"] += 1
            self.consecutive_poor += 1
        else:
            self.stats["good"] += 1
            self.consecutive_poor = 0

        self.recent_results.append(prediction)
        if len(self.recent_results) > DRIFT_WINDOW:
            self.recent_results.pop(0)

        self._check_drift()

    def discard_if_voting(self):
        """Called when bean leaves tripwire without enough votes."""
        if self.votes:
            self._discard_votes_as_missed()

    def _discard_votes_as_missed(self):
        if self.votes:
            self.stats["missed"] += 1
        self._clear_votes()

    def _clear_votes(self):
        self.votes = []
        self.vote_times_ms = []
        self.vote_centroid = None

    def _check_drift(self):
        if len(self.recent_results) < DRIFT_WINDOW:
            self.drift_warning = False
            return
        poor_ratio = self.recent_results.count(0) / len(self.recent_results)
        self.drift_warning = poor_ratio >= DRIFT_POOR_RATIO

    def resume(self):
        self.consecutive_poor = 0
        self._clear_votes()

    @property
    def status_text(self):
        if self.low_light:
            return "LOW LIGHT - add lighting, classification skipped"
        if self.drift_warning:
            return "WARNING - abnormal poor ratio, check lighting/belt"
        if self.is_voting:
            return f"TRACKING BEAN - {len(self.votes)}/{VOTES_REQUIRED} votes"
        return "EMPTY BELT - waiting"


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------


def _put_bold_text(frame, text, origin, scale, color, thickness=2):
    """Draw text with a dark outline so it's readable on any background."""
    x, y = origin
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thickness + 3)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)


def _draw_stats(display_frame, ctrl):
    s = ctrl.stats
    total = s["good"] + s["poor"]
    line1 = (f"Good: {s['good']}  Poor: {s['poor']}  Total: {total}  "
             f"Rej: {s['rejected']}  Miss: {s['missed']}")
    _put_bold_text(display_frame, line1, (10, 70), 0.55, (255, 255, 255), 2)

    if ctrl.drift_warning:
        _put_bold_text(display_frame, "DRIFT WARNING", (10, 95), 0.55, (0, 165, 255), 2)


def _show_sorted_frame(frame_rgb, bbox, label, confidence, inference_ms, ctrl, votes_used):
    display_frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    x1, y1, x2, y2 = bbox
    color = (0, 0, 255) if "POOR" in label else (0, 255, 0)

    cv2.rectangle(display_frame, (x1, y1), (x2, y2), color, 3)
    _put_bold_text(display_frame, f"{label} {confidence:.0%} [{votes_used}v] ({inference_ms:.0f}ms)",
                   (10, 35), 0.9, color, 3)
    _draw_stats(display_frame, ctrl)

    if not HEADLESS_MODE:
        cv2.imshow("Invisi Vision Test", display_frame)
    else:
        s = ctrl.stats
        logger.info(f"{label} {confidence:.0%} [{votes_used}v] | Good: {s['good']} Poor: {s['poor']}")


def _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl):
    display_frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    frame_w = display_frame.shape[1]

    cv2.line(display_frame, (0, TRIPWIRE_Y_MIN), (frame_w, TRIPWIRE_Y_MIN), (0, 255, 255), 1)
    cv2.line(display_frame, (0, TRIPWIRE_Y_MAX), (frame_w, TRIPWIRE_Y_MAX), (0, 255, 255), 1)

    if bbox is not None:
        x1, y1, x2, y2 = bbox
        box_color = (255, 165, 0) if not on_tripwire else (255, 255, 0)
        cv2.rectangle(display_frame, (x1, y1), (x2, y2), box_color, 2)

    status = ctrl.status_text
    if bbox is not None and not on_tripwire and not ctrl.is_voting:
        status = "BEAN SEEN - not on tripwire yet"

    status_color = (255, 255, 255)
    if ctrl.low_light:
        status_color = (0, 100, 255)
    elif ctrl.drift_warning:
        status_color = (0, 165, 255)

    _put_bold_text(display_frame, status, (10, 35), 0.8, status_color, 2)
    _draw_stats(display_frame, ctrl)

    if not HEADLESS_MODE:
        cv2.imshow("Invisi Vision Test", display_frame)


# ---------------------------------------------------------------------------
# Sort execution
# ---------------------------------------------------------------------------


def _execute_sort(gate, ctrl, result, r, batch_id, frame_rgb, bbox, centroid, picam2, belt):
    """Physically sort the bean: start belt, wait for bean to reach gate, actuate, stop."""
    prediction, confidence, votes_used, avg_inference_ms = result

    log_sorting_result(r, prediction, confidence, avg_inference_ms, batch_id, votes_used)

    # Start belt immediately so the bean begins travelling toward the gate.
    # belt.forward() is non-blocking (Arduino responds 'OK' instantly).
    # belt.clearance_pulse() blocks until the pulse ends, so we can't use it here.
    if belt.available:
        belt.forward()
    
    # Wait for the bean to travel from the camera to the gate.
    # CAMERA_TO_GATE_DELAY_S = physical_distance / belt_speed.
    # For ~9cm at this belt speed, 0.65s is a good starting point.
    time.sleep(CAMERA_TO_GATE_DELAY_S)

    # Gate opens — bean should be arriving now.
    gate.angle = SERVO_POOR if prediction == 0 else SERVO_GOOD
    time.sleep(CONVEYOR_BELT_DELAY_S)  # bean passes through gate

    ctrl.record_sort(prediction, centroid)

    _show_sorted_frame(frame_rgb, bbox, LABELS[prediction], confidence,
                       avg_inference_ms, ctrl, votes_used)

    # Stop belt and close gate.
    if belt.available:
        belt.stop()
    else:
        time.sleep(SORT_CLEARANCE_DELAY_S)

    gate.angle = SERVO_NEUTRAL

    for _ in range(BUFFER_FLUSH_FRAMES):
        picam2.capture_array()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def _init_camera():
    logger.info("Initializing camera")
    picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (640, 480)})
    picam2.configure(config)
    picam2.start()

    # Use continuous macro autofocus — same as the reference script.
    # Auto-exposure and auto-gain are left at camera defaults so the image
    # brightness matches what the model was trained on.
    picam2.set_controls({"AfMode": 2, "AfRange": 2})

    logger.info(f"Discarding {CAMERA_WARMUP_FRAMES} warmup frames")
    for _ in range(CAMERA_WARMUP_FRAMES):
        picam2.capture_array()
    time.sleep(0.5)

    return picam2


def _check_quit():
    """Returns True if user pressed 'q'."""
    if HEADLESS_MODE:
        return False
    return (cv2.waitKey(1) & 0xFF) == ord('q')


def _classify_stationary_bean(session, input_name, picam2, ctrl):
    """Capture multiple frames of a stopped bean and vote. Returns (result, frame, bbox, centroid) or Nones."""
    for _ in range(VOTES_REQUIRED + 2):
        frame_rgb = picam2.capture_array()

        brightness = frame_brightness(frame_rgb)
        if brightness < MIN_BRIGHTNESS:
            continue

        bbox, centroid = find_bean(frame_rgb)
        if bbox is None:
            continue

        input_tensor = preprocess_roi(frame_rgb, bbox)
        t0 = time.time()
        outputs = session.run(None, {input_name: input_tensor})
        inference_ms = (time.time() - t0) * 1000

        probs = softmax(outputs[0][0])
        prediction = int(np.argmax(probs))
        confidence = float(probs[prediction])

        logger.debug(
            f"classify_stationary | raw logits: {outputs[0][0]} | "
            f"p(class0)={probs[0]:.3f} p(class1)={probs[1]:.3f} | "
            f"pred={prediction} ({LABELS[prediction]}) conf={confidence:.3f}"
        )

        if confidence >= CONFIDENCE_THRESHOLD:
            ctrl.add_vote(prediction, confidence, inference_ms, centroid)

        if ctrl.ready_to_commit():
            result = ctrl.commit()
            if result is not None:
                return result, frame_rgb, bbox, centroid
            break

    ctrl.discard_if_voting()
    return None, None, None, None


def run():
    global _shutdown_requested

    gate, session, input_name = init_hardware()
    r = init_redis()
    belt = BeltController()
    batch_id = fetch_active_batch_id()
    last_batch_refresh = time.time()
    picam2 = _init_camera()

    if batch_id:
        logger.info(f"Active batch: {batch_id}")
    else:
        logger.info("No active batch found. Results will be buffered without batch_id.")

    logger.info("System online. Press 'q' to quit.")
    ctrl = SortController()

    try:
        if belt.available:
            _run_belt_mode(gate, session, input_name, r, belt, picam2, ctrl, batch_id, last_batch_refresh)
        else:
            _run_passive_mode(gate, session, input_name, r, picam2, ctrl, batch_id, last_batch_refresh)
    except KeyboardInterrupt:
        logger.info("Shutdown signal received (CTRL+C)")
    finally:
        if belt.available:
            belt.stop()
        gate.angle = SERVO_NEUTRAL
        time.sleep(0.1)
        gate.detach()
        picam2.stop()
        if not HEADLESS_MODE:
            cv2.destroyAllWindows()
        logger.info("Camera released. System shutdown.")


def _run_belt_mode(gate, session, input_name, r, belt, picam2, ctrl, batch_id, last_batch_refresh):
    """Pi-controlled stop-and-go: run belt -> detect bean -> stop -> classify -> sort -> repeat."""
    global _shutdown_requested

    logger.info("Belt mode: Pi controls the conveyor")

    while not _shutdown_requested:
        if _check_quit():
            break

        # --- Refresh batch ID periodically ---
        now = time.time()
        if now - last_batch_refresh > BATCH_REFRESH_INTERVAL_S:
            new_batch = fetch_active_batch_id()
            if new_batch and new_batch != batch_id:
                batch_id = new_batch
                logger.info(f"Batch ID refreshed: {batch_id}")
            last_batch_refresh = now

        # Step 1: Nudge-and-check — pulse belt in short hops, check camera after each
        bean_found = False

        while not _shutdown_requested and not bean_found:
            # Check camera BEFORE nudging (bean may already be in frame)
            frame_rgb = picam2.capture_array()

            brightness = frame_brightness(frame_rgb)
            ctrl.low_light = brightness < MIN_BRIGHTNESS

            bbox, centroid = find_bean(frame_rgb)
            on_tripwire = False
            if bbox is not None and centroid is not None:
                on_tripwire = TRIPWIRE_Y_MIN <= centroid[1] <= TRIPWIRE_Y_MAX

            _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl)

            if bbox is not None and not ctrl.low_light:
                bean_found = True
                break

            if _check_quit():
                return

            # No bean visible — nudge the belt one hop forward, then re-check
            belt.nudge()
            time.sleep(BELT_SETTLE_S)

        if _shutdown_requested:
            break

        # Step 2: Bean visible and belt already stopped (nudge auto-stops)
        time.sleep(BELT_SETTLE_S)

        # Step 3: Classify the stationary bean
        # The bean may have stopped before or on the tripwire — either is fine
        result, frame_rgb, bbox, centroid = _classify_stationary_bean(
            session, input_name, picam2, ctrl)

        if result is not None:
            # Step 4: Sort — gate opens, belt pushes bean through
            _execute_sort(gate, ctrl, result, r, batch_id,
                          frame_rgb, bbox, centroid, picam2, belt)
        else:
            # Bean detected but classification failed — push it through anyway
            logger.info("Classification inconclusive, advancing belt")
            belt.clearance_pulse()

        # Brief pause before next cycle
        time.sleep(0.2)


def _run_passive_mode(gate, session, input_name, r, picam2, ctrl, batch_id, last_batch_refresh):
    """Fallback: no belt control, passively watch a moving belt (original behavior)."""
    global _shutdown_requested

    logger.info("Passive mode: no belt control, watching moving belt")
    dummy_belt = BeltController()  # no-op belt (conn=None)

    while not _shutdown_requested:
        frame_rgb = picam2.capture_array()

        now = time.time()
        if now - last_batch_refresh > BATCH_REFRESH_INTERVAL_S:
            new_batch = fetch_active_batch_id()
            if new_batch and new_batch != batch_id:
                batch_id = new_batch
                logger.info(f"Batch ID refreshed: {batch_id}")
            last_batch_refresh = now

        brightness = frame_brightness(frame_rgb)
        ctrl.low_light = brightness < MIN_BRIGHTNESS
        if ctrl.low_light:
            _show_idle_frame(frame_rgb, None, False, ctrl)
            if _check_quit():
                break
            time.sleep(IDLE_SLEEP_S)
            continue

        bbox, centroid = find_bean(frame_rgb)

        on_tripwire = False
        if bbox is not None and centroid is not None:
            on_tripwire = TRIPWIRE_Y_MIN <= centroid[1] <= TRIPWIRE_Y_MAX

        if ctrl.is_voting and (bbox is None or not on_tripwire):
            if ctrl.ready_to_commit():
                result = ctrl.commit()
                if result is not None:
                    last_bbox = bbox if bbox is not None else (0, 0, 1, 1)
                    last_cent = centroid if centroid is not None else ctrl.vote_centroid
                    _execute_sort(gate, ctrl, result, r, batch_id,
                                  frame_rgb, last_bbox, last_cent, picam2, dummy_belt)
                    continue
                else:
                    ctrl.discard_if_voting()
            else:
                ctrl.discard_if_voting()

        if (bbox is not None and on_tripwire
                and not ctrl.is_recently_sorted_bean(centroid)):

            input_tensor = preprocess_roi(frame_rgb, bbox)
            t0 = time.time()
            outputs = session.run(None, {input_name: input_tensor})
            inference_ms = (time.time() - t0) * 1000

            probs = softmax(outputs[0][0])
            prediction = int(np.argmax(probs))
            confidence = float(probs[prediction])

            logger.debug(
                f"passive | raw logits: {outputs[0][0]} | "
                f"p(class0)={probs[0]:.3f} p(class1)={probs[1]:.3f} | "
                f"pred={prediction} ({LABELS[prediction]}) conf={confidence:.3f}"
            )

            if confidence >= CONFIDENCE_THRESHOLD:
                ctrl.add_vote(prediction, confidence, inference_ms, centroid)

            if ctrl.ready_to_commit():
                result = ctrl.commit()
                if result is not None:
                    _execute_sort(gate, ctrl, result, r, batch_id,
                                  frame_rgb, bbox, centroid, picam2, dummy_belt)
                    continue

        _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl)

        if not HEADLESS_MODE:
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break

        time.sleep(IDLE_SLEEP_S)


if __name__ == "__main__":
    run()
