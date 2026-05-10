
# S.S.D.P. — Synthetic Speech Data Pipeline

A hybrid delivery: a working enterprise-grade review dashboard you can demo immediately in Lovable, plus a complete production Python monorepo zipped for download and `docker-compose up`.

---

## Part A — Live System (in this Lovable project)

End-to-end Egyptian Arabic synthetic speech pipeline running on TanStack Start + Lovable Cloud + ElevenLabs + Lovable AI Gateway. Generates 110 (text, audio) pairs by default, runs automated QA, and exposes a professional review dashboard.

### Stack
- TanStack Start (React 19, TS, Tailwind, shadcn/ui)
- Lovable Cloud (Postgres, Storage, Auth) — backend persistence
- Lovable AI Gateway (Gemini) — Egyptian Arabic prompt generation + Whisper-style validation prompt
- ElevenLabs Multilingual v2 — TTS synthesis (Arabic voices)
- WaveSurfer.js — waveform visualization
- Recharts — analytics dashboard

### Pipeline stages (server functions + background jobs via DB-backed job queue)

**Stage 1 — Prompt Generation** (`src/lib/prompts.functions.ts`)
- LLM-driven Egyptian Arabic prompt generator with configurable categories (food ordering, transport, customer support, fintech, medical, marketplace, social, sarcasm, emotional, code-switching).
- Configurable: dataset size, length distribution (short/medium/long), diversity, deterministic seed, language-mix %.
- Explicitly handles dialect challenges: Franco-Arabic, Arabic numerals, English mixing, slang, missing diacritics, repeated letters, contractions, fillers (يعني، طب، أمم).
- Output: rows in `prompts` table + JSONL manifest in Storage with metadata (category, difficulty, lang_mix, est_duration, noise_level, style, emotion, token_count).

**Stage 2 — TTS Synthesis** (`src/lib/synthesis.functions.ts` + cron-driven worker)
- Job queue table `synthesis_jobs` with states: pending → running → done/failed, retry counts, exponential backoff, deterministic IDs (sha256 of prompt+voice+params).
- Calls ElevenLabs `eleven_multilingual_v2` with multiple voices (male/female), randomized stability/style/speed for diversity.
- Stores WAV in Lovable Cloud Storage, caches by deterministic ID.
- Auto-flags clipped/silent/too-short/too-long audio via post-synthesis decode check.

**Stage 3 — Automated QA** (`src/lib/qa.functions.ts`)
- After synthesis, runs validation: duration, est. silence ratio, peak/clipping, simple SNR proxy from buffer stats.
- Transcribes via ElevenLabs Scribe (`scribe_v2`) — Arabic STT.
- Computes CER/WER vs original prompt; assigns quality_score 0–100; flags hallucination, skipped words, robotic artifacts (heuristic), language drift.
- Writes to `qa_results` table.

**Stage 4 — Human Review Dashboard** (`/review`)
- Table view with pagination, filters (quality score, duration, category, voice, lang-mix, status, flags), full-text search on transcript.
- Detail drawer: WaveSurfer waveform, audio player, original transcript, Whisper transcript (diff-highlighted), edit transcript, approve/reject, tag issues, keyboard shortcuts (J/K nav, A approve, R reject, E edit, Space play).
- Bulk actions: approve all above score X, reject all flagged.
- Modern dark UI, responsive.

**Stage 5 — Export** (`/export`)
- Exports approved samples as JSONL, CSV, HuggingFace `datasets`-compatible JSONL, and Whisper manifest format.
- Each row: audio_path (signed URL or relative), transcript, normalized_transcript, duration, sample_rate, quality_score, reviewer_status, metadata, dataset_version.
- Dataset versioning table; export creates an immutable snapshot.

### Pages
- `/` — Landing with pipeline diagram + live stats (total prompts, hours synthesized, accepted ratio).
- `/pipeline` — Run controls: configure category mix, size, seed, kick off generation; live progress.
- `/jobs` — Job monitor: running/failed/queued, retry buttons, logs.
- `/review` — Review dashboard (above).
- `/analytics` — Recharts: category distribution, duration histogram, quality score distribution, accept/reject ratio, word frequency, hours by voice.
- `/exports` — Versioned export snapshots, download links.

### Database (Lovable Cloud / Postgres)
`prompts`, `voices`, `synthesis_jobs`, `audio_samples`, `qa_results`, `reviews`, `dataset_versions`, `export_snapshots`, `audit_log`. RLS enabled; reviewer role table separate from profiles.

### Observability
- `audit_log` table records every state transition.
- Structured JSON logs in server functions.
- `/jobs` page surfaces failures, retry counts, durations.

### Required secret
- `ELEVENLABS_API_KEY` (will request via add_secret after you confirm)
- `LOVABLE_API_KEY` is auto-injected for AI Gateway.

---

## Part B — Downloadable Python Monorepo (zip in /mnt/documents/)

Generated as `ssdp-pipeline.zip` containing the full production codebase you'd run locally with `docker-compose up`. The Lovable preview cannot execute it, but the code is complete and runnable on your machine.

### Structure
```text
ssdp/
├── docker-compose.yml         # postgres, redis, api, worker, frontend
├── .env.example
├── README.md                  # architecture, model choices, EG-Arabic
│                              # challenges, trade-offs, setup, API docs
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app
│   │   ├── api/               # routers: prompts, synthesis, qa, review, export
│   │   ├── core/              # config (pydantic-settings), logging, db
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/
│   │   │   ├── prompts/       # LLM prompt generator + EG-AR templates
│   │   │   ├── tts/
│   │   │   │   ├── base.py    # TTSBackend protocol
│   │   │   │   ├── elevenlabs.py
│   │   │   │   └── xtts.py    # XTTS-v2 pluggable backend
│   │   │   ├── qa/            # whisper/faster-whisper + librosa metrics
│   │   │   └── export/        # jsonl/csv/hf/whisper formats
│   │   └── utils/             # ffmpeg, hashing, retries, checkpointing
├── workers/
│   ├── celery_app.py          # Celery + Redis broker
│   ├── tasks/                 # synth_task, qa_task, export_task
│                              # exponential backoff, checkpoint, resume
├── frontend/                  # Next.js 14 + TS + Tailwind + shadcn
│   ├── app/                   # dashboards mirroring the Lovable UI
│   └── components/            # WaveSurfer, tables, charts
├── data/                      # sample prompts + manifests + sample wavs
├── manifests/
├── tests/                     # pytest: prompt, manifest, audio, export
├── docker/                    # Dockerfiles per service
└── docs/                      # architecture diagrams (mermaid), API.md
```

### Highlights
- **Async/resumable**: Celery tasks with `acks_late`, idempotent deterministic IDs, checkpoint table, `--resume` CLI.
- **Configuration**: `pydantic-settings` reading `.env`; per-stage YAML overrides.
- **TTS abstraction**: `TTSBackend` protocol; ElevenLabs and XTTS-v2 implementations selectable via `TTS_BACKEND=elevenlabs|xtts`.
- **QA**: faster-whisper for transcription, librosa for SNR/silence/clipping, jiwer for WER/CER, pyannote optional toggle.
- **Audio normalization**: ffmpeg loudnorm + sample-rate conversion (16k mono for STT training).
- **Edge cases**: text normalizer strips emojis/URLs, expands numbers (Arabic + English), normalizes Franco-Arabic, collapses repeated chars.
- **Synthetic-data risk mitigation**: voice rotation, prosody jitter, optional noise injection (RIRs/MUSAN-style), category balancing, duration balancing, transcript normalization for training.
- **Tests**: pytest suite covering prompt schema, manifest integrity, audio validation, export round-trip, retry logic.
- **Observability**: structlog JSON logs, Prometheus `/metrics`, Flower for Celery.
- **Single-command run**: `cp .env.example .env && docker compose up --build`.

### README sections
Architecture (with mermaid diagrams), Model Choices & rationale, Egyptian Arabic Challenges (deep-dive), Quality Problems (synthetic bias, pronunciation artifacts, overfitting, dialect mismatch), Trade-offs, Setup (Docker + local), Running workers, API docs (OpenAPI + curl examples), Dataset versioning, Bonus features.

---

## Technical details

### Build order (live system)
1. Enable Lovable Cloud, create schema migrations for all tables + RLS + roles.
2. Request `ELEVENLABS_API_KEY` secret.
3. Server functions: prompts → synthesis → qa → export, plus a `tick` cron-style runner endpoint.
4. UI: design system (dark, modern, enterprise feel — Inter + Space Grotesk, deep navy + electric accent), pages, components, WaveSurfer, Recharts.
5. Seed 110 sample prompts and run end-to-end so the demo has real data.
6. Generate Python monorepo into `/tmp/ssdp/`, zip to `/mnt/documents/ssdp-pipeline.zip`, surface via `<lov-artifact>`.

### Constraints / honest notes
- The **live system** runs entirely in TanStack Start server functions on Cloudflare Workers. Long-running synthesis is implemented as a DB-backed job queue ticked by a small client-side runner on the `/jobs` page (and a server tick endpoint), not Celery — Workers cannot run Celery/Redis. This still gives you async, retries, resumability, checkpointing, and observability. The Python zip has the "real" Celery+Redis implementation.
- ElevenLabs is used for both TTS and Arabic STT validation in the live system (Scribe v2). The Python zip uses faster-whisper locally.
- `pyannote`, `librosa`, `torchaudio`, `ffmpeg`, `Coqui XTTS-v2` only exist in the downloadable zip — they cannot run in Workers.

### Scope size
This is a large build. After you approve the plan I'll execute it in a single pass, but expect many file writes. The downloadable zip alone is ~40 files.
