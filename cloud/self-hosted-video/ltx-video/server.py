"""Standalone GPU inference server for LTX-Video text-to-video. Not part of the Cloud Run CPU worker."""
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from fastapi.background import BackgroundTask
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MODEL_ID = os.environ.get("LTX_MODEL_ID", "Lightricks/LTX-Video")
MAX_FRAMES = 257
MAX_PROMPT_LENGTH = 2000
_pipeline = None


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str
    negative_prompt: str = "worst quality, inconsistent motion, blurry, jittery, distorted"
    width: int = 768
    height: int = 512
    num_frames: int = 161
    num_inference_steps: int = 50
    fps: int = 24


def require_key(x_inference_key: str | None = Header(default=None)):
    expected = os.environ.get("INFERENCE_KEY")
    if not expected:
        raise HTTPException(500, "INFERENCE_KEY is not configured on the server")
    if x_inference_key != expected:
        raise HTTPException(401, "Invalid or missing X-Inference-Key header")


def load_pipeline():
    global _pipeline
    if _pipeline is None:
        import torch
        from diffusers import LTXPipeline
        _pipeline = LTXPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
        _pipeline.to("cuda")
    return _pipeline


@app.post("/generate")
def generate(request: GenerateRequest, x_inference_key: str | None = Header(default=None)):
    require_key(x_inference_key)
    if not request.prompt.strip() or len(request.prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(400, "Invalid prompt")
    if len(request.negative_prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(400, "Invalid negative prompt")
    if request.width % 32 or request.height % 32 or request.width > 1280 or request.height > 1280:
        raise HTTPException(400, "Resolution must be a multiple of 32 and at most 1280 on each side")
    if request.num_frames < 1 or request.num_frames > MAX_FRAMES:
        raise HTTPException(400, f"num_frames must be between 1 and {MAX_FRAMES}")
    if request.num_inference_steps < 1 or request.num_inference_steps > 100:
        raise HTTPException(400, "num_inference_steps must be between 1 and 100")
    if request.fps < 1 or request.fps > 60:
        raise HTTPException(400, "fps must be between 1 and 60")

    from diffusers.utils import export_to_video
    pipeline = load_pipeline()
    output = pipeline(
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        width=request.width,
        height=request.height,
        num_frames=request.num_frames,
        num_inference_steps=request.num_inference_steps,
    ).frames[0]

    directory = tempfile.mkdtemp(prefix="ltx-video-")
    target = Path(directory) / f"{uuid.uuid4().hex}.mp4"
    export_to_video(output, str(target), fps=request.fps)
    return FileResponse(
        target,
        media_type="video/mp4",
        filename="ltx-video-output.mp4",
        background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True),
    )


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID}
