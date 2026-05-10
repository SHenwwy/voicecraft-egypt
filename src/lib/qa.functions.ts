import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { wer, cer, normalizeArabic } from "./ssdp/normalize";

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const BUCKET = "ssdp-audio";

async function transcribeMp3(buf: ArrayBuffer): Promise<{ text: string; words?: unknown }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
  fd.append("model_id", "scribe_v2");
  fd.append("language_code", "ara");
  fd.append("tag_audio_events", "false");
  fd.append("diarize", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Scribe ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function detectLanguageDrift(transcript: string, expectedLangMixPct: number): boolean {
  // Drift = transcript has very little Arabic script when prompt should be mostly Arabic.
  const arabicChars = (transcript.match(/[\u0600-\u06FF]/g) ?? []).length;
  const totalChars = transcript.replace(/\s/g, "").length || 1;
  const arabicRatio = arabicChars / totalChars;
  const expectedArabic = 1 - expectedLangMixPct / 100;
  return arabicRatio < expectedArabic - 0.35;
}

function scoreQuality(opts: {
  werVal: number;
  cerVal: number;
  drift: boolean;
  clipped: boolean;
  durationSec: number | null;
  estDuration: number;
}): { score: number; flags: string[] } {
  const flags: string[] = [];
  // Base from WER (50%) + CER (30%)
  let score = 100 - opts.werVal * 50 - opts.cerVal * 30;
  if (opts.drift) {
    flags.push("language_drift");
    score -= 25;
  }
  if (opts.clipped) {
    flags.push("clipped");
    score -= 10;
  }
  if (opts.durationSec) {
    const ratio = opts.durationSec / Math.max(0.5, opts.estDuration);
    if (ratio < 0.4) {
      flags.push("too_short");
      score -= 20;
    } else if (ratio > 2.5) {
      flags.push("too_long");
      score -= 10;
    }
  }
  if (opts.werVal > 0.5) flags.push("high_wer");
  if (opts.cerVal > 0.4) flags.push("high_cer");
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags };
}

export const qaTick = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ batch: z.number().int().min(1).max(5).default(2) }).parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    // Pick samples without QA yet
    const { data: samples, error } = await sb
      .from("audio_samples")
      .select("id, prompt_id, storage_path, duration_sec, clipped, prompts(text, language_mix_pct, est_duration_sec)")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    if (!samples?.length) return { processed: 0, succeeded: 0, failed: 0 };

    const ids = samples.map((s) => s.id);
    const { data: existing } = await sb.from("qa_results").select("sample_id").in("sample_id", ids);
    const done = new Set((existing ?? []).map((e) => e.sample_id));
    const todo = samples.filter((s) => !done.has(s.id)).slice(0, data.batch);
    if (!todo.length) return { processed: 0, succeeded: 0, failed: 0 };

    let succeeded = 0;
    let failed = 0;

    for (const s of todo) {
      try {
        const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(s.storage_path);
        if (dlErr || !file) throw new Error(`download: ${dlErr?.message ?? "no file"}`);
        const buf = await file.arrayBuffer();
        const result = await transcribeMp3(buf);
        const transcript = (result.text ?? "").trim();

        const prompt = s.prompts as unknown as {
          text: string;
          language_mix_pct: number;
          est_duration_sec: number;
        } | null;
        const refText = prompt?.text ?? "";
        const werVal = +wer(refText, transcript).toFixed(4);
        const cerVal = +cer(refText, transcript).toFixed(4);
        const drift = detectLanguageDrift(transcript, prompt?.language_mix_pct ?? 0);
        const { score, flags } = scoreQuality({
          werVal,
          cerVal,
          drift,
          clipped: !!s.clipped,
          durationSec: s.duration_sec ? Number(s.duration_sec) : null,
          estDuration: prompt?.est_duration_sec ?? 0,
        });

        const { error: insErr } = await sb.from("qa_results").insert({
          sample_id: s.id,
          transcript,
          wer: werVal,
          cer: cerVal,
          quality_score: score,
          language_drift: drift,
          flags,
          notes: `ref_norm: ${normalizeArabic(refText).slice(0, 80)}`,
        });
        if (insErr) throw insErr;
        succeeded++;
      } catch (e) {
        failed++;
        await sb.from("audit_log").insert({
          entity: "qa_results",
          entity_id: s.id,
          action: "qa_failed",
          detail: { error: String(e).slice(0, 500) },
        });
      }
    }

    return { processed: todo.length, succeeded, failed };
  });

export const qaStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = admin();
  const [{ count: totalSamples }, { count: qaDone }, { data: scores }] = await Promise.all([
    sb.from("audio_samples").select("*", { count: "exact", head: true }),
    sb.from("qa_results").select("*", { count: "exact", head: true }),
    sb.from("qa_results").select("quality_score, wer, cer"),
  ]);
  const arr = scores ?? [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    totalSamples: totalSamples ?? 0,
    qaDone: qaDone ?? 0,
    qaPending: Math.max(0, (totalSamples ?? 0) - (qaDone ?? 0)),
    avgScore: +avg(arr.map((r) => r.quality_score ?? 0)).toFixed(1),
    avgWer: +avg(arr.map((r) => Number(r.wer ?? 0))).toFixed(3),
    avgCer: +avg(arr.map((r) => Number(r.cer ?? 0))).toFixed(3),
    passing: arr.filter((r) => (r.quality_score ?? 0) >= 75).length,
    flagged: arr.filter((r) => (r.quality_score ?? 0) < 50).length,
  };
});
