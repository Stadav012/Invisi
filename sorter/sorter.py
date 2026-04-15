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

logging.basicConfig(
    level=logging.INFO,
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
MIN_CONTOUR_AREA = int(os.getenv("MIN_CONTOUR_AREA", "2500"))
MAX_CONTOUR_AREA = int(os.getenv("MAX_CONTOUR_AREA", "80000"))
MIN_SOLIDITY = float(os.getenv("MIN_SOLIDITY", "0.5"))
MIN_ASPECT_RATIO = 0.3
MAX_ASPECT_RATIO = 3.5
EDGE_MARGIN_PX = 25
BEAN_PAD_PX = 15
ADAPTIVE_BLOCK_SIZE = int(os.getenv("ADAPTIVE_BLOCK_SIZE", "51"))
ADAPTIVE_C = int(os.getenv("ADAPTIVE_C", "10"))

# --- Brightness validation ---
MIN_BRIGHTNESS = int(os.getenv("MIN_BRIGHTNESS", "30"))

# --- Timing ---
CONVEYOR_BELT_DELAY_S = float(os.getenv("CONVEYOR_BELT_DELAY_S", "0.25"))
SORT_CLEARANCE_DELAY_S = float(os.getenv("SORT_CLEARANCE_DELAY_S", "0.5"))
MIN_SORT_GAP_S = float(os.getenv("MIN_SORT_GAP_S", "0.3"))
BUFFER_FLUSH_FRAMES = 5
IDLE_SLEEP_S = 0.01

# --- Servo angles ---
SERVO_NEUTRAL = float(os.getenv("SERVO_NEUTRAL", "0"))
SERVO_GOOD = float(os.getenv("SERVO_GOOD", "180"))
SERVO_POOR = float(os.getenv("SERVO_POOR", "-180"))

# --- Classification ---
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.65"))
LABELS = {0: "POOR BEAN", 1: "GOOD BEAN"}

# --- Smart sort algorithm ---
VOTES_REQUIRED = int(os.getenv("VOTES_REQUIRED", "1"))
VOTE_WINDOW_S = float(os.getenv("VOTE_WINDOW_S", "2.0"))
MAX_CONSECUTIVE_POOR = int(os.getenv("MAX_CONSECUTIVE_POOR", "5"))
DRIFT_WINDOW = int(os.getenv("DRIFT_WINDOW", "30"))
DRIFT_POOR_RATIO = float(os.getenv("DRIFT_POOR_RATIO", "0.9"))
CENTROID_JUMP_PX = float(os.getenv("CENTROID_JUMP_PX", "50"))

# --- Camera ---
EXPOSURE_TIME_US = int(os.getenv("EXPOSURE_TIME_US", "2000"))
ANALOGUE_GAIN = float(os.getenv("ANALOGUE_GAIN", "4.0"))
CAMERA_WARMUP_FRAMES = 15
# Lens position in diopters: higher = closer focus. Formula: 100 / distance_cm.
# At 5.5cm you need ~18, but IMX708 max is ~15. Set as high as the lens allows.
MANUAL_LENS_POSITION = float(os.getenv("MANUAL_LENS_POSITION", "15.0"))

# --- Tripwire zone (Y pixel range) ---
TRIPWIRE_Y_MIN = int(os.getenv("TRIPWIRE_Y_MIN", "120"))
TRIPWIRE_Y_MAX = int(os.getenv("TRIPWIRE_Y_MAX", "380"))

# --- Belt serial control ---
BELT_SERIAL_PORT = os.getenv("BELT_SERIAL_PORT", "/dev/ttyUSB0")
BELT_BAUD_RATE = int(os.getenv("BELT_BAUD_RATE", "9600"))
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
            self.conn = serial.Serial(BELT_SERIAL_PORT, BELT_BAUD_RATE, timeout=2)
            time.sleep(2)  # Arduino resets on serial connect
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


def _find_bean_contours(blurred, frame_w, frame_h):
    """Try adaptive thresholding first, fall back to Otsu if nothing found."""
    adaptive = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, ADAPTIVE_BLOCK_SIZE, ADAPTIVE_C,
    )
    contours, _ = cv2.findContours(adaptive, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    beans = [c for c in contours if is_bean_contour(c, frame_w, frame_h)]
    if beans:
        return beans

    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [c for c in contours if is_bean_contour(c, frame_w, frame_h)]


def find_bean(frame):
    """Detect the best bean-shaped contour. Returns (bbox, centroid) or (None, None)."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    frame_h, frame_w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    bean_contours = _find_bean_contours(blurred, frame_w, frame_h)
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


def preprocess_roi(frame, bbox):
    """Crop ROI from frame and prepare the model input tensor."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    x1, y1, x2, y2 = bbox
    cropped = frame[y1:y2, x1:x2]

    img = cv2.resize(cropped, (224, 224)).astype(np.float32) / 255.0
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
    """Multi-frame voting, centroid tracking, anomaly suppression, drift detection."""

    def __init__(self):
        self.votes = []
        self.vote_times_ms = []
        self.vote_start = 0.0
        self.vote_centroid = None

        self.last_sort_time = 0.0
        self.last_sorted_centroid = None
        self.consecutive_poor = 0
        self.paused = False
        self.drift_warning = False
        self.low_light = False
        self.recent_results = []

        self.stats = {
            "good": 0, "poor": 0, "rejected": 0,
            "missed": 0, "anomaly_pauses": 0,
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

        self._check_anomaly()
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

    def _check_anomaly(self):
        if self.consecutive_poor >= MAX_CONSECUTIVE_POOR and not self.paused:
            self.paused = True
            self.stats["anomaly_pauses"] += 1
            logger.warning(f"ANOMALY: {self.consecutive_poor} consecutive poor - pausing")

    def _check_drift(self):
        if len(self.recent_results) < DRIFT_WINDOW:
            self.drift_warning = False
            return
        poor_ratio = self.recent_results.count(0) / len(self.recent_results)
        self.drift_warning = poor_ratio >= DRIFT_POOR_RATIO

    def resume(self):
        self.paused = False
        self.consecutive_poor = 0
        self._clear_votes()

    @property
    def status_text(self):
        if self.paused:
            return "PAUSED - anomaly detected, press 'r' to resume"
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
    if s["anomaly_pauses"] > 0:
        _put_bold_text(display_frame, f"Pauses: {s['anomaly_pauses']}",
                       (450, 95), 0.45, (100, 100, 255), 1)


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
    if bbox is not None and not on_tripwire and not ctrl.paused and not ctrl.is_voting:
        status = "BEAN SEEN - not on tripwire yet"

    status_color = (255, 255, 255)
    if ctrl.paused:
        status_color = (0, 0, 255)
    elif ctrl.low_light:
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
    """Physically sort the bean: actuate servo, push bean through, update state."""
    prediction, confidence, votes_used, avg_inference_ms = result

    log_sorting_result(r, prediction, confidence, avg_inference_ms, batch_id, votes_used)

    gate.angle = SERVO_POOR if prediction == 0 else SERVO_GOOD
    time.sleep(CONVEYOR_BELT_DELAY_S)

    ctrl.record_sort(prediction, centroid)

    _show_sorted_frame(frame_rgb, bbox, LABELS[prediction], confidence,
                       avg_inference_ms, ctrl, votes_used)

    if belt.available:
        belt.clearance_pulse()
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

    picam2.set_controls({
        "ExposureTime": EXPOSURE_TIME_US,
        "AnalogueGain": ANALOGUE_GAIN,
    })

    if MANUAL_LENS_POSITION > 0:
        logger.info(f"Manual focus at {MANUAL_LENS_POSITION} diopters")
        picam2.set_controls({"AfMode": 0, "LensPosition": MANUAL_LENS_POSITION})
    else:
        logger.info("Running one-shot autofocus then locking")
        picam2.set_controls({"AfMode": 1, "AfRange": 2, "AfTrigger": 0})
        time.sleep(2.0)
        picam2.set_controls({"AfMode": 0})

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

    logger.info("System online. Press 'q' to quit, 'r' to resume after anomaly pause.")
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

        if ctrl.paused:
            belt.stop()
            frame_rgb = picam2.capture_array()
            _show_idle_frame(frame_rgb, None, False, ctrl)
            if not HEADLESS_MODE:
                key = cv2.waitKey(1) & 0xFF
                if key == ord('r'):
                    ctrl.resume()
                    logger.info("Resumed from anomaly pause")
            time.sleep(IDLE_SLEEP_S)
            continue

        # --- Refresh batch ID periodically ---
        now = time.time()
        if now - last_batch_refresh > BATCH_REFRESH_INTERVAL_S:
            new_batch = fetch_active_batch_id()
            if new_batch and new_batch != batch_id:
                batch_id = new_batch
                logger.info(f"Batch ID refreshed: {batch_id}")
            last_batch_refresh = now

        # Step 1: Run belt and watch for a bean to appear
        belt.forward()
        bean_found = False

        while not _shutdown_requested and not bean_found:
            frame_rgb = picam2.capture_array()

            brightness = frame_brightness(frame_rgb)
            ctrl.low_light = brightness < MIN_BRIGHTNESS

            bbox, centroid = find_bean(frame_rgb)
            on_tripwire = False
            if bbox is not None and centroid is not None:
                on_tripwire = TRIPWIRE_Y_MIN <= centroid[1] <= TRIPWIRE_Y_MAX

            _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl)

            if on_tripwire and not ctrl.low_light:
                bean_found = True

            if _check_quit():
                return

            time.sleep(IDLE_SLEEP_S)

        if _shutdown_requested:
            break

        # Step 2: Bean detected on tripwire — stop belt, let it settle
        belt.stop()
        time.sleep(BELT_SETTLE_S)

        # Step 3: Classify the stationary bean (sharp, no blur)
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
                and not ctrl.paused
                and not ctrl.is_recently_sorted_bean(centroid)):

            input_tensor = preprocess_roi(frame_rgb, bbox)
            t0 = time.time()
            outputs = session.run(None, {input_name: input_tensor})
            inference_ms = (time.time() - t0) * 1000

            probs = softmax(outputs[0][0])
            prediction = int(np.argmax(probs))
            confidence = float(probs[prediction])

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
            elif key == ord('r') and ctrl.paused:
                ctrl.resume()
                logger.info("Resumed from anomaly pause")

        time.sleep(IDLE_SLEEP_S)


if __name__ == "__main__":
    run()
