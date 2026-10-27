# Self-hosted video generation (Wan2.1 / LTX-Video)

Standalone GPU inference servers for the two open-weight models discussed with the user.
This is **not** part of the Cloud Run CPU worker in `cloud/worker` (that service is
explicitly CPU-only, see its Dockerfile). These run on a separate GPU box you rent or own,
and expose a minimal HTTP API your program calls over the network.

## Hardware

- **LTX-Video**: fastest, runs on ~12-16 GB VRAM (e.g. a single RTX 4090 / L4).
- **Wan2.1**: the 1.3B checkpoint fits on ~8-12 GB VRAM; the 14B checkpoint needs 24 GB+
  (A100/H100 class) for reasonable speed.

Both Dockerfiles assume an NVIDIA GPU with current drivers and `nvidia-container-toolkit`
installed on the host.

## Model IDs move fast — verify before deploying

The Hugging Face repo IDs and `diffusers` pipeline class names below reflect what was
public when this was written. Diffusion video models get new checkpoints and pipeline
APIs often. Before your first real run on rented GPU time, open the model card on
Hugging Face for `Wan-AI/Wan2.1-T2V-*` and `Lightricks/LTX-Video` and confirm the repo id
and the `diffusers` version pinned in `requirements.txt` still match.

## Security

Each server takes a single shared-secret header (`X-Inference-Key`). There is no user
system, no rate limiting beyond the request caps baked into the validation, and no TLS —
**do not expose these ports to the public internet.** Bind them to a private network /
VPN / SSH tunnel between your program and the GPU box, or put them behind a reverse proxy
you control that terminates TLS and enforces auth.

## Running

```bash
cd wan21   # or ltx-video
docker build -t self-hosted-wan21 .
docker run --gpus all -p 8081:8080 -e INFERENCE_KEY=<a-long-random-secret> self-hosted-wan21
```

Then from your program:

```bash
curl -X POST http://<gpu-box>:8081/generate \
  -H "X-Inference-Key: <same-secret>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a corgi skateboarding through a neon city at night"}' \
  --output out.mp4
```

First request after container start is slow (model weights download + load into VRAM,
tens of GB). Subsequent requests reuse the loaded model.
