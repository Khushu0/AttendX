from pathlib import Path
from functools import lru_cache

import cv2
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
YUNET_MODEL = MODEL_DIR / "face_detection_yunet_2023mar.onnx"


@lru_cache(maxsize=1)
def load_detector():
    if not YUNET_MODEL.is_file():
        raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL}")

    return cv2.FaceDetectorYN_create(
        str(YUNET_MODEL),
        "",
        (640, 480),
        0.8,
        0.3,
        5000,
    )


def detect_faces(frame):
    if not isinstance(frame, np.ndarray):
        raise ValueError("Frame must be a NumPy image array.")

    if frame.dtype != np.uint8:
        raise ValueError("Frame must use uint8 image data.")

    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("Frame must be a 3-channel BGR image.")

    height, width = frame.shape[:2]

    if width < 1 or height < 1:
        raise ValueError("Image frame is empty.")

    detector = load_detector()
    detector.setInputSize((width, height))

    _, faces = detector.detect(frame)

    if faces is None:
        return []

    return [
        {
            "x": int(face[0]),
            "y": int(face[1]),
            "width": int(face[2]),
            "height": int(face[3]),
            "confidence": round(float(face[14]), 4),
        }
        for face in faces
    ]
