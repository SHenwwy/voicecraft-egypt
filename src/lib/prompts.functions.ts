import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CATEGORIES, LENGTH_TARGETS, type LengthBucket } from "./ssdp/categories";
import { normalizeArabic } from "./ssdp/normalize";
import { rng, pick } from "./ssdp/hash";
import { createClient } from "@supabase/supabase-js";

const PromptSchema = z.object({
  text: z.string().min(2).max(800),
  category: z.string(),
  length: z.enum(["short", "medium", "long"]),
  language_mix_pct: z.number().int().min(0).max(100),
  emotion: z.string(),
  speaking_style: z.string(),
});

const InputSchema = z.object({
  count: z.number().int().min(1).max(500),
  seed: z.number().int().optional(),
  categories: z.array(z.string()).optional(),
  lengthMix: z
    .object({ short: z.number(), medium: z.number(), long: z.number() })
    .optional(),
});

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function buildSystemPrompt(): string {
  return [
    "You are an expert Egyptian Arabic linguist and dataset curator.",
    "Generate authentic Egyptian Arabic (Cairene) utterances for fine-tuning a Speech-to-Text model.",
    "Hard rules:",
    "- Output ONLY the raw utterance text. NO numbering, NO labels, NO quotes, NO English translation.",
    "- Use Egyptian colloquial Arabic, NOT MSA. Drop final ta-marbuta sounds, use أ instead of ق where natural, use بـ/هـ verb prefixes (بيعمل، هاروح).",
    "- Include realistic STT challenges: hesitations (يعني، طب، أمم، اه)، repeated chars (ييجي، صحييح)، fillers, slang, code-switching with English nouns when natural for the category, names, numbers in Arabic or Eastern-Arabic digits, currencies (جنيه، ج)، addresses, phone numbers.",
    "- Avoid diacritics. Avoid formal MSA verbs.",
    "- One utterance per response, no extra commentary.",
  ].join("\n");
}

function buildUserPrompt(opts: {
  category: { id: string; label: string; description: string };
  length: LengthBucket;
  langMixPct: number;
  emotion: string;
  style: string;
}): string {
  const { wordsMin, wordsMax } = LENGTH_TARGETS[opts.length];
  return [
    `Category: ${opts.category.label} — ${opts.category.description}`,
    `Length: ${opts.length} (${wordsMin}-${wordsMax} words)`,
    `English code-switching: about ${opts.langMixPct}% of content words may be English (use Latin script for English words inline).`,
    `Emotion: ${opts.emotion}`,
    `Speaking style: ${opts.style}`,
    "Write ONE natural Egyptian Arabic utterance now:",
  ].join("\n");
}

async function callLovableAI(messages: { role: string; content: string }[]): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      temperature: 0.95,
    }),
  });
  if (res.status === 429) throw new Error("Rate limited by AI gateway");
  if (res.status === 402) throw new Error("AI credits exhausted");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const j: { choices?: { message?: { content?: string } }[] } = await res.json();
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

function estimateDurationSec(text: string): number {
  // ~2.7 syllables per second Arabic spoken; rough proxy by char count.
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1.0, +(chars / 14).toFixed(2));
}

export const generatePrompts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    const baseSeed = data.seed ?? Math.floor(Math.random() * 1e9);
    const rand = rng(baseSeed);
    const cats = data.categories?.length
      ? CATEGORIES.filter((c) => data.categories!.includes(c.id))
      : CATEGORIES;
    if (cats.length === 0) throw new Error("No categories selected");

    const mix = data.lengthMix ?? { short: 0.25, medium: 0.5, long: 0.25 };
    const lengthPool: LengthBucket[] = [];
    for (const k of ["short", "medium", "long"] as LengthBucket[]) {
      const n = Math.round((mix as Record<string, number>)[k] * data.count);
      for (let i = 0; i < n; i++) lengthPool.push(k);
    }
    while (lengthPool.length < data.count) lengthPool.push("medium");
    lengthPool.length = data.count;

    const inserted: { id: string; text: string; category: string }[] = [];
    let failures = 0;

    for (let i = 0; i < data.count; i++) {
      const cat = cats[i % cats.length];
      const length = lengthPool[i];
      const [lo, hi] = cat.langMixPctRange;
      const langMixPct = Math.round(lo + rand() * (hi - lo));
      const emotion = pick(rand, cat.emotions);
      const style = pick(rand, cat.styles);

      try {
        const raw = await callLovableAI([
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: buildUserPrompt({
              category: { id: cat.id, label: cat.label, description: cat.description },
              length,
              langMixPct,
              emotion,
              style,
            }),
          },
        ]);
        // strip surrounding quotes / leading bullet
        const text = raw
          .replace(/^["'`«»\u201C\u201D]+|["'`«»\u201C\u201D]+$/g, "")
          .replace(/^[-*•\d.\s)]+/, "")
          .trim();

        if (!text || text.length < 2) {
          failures++;
          continue;
        }

        const normalized = normalizeArabic(text);
        const tokens = normalized.split(/\s+/).filter(Boolean).length;

        const { data: row, error } = await sb
          .from("prompts")
          .insert({
            text,
            normalized_text: normalized,
            category: cat.id,
            difficulty: length === "long" ? "hard" : length === "short" ? "easy" : "medium",
            language_mix_pct: langMixPct,
            est_duration_sec: estimateDurationSec(text),
            speaking_style: style,
            emotion,
            token_count: tokens,
            length_bucket: length,
            seed: baseSeed + i,
            metadata: { generator: "gemini-2.5-flash", category_label: cat.label },
          })
          .select("id, text, category")
          .single();

        if (error) throw error;
        inserted.push(row);
      } catch (e) {
        failures++;
        await sb.from("audit_log").insert({
          entity: "prompts",
          action: "generation_failed",
          detail: { error: String(e), category: cat.id, index: i },
        });
      }
    }

    await sb.from("audit_log").insert({
      entity: "prompts",
      action: "batch_generated",
      detail: { count: inserted.length, failures, seed: baseSeed },
    });

    return { inserted: inserted.length, failures, seed: baseSeed };
  });

export const queueSynthesis = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ promptIds: z.array(z.string().uuid()).optional(), all: z.boolean().optional() }).parse(d)
  )
  .handler(async ({ data }) => {
    const sb = admin();
    let promptIds = data.promptIds ?? [];
    if (data.all) {
      const { data: rows } = await sb
        .from("prompts")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1000);
      promptIds = (rows ?? []).map((r: { id: string }) => r.id);
    }
    const { data: voices } = await sb.from("voices").select("id").eq("is_active", true);
    if (!voices?.length) throw new Error("No active voices");

    const jobs: Array<{ prompt_id: string; voice_id: string; fingerprint: string; params: Record<string, number> }> = [];
    for (const pid of promptIds) {
      const v = voices[Math.floor(Math.random() * voices.length)];
      // prosody jitter for synthetic-data diversity
      const params = {
        stability: +(0.35 + Math.random() * 0.4).toFixed(2),
        similarity_boost: +(0.65 + Math.random() * 0.25).toFixed(2),
        style: +(Math.random() * 0.5).toFixed(2),
        speed: +(0.92 + Math.random() * 0.18).toFixed(2),
      };
      const fp = `${pid}:${v.id}:${JSON.stringify(params)}`;
      jobs.push({ prompt_id: pid, voice_id: v.id, fingerprint: fp, params });
    }

    if (jobs.length === 0) return { queued: 0 };
    const { error } = await sb.from("synthesis_jobs").upsert(jobs, { onConflict: "fingerprint", ignoreDuplicates: true });
    if (error) throw error;
    await sb.from("audit_log").insert({ entity: "synthesis_jobs", action: "queued", detail: { count: jobs.length } });
    return { queued: jobs.length };
  });
