// Generates the downloadable Python pipeline scaffold as a zip.
// Uses fflate (sync) to build the archive in-memory.
import { zipSync, strToU8 } from "fflate";

const README = `# S.S.D.P. — Synthetic Speech Data Pipeline (Python)

Production-grade Egyptian Arabic synthetic speech dataset pipeline.

## Architecture
- **FastAPI** control plane (job submission + status)
- **Celery + Redis** background workers (synthesis, QA)
- **Postgres** for prompts/jobs/samples/QA/reviews
- **Pluggable TTS backends**: ElevenLabs (cloud) or XTTS-v2 (self-host)
- **Whisper / Scribe** ASR for automated QA (WER/CER/language drift)

## Quick start
\`\`\`bash
cp .env.example .env  # fill in secrets
docker compose up --build
# UI:    http://localhost:8000/docs
# Flower: http://localhost:5555
\`\`\`

## Layout
\`\`\`
ssdp/
  api/            FastAPI app
  workers/        Celery tasks (synthesis, qa)
  tts/            Pluggable backends (elevenlabs, xtts)
  qa/             ASR + WER/CER scoring
  exporters/      jsonl, csv, hf, whisper manifests
  prompts/        Egyptian Arabic prompt generation
  db/             SQLAlchemy models + alembic migrations
  config.py       Pydantic settings (env-driven)
\`\`\`

## TTS backends
Switch via env: \`TTS_BACKEND=elevenlabs\` or \`TTS_BACKEND=xtts\`.
Add a new provider by subclassing \`ssdp.tts.base.TTSBackend\` and registering it.

## Export
\`\`\`bash
python -m ssdp.exporters jsonl    --out data/dataset.jsonl
python -m ssdp.exporters hf       --out data/hf/
python -m ssdp.exporters whisper  --out data/whisper.jsonl
\`\`\`
`;

const ENV_EXAMPLE = `# === S.S.D.P. ===
DATABASE_URL=postgresql+psycopg://ssdp:ssdp@db:5432/ssdp
REDIS_URL=redis://redis:6379/0

# TTS backend: elevenlabs | xtts
TTS_BACKEND=elevenlabs

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL=eleven_multilingual_v2

# XTTS-v2 (self-hosted)
XTTS_SERVER_URL=http://xtts:8020
XTTS_SPEAKER_WAV=/data/voices/eg_male_01.wav
XTTS_LANGUAGE=ar

# ASR for QA
ASR_BACKEND=scribe   # scribe | whisper
WHISPER_MODEL=large-v3
SCRIBE_API_KEY=

# Storage
STORAGE_DIR=/data/audio
`;

const REQUIREMENTS = `fastapi==0.115.0
uvicorn[standard]==0.30.6
celery[redis]==5.4.0
redis==5.0.8
sqlalchemy==2.0.34
alembic==1.13.2
psycopg[binary]==3.2.1
pydantic==2.9.2
pydantic-settings==2.5.2
httpx==0.27.2
python-dotenv==1.0.1
soundfile==0.12.1
numpy==1.26.4
jiwer==3.0.4
pyarabic==0.6.15
openai-whisper==20231117 ; platform_system != "Windows"
flower==2.0.1
`;

const COMPOSE = `services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: ssdp
      POSTGRES_PASSWORD: ssdp
      POSTGRES_DB: ssdp
    ports: ["5432:5432"]
    volumes: [pg:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: .
    command: uvicorn ssdp.api.main:app --host 0.0.0.0 --port 8000
    env_file: .env
    depends_on: [db, redis]
    ports: ["8000:8000"]
    volumes: [./:/app, audio:/data/audio]

  worker:
    build: .
    command: celery -A ssdp.workers.celery_app worker --loglevel=info -Q synthesis,qa
    env_file: .env
    depends_on: [db, redis]
    volumes: [./:/app, audio:/data/audio]

  flower:
    build: .
    command: celery -A ssdp.workers.celery_app flower --port=5555
    env_file: .env
    depends_on: [redis]
    ports: ["5555:5555"]

volumes:
  pg:
  audio:
`;

const DOCKERFILE = `FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ffmpeg build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1
`;

const CONFIG_PY = `from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://ssdp:ssdp@db:5432/ssdp"
    redis_url: str = "redis://redis:6379/0"

    tts_backend: str = "elevenlabs"  # elevenlabs | xtts

    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"

    xtts_server_url: str = "http://xtts:8020"
    xtts_speaker_wav: str = "/data/voices/eg_male_01.wav"
    xtts_language: str = "ar"

    asr_backend: str = "scribe"  # scribe | whisper
    whisper_model: str = "large-v3"
    scribe_api_key: str = ""

    storage_dir: str = "/data/audio"


settings = Settings()
`;

const TTS_BASE = `from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TTSResult:
    audio_bytes: bytes
    sample_rate: int
    format: str  # "mp3" | "wav"
    params: dict


class TTSBackend(ABC):
    """Pluggable TTS backend. Implement \`synthesize\` for new providers."""

    name: str = "base"

    @abstractmethod
    def synthesize(self, text: str, voice_id: str, *, jitter: dict | None = None) -> TTSResult:
        ...


_REGISTRY: dict[str, type[TTSBackend]] = {}


def register(cls: type[TTSBackend]) -> type[TTSBackend]:
    _REGISTRY[cls.name] = cls
    return cls


def get_backend(name: str) -> TTSBackend:
    if name not in _REGISTRY:
        raise ValueError(f"Unknown TTS backend: {name}. Available: {list(_REGISTRY)}")
    return _REGISTRY[name]()
`;

const TTS_INIT = `from .base import TTSBackend, TTSResult, get_backend, register  # noqa
from . import elevenlabs as _e  # noqa: ensure registration
from . import xtts as _x  # noqa
`;

const TTS_ELEVENLABS = `from __future__ import annotations
import random
import httpx
from .base import TTSBackend, TTSResult, register
from ..config import settings


@register
class ElevenLabsBackend(TTSBackend):
    name = "elevenlabs"

    def synthesize(self, text: str, voice_id: str, *, jitter: dict | None = None) -> TTSResult:
        params = jitter or {
            "stability": round(random.uniform(0.3, 0.7), 2),
            "similarity_boost": round(random.uniform(0.6, 0.9), 2),
            "style": round(random.uniform(0.0, 0.5), 2),
            "speed": round(random.uniform(0.95, 1.1), 2),
        }
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": settings.elevenlabs_api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": text,
            "model_id": settings.elevenlabs_model,
            "voice_settings": {k: v for k, v in params.items() if k != "speed"},
        }
        if "speed" in params:
            body["voice_settings"]["speed"] = params["speed"]
        with httpx.Client(timeout=120) as c:
            r = c.post(url, headers=headers, json=body)
            r.raise_for_status()
            return TTSResult(audio_bytes=r.content, sample_rate=44100, format="mp3", params=params)
`;

const TTS_XTTS = `from __future__ import annotations
import random
import httpx
from .base import TTSBackend, TTSResult, register
from ..config import settings


@register
class XTTSBackend(TTSBackend):
    """XTTS-v2 backend. Talks to a self-hosted XTTS HTTP server.

    Recommended server: https://github.com/coqui-ai/TTS  (xtts_v2)
    Endpoint expected: POST {XTTS_SERVER_URL}/tts_to_audio  -> wav bytes
    """

    name = "xtts"

    def synthesize(self, text: str, voice_id: str, *, jitter: dict | None = None) -> TTSResult:
        params = jitter or {
            "temperature": round(random.uniform(0.55, 0.85), 2),
            "length_penalty": round(random.uniform(0.9, 1.1), 2),
            "repetition_penalty": round(random.uniform(1.5, 2.5), 2),
            "top_k": random.choice([30, 50, 70]),
            "top_p": round(random.uniform(0.7, 0.95), 2),
            "speed": round(random.uniform(0.95, 1.1), 2),
        }
        body = {
            "text": text,
            "speaker_wav": settings.xtts_speaker_wav,
            "language": settings.xtts_language,
            **params,
        }
        with httpx.Client(timeout=300) as c:
            r = c.post(f"{settings.xtts_server_url}/tts_to_audio", json=body)
            r.raise_for_status()
            return TTSResult(audio_bytes=r.content, sample_rate=24000, format="wav", params=params)
`;

const DB_MODELS = `from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, JSON, DateTime, ForeignKey, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


class Prompt(Base):
    __tablename__ = "prompts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    text: Mapped[str] = mapped_column(Text)
    normalized_text: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(64))
    language_mix_pct: Mapped[int] = mapped_column(Integer, default=0)
    est_duration_sec: Mapped[float] = mapped_column(Float, default=0)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AudioSample(Base):
    __tablename__ = "audio_samples"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("prompts.id"))
    storage_path: Mapped[str] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(8), default="mp3")
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    voice_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class QAResult(Base):
    __tablename__ = "qa_results"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    sample_id: Mapped[str] = mapped_column(ForeignKey("audio_samples.id"))
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    wer: Mapped[float | None] = mapped_column(Float, nullable=True)
    cer: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_score: Mapped[int] = mapped_column(Integer, default=0)
    flags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    sample_id: Mapped[str] = mapped_column(ForeignKey("audio_samples.id"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    edited_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
`;

const DB_SESSION = `from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from ..config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
`;

const CELERY_APP = `from celery import Celery
from ..config import settings

celery_app = Celery(
    "ssdp",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["ssdp.workers.synthesis", "ssdp.workers.qa"],
)
celery_app.conf.task_routes = {
    "ssdp.workers.synthesis.*": {"queue": "synthesis"},
    "ssdp.workers.qa.*": {"queue": "qa"},
}
celery_app.conf.task_acks_late = True
celery_app.conf.worker_prefetch_multiplier = 1
`;

const WORKER_SYNTH = `from __future__ import annotations
import os, hashlib
from .celery_app import celery_app
from ..config import settings
from ..tts import get_backend
from ..db.session import SessionLocal
from ..db.models import AudioSample, Prompt


@celery_app.task(name="ssdp.workers.synthesis.synthesize_prompt", bind=True, max_retries=3)
def synthesize_prompt(self, prompt_id: str, voice_id: str):
    s = SessionLocal()
    try:
        p: Prompt | None = s.get(Prompt, prompt_id)
        if not p:
            return {"error": "prompt_not_found"}
        backend = get_backend(settings.tts_backend)
        result = backend.synthesize(p.text, voice_id)
        os.makedirs(settings.storage_dir, exist_ok=True)
        h = hashlib.sha1(f"{prompt_id}-{voice_id}".encode()).hexdigest()[:12]
        path = os.path.join(settings.storage_dir, f"{h}.{result.format}")
        with open(path, "wb") as f:
            f.write(result.audio_bytes)
        sample = AudioSample(
            prompt_id=prompt_id,
            voice_id=voice_id,
            storage_path=path,
            format=result.format,
            bytes=len(result.audio_bytes),
            params=result.params,
        )
        s.add(sample); s.commit()
        return {"sample_id": sample.id}
    except Exception as e:
        raise self.retry(exc=e, countdown=2 ** self.request.retries)
    finally:
        s.close()
`;

const WORKER_QA = `from __future__ import annotations
from jiwer import wer, cer
from .celery_app import celery_app
from ..qa.asr import transcribe
from ..qa.normalize import normalize_arabic
from ..db.session import SessionLocal
from ..db.models import AudioSample, Prompt, QAResult


@celery_app.task(name="ssdp.workers.qa.score_sample")
def score_sample(sample_id: str):
    s = SessionLocal()
    try:
        sample: AudioSample | None = s.get(AudioSample, sample_id)
        if not sample:
            return {"error": "sample_not_found"}
        prompt: Prompt = s.get(Prompt, sample.prompt_id)
        with open(sample.storage_path, "rb") as f:
            audio = f.read()
        hyp = transcribe(audio, fmt=sample.format)
        ref_n = normalize_arabic(prompt.normalized_text or prompt.text)
        hyp_n = normalize_arabic(hyp)
        w = float(wer(ref_n, hyp_n)) if ref_n else 1.0
        c = float(cer(ref_n, hyp_n)) if ref_n else 1.0
        score = max(0, min(100, int(100 * (1 - 0.7 * w - 0.3 * c))))
        flags = []
        if sample.duration_sec and sample.duration_sec < 0.6: flags.append("too_short")
        qa = QAResult(sample_id=sample_id, transcript=hyp, wer=w, cer=c, quality_score=score, flags=flags)
        s.add(qa); s.commit()
        return {"score": score, "wer": w, "cer": c}
    finally:
        s.close()
`;

const QA_ASR = `from __future__ import annotations
import io
import httpx
from ..config import settings


def transcribe(audio_bytes: bytes, *, fmt: str = "mp3") -> str:
    if settings.asr_backend == "scribe":
        return _scribe(audio_bytes, fmt)
    return _whisper_local(audio_bytes, fmt)


def _scribe(audio_bytes: bytes, fmt: str) -> str:
    files = {"file": (f"audio.{fmt}", audio_bytes, f"audio/{fmt}")}
    data = {"model_id": "scribe_v2", "language_code": "ara"}
    headers = {"xi-api-key": settings.scribe_api_key}
    with httpx.Client(timeout=180) as c:
        r = c.post("https://api.elevenlabs.io/v1/speech-to-text", files=files, data=data, headers=headers)
        r.raise_for_status()
        return r.json().get("text", "")


def _whisper_local(audio_bytes: bytes, fmt: str) -> str:
    import tempfile, whisper  # type: ignore
    model = whisper.load_model(settings.whisper_model)
    with tempfile.NamedTemporaryFile(suffix=f".{fmt}") as tmp:
        tmp.write(audio_bytes); tmp.flush()
        result = model.transcribe(tmp.name, language="ar")
        return result.get("text", "")
`;

const QA_NORMALIZE = `import re

_DIACRITICS = re.compile(r"[\\u064B-\\u065F\\u0670]")
_TATWEEL = "\\u0640"
_PUNCT = re.compile(r"[\\u060C\\u061B\\u061F.,!?;:\\-\\(\\)\\[\\]\\"'\\u201C\\u201D]")


def normalize_arabic(s: str) -> str:
    if not s:
        return ""
    s = _DIACRITICS.sub("", s)
    s = s.replace(_TATWEEL, "")
    # alef variants
    s = re.sub(r"[\\u0622\\u0623\\u0625]", "\\u0627", s)
    s = s.replace("\\u0649", "\\u064A")  # alef maksura -> ya
    s = s.replace("\\u0629", "\\u0647")  # taa marbouta -> ha
    s = _PUNCT.sub(" ", s)
    s = re.sub(r"\\s+", " ", s).strip().lower()
    return s
`;

const PROMPTS_GEN = `"""Egyptian Arabic prompt generation via LLM.

This is a template. Wire \`generate_prompts\` to your LLM of choice
(OpenAI, Gemini, local) — see system_prompt below.
"""
from __future__ import annotations
from dataclasses import dataclass

CATEGORIES = [
    "daily_chat", "voice_notes", "code_switching", "franco_arabic",
    "numbers_dates", "slang", "sarcasm", "questions", "commands",
    "expressions", "money", "directions",
]

SYSTEM_PROMPT = """You are an Egyptian Arabic dataset generator. Produce
natural \"3ammeya masreyya\" (Cairene). Mix code-switching with English
where realistic. Vary length, emotion, and speaking style. Output JSON
lines only: {\"text\":..., \"normalized_text\":..., \"category\":...,
\"language_mix_pct\":..., \"emotion\":..., \"speaking_style\":...}.
"""


@dataclass
class Prompt:
    text: str
    normalized_text: str
    category: str
    language_mix_pct: int
    emotion: str
    speaking_style: str


def generate_prompts(count: int, seed: int | None = None) -> list[Prompt]:
    raise NotImplementedError("Wire to your LLM. See ssdp/prompts/llm_openai.py for an example.")
`;

const API_MAIN = `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from .deps import get_session
from ..db.models import Prompt, AudioSample, Review
from ..workers.synthesis import synthesize_prompt
from ..workers.qa import score_sample

app = FastAPI(title="S.S.D.P. — Synthetic Speech Data Pipeline")


class QueueIn(BaseModel):
    prompt_id: str
    voice_id: str


@app.get("/health")
def health(): return {"ok": True}


@app.post("/synthesize")
def queue(inp: QueueIn):
    synthesize_prompt.delay(inp.prompt_id, inp.voice_id)
    return {"queued": True}


@app.post("/qa/{sample_id}")
def qa(sample_id: str):
    score_sample.delay(sample_id)
    return {"queued": True}


@app.get("/stats")
def stats():
    with get_session() as s:
        return {
            "prompts": s.query(Prompt).count(),
            "samples": s.query(AudioSample).count(),
            "approved": s.query(Review).filter(Review.status == "approved").count(),
        }
`;

const API_DEPS = `from contextlib import contextmanager
from ..db.session import SessionLocal


@contextmanager
def get_session():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()
`;

const EXPORTERS = `"""Training-ready exporters.

Usage:
    python -m ssdp.exporters jsonl   --out data/dataset.jsonl
    python -m ssdp.exporters csv     --out data/dataset.csv
    python -m ssdp.exporters hf      --out data/hf/
    python -m ssdp.exporters whisper --out data/whisper.jsonl
"""
from __future__ import annotations
import argparse, csv, json, os, shutil
from sqlalchemy.orm import joinedload
from .api.deps import get_session
from .db.models import AudioSample, Prompt, QAResult, Review


def _approved_rows():
    with get_session() as s:
        rows = (
            s.query(Review)
            .filter(Review.status == "approved")
            .all()
        )
        out = []
        for r in rows:
            sample = s.get(AudioSample, r.sample_id)
            if not sample: continue
            prompt = s.get(Prompt, sample.prompt_id)
            qa = s.query(QAResult).filter_by(sample_id=sample.id).first()
            out.append({
                "id": sample.id,
                "audio": sample.storage_path,
                "text": r.edited_transcript or (qa.transcript if qa else None) or prompt.normalized_text,
                "prompt": prompt.text,
                "category": prompt.category,
                "duration": sample.duration_sec,
                "language_mix_pct": prompt.language_mix_pct,
                "quality": {
                    "score": qa.quality_score if qa else None,
                    "wer": qa.wer if qa else None,
                    "cer": qa.cer if qa else None,
                },
            })
        return out


def export_jsonl(out: str):
    rows = _approved_rows()
    with open(out, "w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\\n")
    print(f"wrote {len(rows)} rows -> {out}")


def export_csv(out: str):
    rows = _approved_rows()
    cols = ["id", "audio", "text", "prompt", "category", "duration", "language_mix_pct"]
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(cols)
        for r in rows: w.writerow([r.get(c, "") for c in cols])
    print(f"wrote {len(rows)} rows -> {out}")


def export_hf(out: str):
    """HuggingFace audiofolder layout: <out>/audio/*.mp3 + <out>/metadata.csv"""
    rows = _approved_rows()
    audio_dir = os.path.join(out, "audio"); os.makedirs(audio_dir, exist_ok=True)
    meta_path = os.path.join(out, "metadata.csv")
    with open(meta_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(["file_name", "transcription", "category", "duration"])
        for r in rows:
            fn = f"audio/{r['id']}.mp3"
            try: shutil.copy2(r["audio"], os.path.join(out, fn))
            except FileNotFoundError: continue
            w.writerow([fn, r["text"], r["category"], r["duration"] or 0])
    print(f"wrote HF audiofolder -> {out}")


def export_whisper(out: str):
    rows = _approved_rows()
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({
                "audio_filepath": r["audio"],
                "duration": r["duration"] or 0,
                "text": r["text"],
            }, ensure_ascii=False) + "\\n")
    print(f"wrote Whisper manifest -> {out}")


FORMATS = {"jsonl": export_jsonl, "csv": export_csv, "hf": export_hf, "whisper": export_whisper}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("format", choices=list(FORMATS))
    p.add_argument("--out", required=True)
    args = p.parse_args()
    FORMATS[args.format](args.out)


if __name__ == "__main__":
    main()
`;

const PYPROJECT = `[project]
name = "ssdp"
version = "0.1.0"
description = "Synthetic Speech Data Pipeline — Egyptian Arabic"
requires-python = ">=3.11"
`;

const GITIGNORE = `__pycache__/
*.pyc
.env
data/
.venv/
*.egg-info/
`;

const INIT = "";
const TEST_BACKEND = `import pytest
from ssdp.tts import get_backend


def test_registry_has_backends():
    eb = get_backend("elevenlabs")
    xb = get_backend("xtts")
    assert eb.name == "elevenlabs"
    assert xb.name == "xtts"


def test_unknown_backend():
    with pytest.raises(ValueError):
        get_backend("nope")
`;

const FILES: Record<string, string> = {
  "README.md": README,
  ".env.example": ENV_EXAMPLE,
  "requirements.txt": REQUIREMENTS,
  "docker-compose.yml": COMPOSE,
  "Dockerfile": DOCKERFILE,
  "pyproject.toml": PYPROJECT,
  ".gitignore": GITIGNORE,
  "ssdp/__init__.py": INIT,
  "ssdp/config.py": CONFIG_PY,
  "ssdp/api/__init__.py": INIT,
  "ssdp/api/main.py": API_MAIN,
  "ssdp/api/deps.py": API_DEPS,
  "ssdp/db/__init__.py": INIT,
  "ssdp/db/models.py": DB_MODELS,
  "ssdp/db/session.py": DB_SESSION,
  "ssdp/tts/__init__.py": TTS_INIT,
  "ssdp/tts/base.py": TTS_BASE,
  "ssdp/tts/elevenlabs.py": TTS_ELEVENLABS,
  "ssdp/tts/xtts.py": TTS_XTTS,
  "ssdp/qa/__init__.py": INIT,
  "ssdp/qa/asr.py": QA_ASR,
  "ssdp/qa/normalize.py": QA_NORMALIZE,
  "ssdp/workers/__init__.py": INIT,
  "ssdp/workers/celery_app.py": CELERY_APP,
  "ssdp/workers/synthesis.py": WORKER_SYNTH,
  "ssdp/workers/qa.py": WORKER_QA,
  "ssdp/prompts/__init__.py": INIT,
  "ssdp/prompts/generate.py": PROMPTS_GEN,
  "ssdp/exporters/__init__.py": EXPORTERS,
  "ssdp/exporters/__main__.py": "from . import main\nmain()\n",
  "tests/__init__.py": INIT,
  "tests/test_backends.py": TEST_BACKEND,
};

export async function buildPythonPipelineZip(): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(FILES)) {
    entries[`ssdp-pipeline/${path}`] = strToU8(content);
  }
  return zipSync(entries, { level: 6 });
}
