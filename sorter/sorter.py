"""Invisi optical bean sorter — classifies cocoa beans via ResNet50 INT8, buffers results in Redis."""

import json
import os
import time

import cv2
import numpy as np
import onnxruntime as ort
import redis
import requests
from gpiozero import AngularServo
from picamera2 import Picamera2

MODEL_PATH = os.getenv("MODEL_PATH", "/home/invisi/Desktop/invisi_models/Trained_MobileNetV3_INT8.onnx")
SERVO_PIN = int(os.getenv("SERVO_PIN", "18"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
POD_ID = os.getenv("POD_ID", "pod_01")

# --- CONTOUR / BEAN DETECTION ---
MIN_CONTOUR_AREA = int(os.getenv("MIN_CONTOUR_AREA", "2500"))
MAX_CONTOUR_AREA = int(os.getenv("MAX_CONTOUR_AREA", "80000"))
MIN_SOLIDITY = float(os.getenv("MIN_SOLIDITY", "0.5"))
MIN_ASPECT_RATIO = 0.3
MAX_ASPECT_RATIO = 3.5
EDGE_MARGIN_PX = 25  # reject contours this close to the frame border (machinery, not beans)
BEAN_PAD_PX = 15

# --- TIMING ---
CONVEYOR_BELT_DELAY_S = float(os.getenv("CONVEYOR_BELT_DELAY_S", "0.25"))
SORT_CLEARANCE_DELAY_S = float(os.getenv("SORT_CLEARANCE_DELAY_S", "0.5"))
SORT_COOLDOWN_S = float(os.getenv("SORT_COOLDOWN_S", "1.5"))
BUFFER_FLUSH_FRAMES = 5

# --- CLASSIFICATION ---
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.65"))
LABELS = {0: "POOR BEAN", 1: "GOOD BEAN"}

# --- SMART SORT ALGORITHM ---
VOTES_REQUIRED = int(os.getenv("VOTES_REQUIRED", "3"))        # frames needed before committing
VOTE_WINDOW_S = float(os.getenv("VOTE_WINDOW_S", "2.0"))      # max time to collect votes for one bean
MAX_CONSECUTIVE_POOR = int(os.getenv("MAX_CONSECUTIVE_POOR", "5"))  # pause & flag if exceeded
DRIFT_WINDOW = int(os.getenv("DRIFT_WINDOW", "30"))           # rolling window for drift detection
DRIFT_POOR_RATIO = float(os.getenv("DRIFT_POOR_RATIO", "0.9"))  # flag if poor% exceeds this

# --- CAMERA ---
EXPOSURE_TIME_US = int(os.getenv("EXPOSURE_TIME_US", "2000"))
ANALOGUE_GAIN = float(os.getenv("ANALOGUE_GAIN", "4.0"))

# --- TRIPWIRE ZONE (Y pixel range on 480px frame) ---
TRIPWIRE_Y_MIN = int(os.getenv("TRIPWIRE_Y_MIN", "160"))
TRIPWIRE_Y_MAX = int(os.getenv("TRIPWIRE_Y_MAX", "320"))

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406])
IMAGENET_STD = np.array([0.229, 0.224, 0.225])
HEADLESS_MODE = os.getenv("HEADLESS_MODE", "0") == "1"

def init_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)


def fetch_active_batch_id():
    """Fetch the currently fermenting batch ID from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("WARNING: No Supabase credentials, sorting results won't have batch_id")
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
        print(f"Failed to fetch batch: {e}")

    return None


def init_hardware():
    """Initialize servo and AI model with throttled threads to prevent brownouts."""
    print("Initializing hardware...")
    gate = AngularServo(SERVO_PIN, min_angle=-180, max_angle=180)
    gate.angle = 0

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 2

    print("Loading AI model...")
    session = ort.InferenceSession(
        MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name

    return gate, session, input_name


def softmax(logits):
    """Convert raw model logits to proper [0,1] probabilities."""
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()


def is_bean_contour(contour, frame_w, frame_h):
    """Reject shadows, belt edges, machinery, and noise."""
    area = cv2.contourArea(contour)
    if area < MIN_CONTOUR_AREA or area > MAX_CONTOUR_AREA:
        return False

    x, y, w, h = cv2.boundingRect(contour)

    # Anything touching the frame border is machinery/structure, not a bean
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


def find_bean(frame):
    """Detect the single best bean-shaped contour in frame. Returns (bbox, contour) or (None, None)."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    frame_h, frame_w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    bean_contours = [c for c in contours if is_bean_contour(c, frame_w, frame_h)]
    if not bean_contours:
        return None, None

    best = max(bean_contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(best)
    pad = BEAN_PAD_PX
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(frame.shape[1], x + w + pad)
    y2 = min(frame.shape[0], y + h + pad)

    return (x1, y1, x2, y2), best


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


def log_sorting_result(r, prediction, confidence, inference_ms, batch_id):
    """Buffer sorting result in Redis ZSET for later batch sync to Supabase."""
    ts = int(time.time())
    entry = {
        "ts": ts,
        "batch_id": batch_id,
        "prediction": int(prediction),
        "label": LABELS[int(prediction)],
        "confidence": round(float(confidence), 4),
        "inference_ms": round(inference_ms, 1),
    }

    key = f"{POD_ID}_sorting"
    r.zadd(key, {json.dumps(entry): ts})

    # 72-hour TTL pruning
    cutoff = ts - (72 * 3600)
    r.zremrangebyscore(key, "-inf", cutoff)


class SortController:
    """Stateful sort algorithm: multi-frame voting, anomaly suppression, drift detection."""

    def __init__(self):
        self.votes = []           # list of (prediction, confidence) for the current bean
        self.vote_start = 0.0
        self.last_sort_time = 0.0
        self.consecutive_poor = 0
        self.paused = False
        self.drift_warning = False
        self.recent_results = []  # rolling window of final predictions

        self.stats = {"good": 0, "poor": 0, "rejected": 0, "anomaly_pauses": 0}

    @property
    def in_cooldown(self):
        return (time.time() - self.last_sort_time) < SORT_COOLDOWN_S

    @property
    def is_voting(self):
        """True if we're in the middle of collecting frames for a bean."""
        if not self.votes:
            return False
        return (time.time() - self.vote_start) < VOTE_WINDOW_S

    def add_vote(self, prediction, confidence):
        """Register one frame's classification for the current bean."""
        if not self.votes:
            self.vote_start = time.time()
        self.votes.append((prediction, confidence))

    def ready_to_commit(self):
        """True when we have enough votes or the vote window expired."""
        if len(self.votes) >= VOTES_REQUIRED:
            return True
        if self.votes and (time.time() - self.vote_start) >= VOTE_WINDOW_S:
            return True
        return False

    def commit(self):
        """Tally votes and return (prediction, avg_confidence, vote_count), or None if inconclusive."""
        if not self.votes:
            return None

        num_votes = len(self.votes)
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

        self.votes = []

        if avg_conf < CONFIDENCE_THRESHOLD:
            self.stats["rejected"] += 1
            return None

        return winner, float(avg_conf), num_votes

    def record_sort(self, prediction):
        """Update state after a bean is physically sorted."""
        self.last_sort_time = time.time()

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

    def _check_anomaly(self):
        """Pause if too many consecutive poor results (likely false positives)."""
        if self.consecutive_poor >= MAX_CONSECUTIVE_POOR and not self.paused:
            self.paused = True
            self.stats["anomaly_pauses"] += 1
            print(f"ANOMALY: {self.consecutive_poor} consecutive poor - pausing sort")

    def _check_drift(self):
        """Flag if poor ratio over the rolling window is abnormally high."""
        if len(self.recent_results) < DRIFT_WINDOW:
            self.drift_warning = False
            return
        poor_ratio = self.recent_results.count(0) / len(self.recent_results)
        self.drift_warning = poor_ratio >= DRIFT_POOR_RATIO

    def resume(self):
        """Operator manually resumes after anomaly pause."""
        self.paused = False
        self.consecutive_poor = 0
        self.votes = []

    def reset_votes(self):
        """Clear vote buffer when bean leaves the tripwire without enough votes."""
        self.votes = []

    @property
    def status_text(self):
        if self.paused:
            return "PAUSED - anomaly detected, press 'r' to resume"
        if self.drift_warning:
            return "WARNING - abnormal poor ratio, check lighting/belt"
        if self.is_voting:
            return f"TRACKING BEAN - {len(self.votes)}/{VOTES_REQUIRED} votes"
        if self.in_cooldown:
            return "COOLDOWN - waiting for bean to clear"
        return "EMPTY BELT - waiting"


def _put_bold_text(frame, text, origin, scale, color, thickness=2):
    """Draw text with a dark outline so it's readable on any background."""
    x, y = origin
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thickness + 3)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)


def _draw_stats(display_frame, ctrl):
    s = ctrl.stats
    total = s["good"] + s["poor"]
    line1 = f"Good: {s['good']}  Poor: {s['poor']}  Total: {total}  Rej: {s['rejected']}"
    _put_bold_text(display_frame, line1, (10, 70), 0.55, (255, 255, 255), 2)

    if ctrl.drift_warning:
        _put_bold_text(display_frame, "DRIFT WARNING", (10, 95), 0.55, (0, 165, 255), 2)
    if ctrl.stats["anomaly_pauses"] > 0:
        _put_bold_text(display_frame, f"Pauses: {ctrl.stats['anomaly_pauses']}",
                       (400, 95), 0.45, (100, 100, 255), 1)


def _show_sorted_frame(frame_rgb, bbox, label, confidence, inference_ms, ctrl, votes_used):
    display_frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    x1, y1, x2, y2 = bbox
    color = (0, 0, 255) if "POOR" in label else (0, 255, 0)

    cv2.rectangle(display_frame, (x1, y1), (x2, y2), color, 3)
    _put_bold_text(display_frame, f"{label} {confidence:.0%} [{votes_used}v]",
                   (10, 35), 1.0, color, 3)
    _draw_stats(display_frame, ctrl)

    if not HEADLESS_MODE:
        cv2.imshow("Invisi Vision Test", display_frame)
    else:
        s = ctrl.stats
        print(f"{label} {confidence:.0%} [{votes_used}v] | Good: {s['good']} Poor: {s['poor']}")


def _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl):
    display_frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)

    cv2.line(display_frame, (0, TRIPWIRE_Y_MIN), (640, TRIPWIRE_Y_MIN), (0, 255, 255), 1)
    cv2.line(display_frame, (0, TRIPWIRE_Y_MAX), (640, TRIPWIRE_Y_MAX), (0, 255, 255), 1)

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
    elif ctrl.drift_warning:
        status_color = (0, 165, 255)

    _put_bold_text(display_frame, status, (10, 35), 0.8, status_color, 2)
    _draw_stats(display_frame, ctrl)

    if not HEADLESS_MODE:
        cv2.imshow("Invisi Vision Test", display_frame)


def _execute_sort(gate, ctrl, result, r, batch_id, frame_rgb, bbox, picam2):
    """Physically sort the bean: actuate servo, log, update state."""
    prediction, confidence, votes_used = result

    log_sorting_result(r, prediction, confidence, 0, batch_id)
    time.sleep(CONVEYOR_BELT_DELAY_S)

    gate.angle = -5 if prediction == 0 else 90
    ctrl.record_sort(prediction)

    _show_sorted_frame(frame_rgb, bbox, LABELS[prediction], confidence, 0,
                       ctrl, votes_used)

    time.sleep(SORT_CLEARANCE_DELAY_S)
    gate.angle = 0

    for _ in range(BUFFER_FLUSH_FRAMES):
        picam2.capture_array()


def run():
    gate, session, input_name = init_hardware()
    r = init_redis()
    batch_id = fetch_active_batch_id()

    if batch_id:
        print(f"Active batch: {batch_id}")
    else:
        print("No active batch found. Results will be buffered without batch_id.")

    print("Initializing IMX708 Camera Feed via Picamera2...")
    picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (640, 480)})
    picam2.configure(config)
    picam2.start()
    
    picam2.set_controls({
        "AfMode": 2,
        "AfRange": 2,
        "ExposureTime": EXPOSURE_TIME_US,
        "AnalogueGain": ANALOGUE_GAIN,
    })

    print("System Online. Press 'q' to quit, 'r' to resume after anomaly pause.")

    ctrl = SortController()

    try:
        while True:
            frame_rgb = picam2.capture_array()
            bbox, contour = find_bean(frame_rgb)

            on_tripwire = False
            if bbox is not None:
                _, y1, _, y2 = bbox
                center_y = (y1 + y2) / 2
                on_tripwire = TRIPWIRE_Y_MIN <= center_y <= TRIPWIRE_Y_MAX

            # Bean left the tripwire while we were collecting votes -> commit early
            if ctrl.is_voting and (bbox is None or not on_tripwire):
                if ctrl.ready_to_commit():
                    result = ctrl.commit()
                    if result is not None:
                        _execute_sort(gate, ctrl, result, r, batch_id,
                                      frame_rgb, bbox or (0, 0, 0, 0), picam2)
                        continue
                else:
                    ctrl.reset_votes()

            # Collect votes when: bean on tripwire, not paused, not in cooldown
            if bbox is not None and on_tripwire and not ctrl.paused and not ctrl.in_cooldown:
                input_tensor = preprocess_roi(frame_rgb, bbox)
                outputs = session.run(None, {input_name: input_tensor})

                probs = softmax(outputs[0][0])
                prediction = int(np.argmax(probs))
                confidence = float(probs[prediction])

                if confidence >= CONFIDENCE_THRESHOLD:
                    ctrl.add_vote(prediction, confidence)

                if ctrl.ready_to_commit():
                    result = ctrl.commit()
                    if result is not None:
                        _execute_sort(gate, ctrl, result, r, batch_id,
                                      frame_rgb, bbox, picam2)
                        continue

            _show_idle_frame(frame_rgb, bbox, on_tripwire, ctrl)

            if not HEADLESS_MODE:
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('r') and ctrl.paused:
                    ctrl.resume()
                    print("Resumed from anomaly pause")

    except KeyboardInterrupt:
        print("\nShutdown signal received (CTRL+C).")
    finally:
        gate.detach()
        picam2.stop()
        if not HEADLESS_MODE:
            cv2.destroyAllWindows()
        print("Camera released. System shutdown.")


if __name__ == "__main__":
    run()

