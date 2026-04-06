"""Invisi optical bean sorter — classifies cocoa beans via ResNet50 INT8 and actuates a servo gate."""

import time

import cv2
import numpy as np
import onnxruntime as ort
from gpiozero import AngularServo
from picamera2 import Picamera2

MODEL_PATH = "/home/invisi/Desktop/invisi_models/Trained_ResNet50_INT8.onnx"
SERVO_PIN = 18
CONTOUR_AREA_THRESHOLD = 1000
BEAN_PAD_PX = 15
INPUT_SIZE = (224, 224)
SORT_DELAY_S = 1.0
BUFFER_FLUSH_FRAMES = 5

# ImageNet normalization constants
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406])
IMAGENET_STD = np.array([0.229, 0.224, 0.225])


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

    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < CONTOUR_AREA_THRESHOLD:
        return None, None

    x, y, w, h = cv2.boundingRect(largest)
    x1 = max(0, x - BEAN_PAD_PX)
    y1 = max(0, y - BEAN_PAD_PX)
    x2 = min(frame.shape[1], x + w + BEAN_PAD_PX)
    y2 = min(frame.shape[0], y + h + BEAN_PAD_PX)

    cropped = frame[y1:y2, x1:x2]
    img = cv2.resize(cropped, INPUT_SIZE).astype(np.float32) / 255.0
    img = (img - IMAGENET_MEAN) / IMAGENET_STD
    img = np.transpose(img, (2, 0, 1))

    return np.expand_dims(img, axis=0).astype(np.float32), (x1, y1, x2, y2)


def run():
    gate, session, input_name = init_hardware()

    picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (640, 480)})
    picam2.configure(config)
    picam2.start()
    picam2.set_controls({"AfMode": 2, "AfRange": 2})  # Macro autofocus

    print("Invisi sorting machine online. Press 'q' to quit.")

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
                prediction = np.argmax(outputs[0])

                if prediction == 0:
                    label, color = "POOR BEAN", (0, 0, 255)
                    gate.angle = -45  # Reject bin
                else:
                    label, color = "GOOD BEAN", (0, 255, 0)
                    gate.angle = 45  # Accept bin

                cv2.putText(
                    display, f"{label} ({inference_ms:.1f}ms)",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2,
                )
                cv2.imshow("Invisi Sorting Machine", display)
                cv2.waitKey(1)

                time.sleep(SORT_DELAY_S)
                gate.angle = 0  # Reset to neutral

                # Flush stale frames from the buffer
                for _ in range(BUFFER_FLUSH_FRAMES):
                    picam2.capture_array()
            else:
                cv2.putText(
                    display, "STANDBY: Waiting for bean...",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2,
                )
                cv2.imshow("Invisi Sorting Machine", display)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        gate.detach()
        picam2.stop()
        cv2.destroyAllWindows()
        print("Hardware released. Shutdown complete.")


if __name__ == "__main__":
    run()
