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

current_lens_pos = 10.0 # 10 diopters = Macro focus (10cm)
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

    print("Loading AI model...")
    session = ort.InferenceSession(
        MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name

    return gate, session, input_name


def extract_and_preprocess(frame):
    # Slice off the 4th Alpha channel if it exists
    if frame.shape[-1] == 4:
        frame = frame[:, :, :3] 
        
    # --- DYNAMIC ROI EXTRACTION ---
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    bbox_coords = None
    cropped_frame = frame.copy() # Default to full frame if nothing is found
    
    if contours:
        largest_contour = max(contours, key=cv2.contourArea)
        
        # Only crop if the dark object is large enough
        if cv2.contourArea(largest_contour) > 1000:
            x, y, w, h = cv2.boundingRect(largest_contour)
            
            # Add a 15-pixel padding around the bean
            pad = 15
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(frame.shape[1], x + w + pad)
            y2 = min(frame.shape[0], y + h + pad)
            
            # Crop the frame and save the coordinates to draw the box later
            cropped_frame = frame[y1:y2, x1:x2]
            bbox_coords = (x1, y1, x2, y2)

    # --- STANDARD AI PREPROCESSING ---
    img = cv2.resize(cropped_frame, (224, 224))
    img = img.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    img = (img - mean) / std
    img = np.transpose(img, (2, 0, 1))
    
    # We now return BOTH the AI tensor and the box coordinates
    return np.expand_dims(img, axis=0).astype(np.float32), bbox_coords


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

    print("Initializing IMX708 Camera Feed via Picamera2...")
    picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (640, 480)})
    picam2.configure(config)
    picam2.start()
    
    # Force continuous Macro autofocus
    picam2.set_controls({"AfMode": 2, "AfRange": 2})

    print("System Online. Show cocoa beans to the camera. Press 'q' to quit.")

    sorted_count = {"good": 0, "poor": 0}

    try:
        while True:
            # Capture raw frame
            frame_rgb = picam2.capture_array()
            
            # 1. Preprocess the frame and get the bounding box coordinates
            input_tensor, bbox_coords = extract_and_preprocess(frame_rgb)

            # 2. Run Inference
            start_time = time.time()
            outputs = session.run(None, {input_name: input_tensor})
            inference_ms = (time.time() - start_time) * 1000
            
            probabilities = outputs[0][0]
            prediction = np.argmax(probabilities)
            confidence = float(np.max(probabilities))
            
            # Log to Redis (Telemetry Platform Integration)
            if bbox_coords is not None:
                # We only log to Redis and fire Servo if a bean was actually detected
                log_sorting_result(r, prediction, confidence, inference_ms, batch_id)
                if prediction == 0:
                    gate.angle = -45
                    sorted_count["poor"] += 1
                else:
                    gate.angle = 45
                    sorted_count["good"] += 1
            
            # 3. Screen Overlay Formatting
            display_frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)

            # --- DRAW THE BOUNDING BOX ---
            if bbox_coords is not None:
                x1, y1, x2, y2 = bbox_coords
                # Draw a Blue box (BGR format: 255, 0, 0) with a thickness of 2
                cv2.rectangle(display_frame, (x1, y1), (x2, y2), (255, 0, 0), 2)
                # Add a small text label to the box
                cv2.putText(display_frame, "Target ROI", (x1, y1 - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)

            # Set Prediction Colors
            if prediction == 0:
                label = "POOR BEAN"
                color = (0, 0, 255) # Red
            else:
                label = "GOOD BEAN"
                color = (0, 255, 0) # Green

            # Draw Prediction Text
            cv2.putText(display_frame, f"{label} ({inference_ms:.1f}ms)", (10, 30), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
            
            total = sorted_count["good"] + sorted_count["poor"]
            status_line = f"Good: {sorted_count['good']} | Poor: {sorted_count['poor']} | Total: {total}"
            cv2.putText(
                display_frame, status_line,
                (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1,
            )

            # Show the video feed (if not headless)
            if not HEADLESS_MODE:
                cv2.imshow("Invisi Vision Test", display_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
            else:
                if bbox_coords is not None:
                    print(status_line)
            
            if bbox_coords is not None:
                time.sleep(SORT_DELAY_S)
                gate.angle = 0
                for _ in range(BUFFER_FLUSH_FRAMES):
                    picam2.capture_array()

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

