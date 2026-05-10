import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildPythonPipelineZip } from "./ssdp/python-pipeline";

const FormatEnum = z.enum(["jsonl", "csv", "hf", "whisper"]);

type Row = {
  id: string;
  storage_path: string;
  duration_sec: number | null;
  bytes: number | null;
  prompt: string;
  normalized: string;
  category: string;
  language_mix_pct: number;
  voice_label: string | null;
  voice_gender: string | null;
  reviewer_text: string | null;
  quality_score: number | null;
  wer: number | null;
  cer: number | null;
  audio_url: string;
};

async function loadApprovedRows(): Promise<Row[]> {
  const supaUrl = process.env.SUPABASE_URL!;
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select(
      `id, status, edited_transcript,
       audio_samples!inner(
         id, storage_path, duration_sec, bytes,
         prompts!inner(text, normalized_text, category, language_mix_pct),
         voices(label, gender),
         qa_results(quality_score, wer, cer, transcript)
       )`,
    )
    .eq("status", "approved")
    .limit(5000);
  if (error) throw error;
  const rows: Row[] = [];
  for (const r of (data ?? []) as any[]) {
    const s = r.audio_samples;
    if (!s) continue;
    const qa = Array.isArray(s.qa_results) ? s.qa_results[0] : s.qa_results;
    rows.push({
      id: s.id,
      storage_path: s.storage_path,
      duration_sec: s.duration_sec,
      bytes: s.bytes,
      prompt: s.prompts?.text ?? "",
      normalized: s.prompts?.normalized_text ?? "",
      category: s.prompts?.category ?? "unknown",
      language_mix_pct: s.prompts?.language_mix_pct ?? 0,
      voice_label: s.voices?.label ?? null,
      voice_gender: s.voices?.gender ?? null,
      reviewer_text: r.edited_transcript ?? qa?.transcript ?? null,
      quality_score: qa?.quality_score ?? null,
      wer: qa?.wer ?? null,
      cer: qa?.cer ?? null,
      audio_url: `${supaUrl}/storage/v1/object/public/ssdp-audio/${s.storage_path}`,
    });
  }
  return rows;
}

function toJsonl(rows: Row[]): string {
  return rows
    .map((r) =>
      JSON.stringify({
        id: r.id,
        audio: r.audio_url,
        text: r.reviewer_text || r.normalized,
        prompt: r.prompt,
        category: r.category,
        duration_sec: r.duration_sec,
        language_mix_pct: r.language_mix_pct,
        voice: r.voice_label,
        gender: r.voice_gender,
        quality: { score: r.quality_score, wer: r.wer, cer: r.cer },
      }),
    )
    .join("\n");
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[]): string {
  const cols = [
    "id",
    "audio_url",
    "storage_path",
    "text",
    "prompt",
    "category",
    "duration_sec",
    "language_mix_pct",
    "voice",
    "gender",
    "quality_score",
    "wer",
    "cer",
  ];
  const head = cols.join(",");
  const body = rows
    .map((r) =>
      [
        r.id,
        r.audio_url,
        r.storage_path,
        r.reviewer_text || r.normalized,
        r.prompt,
        r.category,
        r.duration_sec,
        r.language_mix_pct,
        r.voice_label,
        r.voice_gender,
        r.quality_score,
        r.wer,
        r.cer,
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");
  return `${head}\n${body}`;
}

// HuggingFace audiofolder-style metadata.csv (file_name, transcription, ...)
function toHuggingFace(rows: Row[]): string {
  const head = "file_name,transcription,category,duration,language_mix_pct,voice,gender";
  const body = rows
    .map((r) =>
      [
        `${r.id}.mp3`,
        r.reviewer_text || r.normalized,
        r.category,
        r.duration_sec ?? "",
        r.language_mix_pct,
        r.voice_label ?? "",
        r.voice_gender ?? "",
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");
  return `${head}\n${body}`;
}

// Whisper-style manifest: one JSON per line with audio_filepath, duration, text
function toWhisper(rows: Row[]): string {
  return rows
    .map((r) =>
      JSON.stringify({
        audio_filepath: r.audio_url,
        duration: r.duration_sec ?? 0,
        text: r.reviewer_text || r.normalized,
        meta: {
          id: r.id,
          category: r.category,
          language_mix_pct: r.language_mix_pct,
          voice: r.voice_label,
        },
      }),
    )
    .join("\n");
}

export const previewExport = createServerFn({ method: "GET" })
  .inputValidator((d: { format: z.infer<typeof FormatEnum> }) =>
    z.object({ format: FormatEnum }).parse(d),
  )
  .handler(async ({ data }) => {
    const rows = await loadApprovedRows();
    let content = "";
    let mime = "text/plain";
    let ext = "txt";
    switch (data.format) {
      case "jsonl":
        content = toJsonl(rows);
        mime = "application/x-ndjson";
        ext = "jsonl";
        break;
      case "csv":
        content = toCsv(rows);
        mime = "text/csv";
        ext = "csv";
        break;
      case "hf":
        content = toHuggingFace(rows);
        mime = "text/csv";
        ext = "csv";
        break;
      case "whisper":
        content = toWhisper(rows);
        mime = "application/x-ndjson";
        ext = "jsonl";
        break;
    }
    return {
      count: rows.length,
      totalDuration: rows.reduce((s, r) => s + (r.duration_sec ?? 0), 0),
      content,
      mime,
      ext,
      filename: `ssdp-${data.format}-${new Date().toISOString().slice(0, 10)}.${ext}`,
    };
  });

export const exportStats = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("status")
    .limit(10000);
  if (error) throw error;
  const counts = { approved: 0, rejected: 0, needs_changes: 0, pending: 0 } as Record<string, number>;
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
});

export const downloadPythonPipeline = createServerFn({ method: "GET" }).handler(async () => {
  const zip = await buildPythonPipelineZip();
  // base64 so it can be transported through JSON
  const b64 = Buffer.from(zip).toString("base64");
  return { base64: b64, filename: "ssdp-pipeline.zip", bytes: zip.length };
});
