FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY media.py providers.py app.py ./
RUN useradd --create-home worker && chown -R worker:worker /app
USER worker
CMD ["sh","-c","exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --limit-concurrency 2"]
