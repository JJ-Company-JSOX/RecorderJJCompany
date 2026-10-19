"""Read-only scene analysis worker for the bundled, isolated runtime. No network code."""
import argparse
import json
import math
import sys

import cv2
import numpy
import scenedetect
from scenedetect import ContentDetector, SceneManager, open_video


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    video = open_video(args.input, backend="opencv")
    fps = video.frame_rate
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("Video frame rate could not be verified")
    duration_ms = round(video.duration.get_seconds() * 1000)
    if duration_ms <= 0 or duration_ms > 600_000:
        raise ValueError("Scene analysis supports verified videos up to ten minutes")
    manager = SceneManager()
    manager.auto_downscale = False
    manager.downscale = max(1, math.ceil(video.frame_size[0] / 480))
    manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=max(1, round(fps * 0.5))))
    # Every third source frame is inspected. Returned timestamps remain source-based.
    manager.detect_scenes(video=video, show_progress=False, frame_skip=2)
    scenes = manager.get_scene_list(start_in_scene=True)
    if len(scenes) > 2000:
        raise ValueError("Too many scene boundaries")
    print(json.dumps({
        "version": 1,
        "engine": "PySceneDetect",
        "engineVersion": scenedetect.__version__,
        "opencvVersion": cv2.__version__,
        "numpyVersion": numpy.__version__,
        "durationMs": duration_ms,
        "frameSkip": 2,
        "timing": "sampled-frame-boundary",
        "scenes": [{"startMs": round(start.get_seconds() * 1000), "endMs": min(duration_ms, round(end.get_seconds() * 1000))} for start, end in scenes],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
