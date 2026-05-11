# S.S.D.P. — Synthetic Speech Data Pipeline

**Egyptian Arabic synthetic speech dataset pipeline for STT fine-tuning.**

Built for the Olimi AI case study. The bottleneck is rarely the model; it's the data. This pipeline produces training-ready `(text, audio)` pairs for Egyptian Arabic STT, with reviewer-in-the-loop QA and structured exports.

---

## 1. Pipeline architecture

Four stages, each independently observable, resumable, and externally configurable:

```
[1] Prompt generation  ->  [2] TTS synthesis  ->  [3] Automated QA + Review  ->  [4] Export
     (Gemini 2.5 Flash)      (ElevenLabs multi-       (Whisper/Scribe ASR +       (JSONL / CSV /
      diversified by         lingual v2, prosody      reviewer UI w/ diff,        HF audiofolder /
      category × length      jitter, deduped jobs)    bulk + auto-approve)        Whisper manifest)
      × emotion × style)
```

The runnable surface is a **web app** (TanStack Start + Lovable Cloud) that serves as both control plane and reviewer UI. Browse it at `/` and `/review`.

Long-running stages are handled as **async jobs** with a `synthesis_jobs` queue keyed by a deterministic `fingerprint` (`prompt_id:voice_id:params`) so retries and resubmissions are idempotent. Audit log entries track every batch.

---

## 2. Prompt generation

**Model:** `google/gemini-2.5-flash` via the Lovable AI gateway.
**Why:** strong multilingual + dialectal Arabic coverage, cheap enough to generate thousands of utterances, and tunable with a strict system prompt.

**Diversity is engineered, not hoped for.** Each generated utterance samples from:

- **10 categories** (`src/lib/ssdp/categories.ts`): food ordering, ride hailing, customer support, fintech, medical, marketplace, social media voice notes, heavy code-switching, emotional/expressive, numbers & addresses.
- **3 length buckets**: short (3–8 words), medium (9–18), long (19–35).
- **Per-category emotion & speaking-style pools** (e.g. `rushed`, `sarcastic`, `phone_call`, `voice_note`, `dictation`).
- **Per-category Arabic↔English code-switch range** (e.g. fintech 10–40%, voice notes 5–35%, heavy code-switching 30–60%).
- **Seeded RNG** (`src/lib/ssdp/hash.ts`) so batches are reproducible.

**System prompt enforces dialect realism:** Cairene colloquial only, no MSA verbs, no diacritics, includes hesitations (`يعني، طب، أمم`), filler repetition (`ييجي، صحييح`), Arabic & Eastern-Arabic digits, currency (`جنيه`), addresses, phone numbers. Output is a single utterance — no numbering, labels, or translation.

Each prompt is normalized (`src/lib/ssdp/normalize.ts` — alef/ya/ta-marbuta unification, tatweel & diacritic stripping, digit folding) and stored alongside its raw form, token count, estimated duration, seed, emotion, style, and length bucket.

---

## 3. TTS synthesis

**Backend:** ElevenLabs `eleven_multilingual_v2`.
**Why:** best-in-class Arabic prosody among hosted TTS at the time of writing; supports the voice settings we need to *intentionally* introduce variation.

**Prosody jitter for synthetic-data diversity** (`src/lib/prompts.functions.ts → queueSynthesis`):

| Param            | Range            |
|------------------|------------------|
| stability        | 0.35 – 0.75      |
| similarity_boost | 0.65 – 0.90      |
| style            | 0.0 – 0.5        |
| speed            | 0.92 – 1.10      |

Jobs are upserted by `fingerprint` (`onConflict: ignoreDuplicates`) — re-running the queue is safe and resumable. Voices are sampled from an `is_active` pool so you can rotate speakers without code changes.

Audio is stored in the public `ssdp-audio` bucket; `audio_samples` rows track `storage_path`, `duration_sec`, `bytes`, and link back to prompt + voice + job.

---

## 4. Automated QA → Review

**Why automated QA first:** human review is the most expensive thing in the pipeline. We surface scores so reviewers can spend time on the borderline samples.

For every sample, `qa_results` stores:

- **WER / CER** vs. the normalized prompt (after re-transcription with Whisper / ElevenLabs Scribe).
- **`quality_score`** (0–100) — composite signal.
- **`language_drift`** flag — fires when the ASR transcript contains unexpected non-Arabic content (TTS hallucinated English, or read the prompt as MSA).
- **`flags`** array — extensible bucket for category-specific issues (clipping, silence, etc.).

The reviewer UI at **`/review`** lets you:

- See the raw + normalized prompt, the ASR transcript, a token-level diff, the waveform, and an inline player.
- Approve / reject / mark "needs changes" with optional edited transcript and free-text notes.
- **Bulk-review** filtered selections.
- **Auto-approve** all samples with `quality_score ≥ N` that have no language-drift flag (`autoApproveHighScores` in `src/lib/review.functions.ts`). This is the lever that keeps the human in control while still scaling.

Every review writes to `audit_log` with reviewer id, status, and tags — so dataset provenance is queryable end-to-end.

---

## 5. Training-ready export

`/export` (and `previewExport` in `src/lib/export.functions.ts`) supports four formats — pick one based on your trainer:

| Format          | Shape                                                                   | Use case                              |
|-----------------|-------------------------------------------------------------------------|---------------------------------------|
| **JSONL**       | One object per line: `{id, audio, text, prompt, category, duration_sec, language_mix_pct, voice, gender, quality:{score,wer,cer}}` | General-purpose, our default          |
| **CSV**         | Flat columns incl. storage path + audio URL                             | Spreadsheet review, BI tools          |
| **HF audiofolder** | `file_name,transcription,...` — drop into `datasets.load_dataset("audiofolder", ...)` | Hugging Face Transformers fine-tuning |
| **Whisper manifest** | One JSON per line with `audio_filepath`, `duration`, `text`, `meta` | NVIDIA NeMo / Whisper fine-tuning     |

Only rows with `reviews.status = 'approved'` are exported. The `reviewer_text` (if a reviewer edited the transcript) overrides the model's normalized text — so the dataset always reflects the highest-confidence label available.

---

## 6. Runnable end-to-end

1. Open `/` → **Generate** → pick categories, count, seed → submit.
2. **Synthesize** → queues TTS jobs (idempotent).
3. **Review** at `/review` (or run **Auto-approve** with a score threshold).
4. **Export** at `/export` → preview + download.

---

## 7. Egyptian Arabic & TTS pitfalls this pipeline addresses

| Pitfall                                                         | Mitigation                                                    |
|------------------------------------------------------------------|---------------------------------------------------------------|
| TTS regresses to MSA on dialectal text                          | System prompt forbids MSA; `language_drift` flag in QA        |
| Diacritic / orthographic drift breaks WER                        | `normalizeArabic` before scoring, both prompt and transcript  |
| Code-switching (English nouns) is under-represented in datasets | Per-category `langMixPctRange`, dedicated `code_switching` cat |
| Single-voice overfitting                                        | Voice pool + per-job prosody jitter                           |
| Reading numbers/dates/phones inconsistently                      | Dedicated `numbers_addresses` category with dictation style   |
| Synthetic data → model learns TTS artifacts, not real speech    | Reviewer-in-the-loop, quality threshold gating, length/emotion/style stratification, audit log to trace any sample back to its generation params |
| Long-running synthesis fails midway                              | Idempotent fingerprinted jobs, batched upserts, audit log     |

---

## 8. Trade-offs & limitations

- **TTS is still TTS.** Even with prosody jitter, models trained *only* on synthetic Egyptian audio will overfit to ElevenLabs acoustics. Treat this dataset as a **supplement** to real recordings, not a replacement. The export schema makes mixing easy.
- **ASR-based QA is circular for some failure modes.** If Whisper itself can't handle Egyptian, low scores may reflect ASR weakness, not TTS weakness. We mitigate by normalizing both sides and surfacing scores to humans rather than auto-rejecting.
- **No speaker diarization / VAD trimming yet.** Cloud TTS output is generally clean, but a real production pipeline would add silence trimming + loudness normalization.
- **The reviewer UI is single-tenant.** No multi-reviewer agreement scoring (Cohen's κ) — easy add given the schema (multiple `reviews` per `sample_id`).
- **Generation cost is non-trivial at scale.** A self-hosted TTS backend (e.g. XTTS-v2) would be the answer for >10k-sample runs.

---

## 9. Repository layout

```
src/
  routes/
    index.tsx           # Generate / Synthesize / Export dashboard
    review.tsx          # Reviewer UI
  lib/
    prompts.functions.ts    # Gemini-backed prompt generator + synthesis queue
    synthesis.functions.ts  # ElevenLabs synthesis worker
    qa.functions.ts         # Whisper/Scribe re-transcription + scoring
    review.functions.ts     # Submit / bulk / auto-approve
    export.functions.ts     # JSONL / CSV / HF / Whisper exporters
    ssdp/
      categories.ts     # 10 Egyptian Arabic prompt categories
      normalize.ts      # Arabic text normalization
      diff.ts           # Token-level diff for review UI
      hash.ts           # Seeded RNG
  components/ssdp/Waveform.tsx
  integrations/supabase/  # Auto-generated, do not edit
```

---

## 10. Sample dataset

A small sample (a few dozen approved rows) lives at the bottom of the **Export** tab — click any format, hit *Preview*, and copy/save. The same rows are what would feed `datasets.load_dataset("audiofolder", ...)` 
