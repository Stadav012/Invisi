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

MODEL_PATH = os.getenv("MODEL_PATH", "/home/invisi/Desktop/invisi_models/Trained_ResNet50_INT8.onnx")
SERVO_PIN = int(os.getenv("SERVO_PIN", "18"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
POD_ID = os.getenv("POD_ID", "pod_01")

CONTOUR_AREA_THRESHOLD = 1000
BEAN_PAD_PX = 15
INPUT_SIZE = (224, 224)
SORT_DELAY_S = 1.0
BUFFER_FLUSH_FRAMES = 5
LABELS = {0: "POOR BEAN", 1: "GOOD BEAN"}

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
    gate = AngularServo(SERVO_PIN, min_angle=-90, max_angle=90)
    gate.angle = 0

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 2

    print("Loading ResNet50 INT8 model...")
    session = ort.InferenceSession(
        MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name

    return gate, session, input_name


def extract_bean(frame):
    """Detect the largest contour (bean) and return a preprocessed tensor + bounding box."""
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3]

    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    _, thresh = cv2.threshold(
        blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None, None

    # Filter out dust (<500) and massive background objects like clothing (>50000)
    valid_contours = [c for c in contours if 500 < cv2.contourArea(c) < 50000]
    if not valid_contours:
        return None, None

    # Find the contour closest to the absolute center of the screen
    center_x, center_y = frame.shape[1] // 2, frame.shape[0] // 2

    def dist_to_center(c):
        M = cv2.moments(c)
        if M["m00"] == 0:
            return float('inf')
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
        return (cx - center_x)**2 + (cy - center_y)**2

    target_contour = min(valid_contours, key=dist_to_center)

    x, y, w, h = cv2.boundingRect(target_contour)
    x1 = max(0, x - BEAN_PAD_PX)
    y1 = max(0, y - BEAN_PAD_PX)
    x2 = min(frame.shape[1], x + w + BEAN_PAD_PX)
    y2 = min(frame.shape[0], y + h + BEAN_PAD_PX)

    cropped = frame[y1:y2, x1:x2]
    img = cv2.resize(cropped, INPUT_SIZE).astype(np.float32) / 255.0
    img = (img - IMAGENET_MEAN) / IMAGENET_STD
    img = np.transpose(img, (2, 0, 1))

    return np.expand_dims(img, axis=0).astype(np.float32), (x1, y1, x2, y2)


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


def run():
    gate, session, input_name = init_hardware()
    r = init_redis()
    batch_id = fetch_active_batch_id()

    if batch_id:
        print(f"Active batch: {batch_id}")
    else:
        print("No active batch found. Results will be buffered without batch_id.")

    picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (640, 480)})
    picam2.configure(config)
    picam2.start()
    
    # Force continuous autofocus. Removed experimental AFWindows to fix hardware geometry crash.
    picam2.set_controls({
        "AfMode": 2, 
        "AfRange": 2
    })

    print("Invisi sorting machine online. Press CTRL+C to quit.")

    sorted_count = {"good": 0, "poor": 0}

    try:
        while True:
            frame_rgb = picam2.capture_array()
            display = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)

            input_tensor, bbox = extract_bean(frame_rgb)

            if input_tensor is not None:
                x1, y1, x2, y2 = bbox
                cv2.rectangle(display, (x1, y1), (x2, y2), (255, 0, 0), 2)

                start = time.time()
                outputs = session.run(None, {input_name: input_tensor})
                inference_ms = (time.time() - start) * 1000

                probabilities = outputs[0][0]
                prediction = np.argmax(probabilities)
                confidence = float(np.max(probabilities))

                # Log to Redis
                log_sorting_result(r, prediction, confidence, inference_ms, batch_id)

                if prediction == 0:
                    label, color = "POOR BEAN", (0, 0, 255)
                    gate.angle = -45
                    sorted_count["poor"] += 1
                else:
                    label, color = "GOOD BEAN", (0, 255, 0)
                    gate.angle = 45
                    sorted_count["good"] += 1

                total = sorted_count["good"] + sorted_count["poor"]
                status_line = f"Good: {sorted_count['good']} | Poor: {sorted_count['poor']} | Total: {total}"

                cv2.putText(
                    display, f"{label} ({inference_ms:.1f}ms)",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2,
                )
                cv2.putText(
                    display, status_line,
                    (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1,
                )
                if not HEADLESS_MODE:
                    cv2.imshow("Invisi Sorting Machine", display)
                    cv2.waitKey(1)
                else:
                    print(status_line) # Print to terminal instead in headless mode

                time.sleep(SORT_DELAY_S)
                gate.angle = 0

                for _ in range(BUFFER_FLUSH_FRAMES):
                    picam2.capture_array()
            else:
                if not HEADLESS_MODE:
                    cv2.putText(
                        display, "STANDBY: Waiting for bean...",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2,
                    )
                    cv2.imshow("Invisi Sorting Machine", display)

            if not HEADLESS_MODE:
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        print("\nShutdown signal received (CTRL+C).")
    finally:
        gate.detach()
        picam2.stop()
        if not HEADLESS_MODE:
            cv2.destroyAllWindows()
        total = sorted_count["good"] + sorted_count["poor"]
        print(f"Session: {total} beans sorted ({sorted_count['good']} good, {sorted_count['poor']} poor)")
        print("Hardware released. Shutdown complete.")


if __name__ == "__main__":
    run()
