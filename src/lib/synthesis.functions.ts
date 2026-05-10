import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const BUCKET = "ssdp-audio";

async function elevenLabsTTS(
  text: string,
  voiceId: string,
  params: { stability: number; similarity_boost: number; style: number; speed: number }
): Promise<ArrayBuffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: params.stability,
          similarity_boost: params.similarity_boost,
          style: params.style,
          use_speaker_boost: true,
          speed: params.speed,
        },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}

function estimateDurationFromBytes(bytes: number): number {
  // 128 kbps = 16 KB/s
  return +(bytes / 16000).toFixed(2);
}

export const synthesisTick = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ batch: z.number().int().min(1).max(10).default(3) }).parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    const now = new Date().toISOString();

    // Lease N pending jobs (best-effort; concurrent ticks may overlap but unique fingerprint + audio insert idempotency mitigates)
    const { data: jobs, error: leaseErr } = await sb
      .from("synthesis_jobs")
      .select("id, prompt_id, voice_id, params, attempts, max_attempts")
      .eq("status", "pending")
      .lte("next_run_at", now)
      .order("created_at", { ascending: true })
      .limit(data.batch);
    if (leaseErr) throw leaseErr;
    if (!jobs?.length) return { processed: 0, succeeded: 0, failed: 0 };

    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      const { error: claimErr } = await sb
        .from("synthesis_jobs")
        .update({ status: "running", started_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq("id", job.id)
        .eq("status", "pending");
      if (claimErr) continue;

      try {
        const { data: prompt, error: pErr } = await sb
          .from("prompts")
          .select("text")
          .eq("id", job.prompt_id)
          .single();
        if (pErr || !prompt) throw new Error("prompt missing");

        const { data: voice, error: vErr } = await sb
          .from("voices")
          .select("voice_id")
          .eq("id", job.voice_id)
          .single();
        if (vErr || !voice) throw new Error("voice missing");

        const params = job.params as {
          stability: number;
          similarity_boost: number;
          style: number;
          speed: number;
        };

        const audio = await elevenLabsTTS(prompt.text, voice.voice_id, params);
        const bytes = audio.byteLength;
        const path = `${job.prompt_id}/${job.id}.mp3`;

        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
        if (upErr) throw upErr;

        // Heuristic flags
        const duration = estimateDurationFromBytes(bytes);
        const clipped = bytes < 4000; // suspiciously tiny

        const { data: sample, error: sErr } = await sb
          .from("audio_samples")
          .insert({
            prompt_id: job.prompt_id,
            voice_id: job.voice_id,
            job_id: job.id,
            storage_path: path,
            format: "mp3",
            duration_sec: duration,
            sample_rate: 44100,
            bytes,
            clipped,
            params,
          })
          .select("id")
          .single();
        if (sErr) throw sErr;

        await sb
          .from("synthesis_jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            audio_sample_id: sample.id,
            error: null,
          })
          .eq("id", job.id);

        succeeded++;
      } catch (e) {
        failed++;
        const attempts = job.attempts + 1;
        const isFinal = attempts >= job.max_attempts;
        const backoffMs = Math.min(60_000, 2 ** attempts * 1000);
        await sb
          .from("synthesis_jobs")
          .update({
            status: isFinal ? "failed" : "pending",
            error: String(e).slice(0, 500),
            next_run_at: new Date(Date.now() + backoffMs).toISOString(),
            finished_at: isFinal ? new Date().toISOString() : null,
          })
          .eq("id", job.id);
        await sb.from("audit_log").insert({
          entity: "synthesis_jobs",
          entity_id: job.id,
          action: isFinal ? "job_failed" : "job_retry",
          detail: { error: String(e).slice(0, 500), attempts },
        });
      }
    }

    return { processed: jobs.length, succeeded, failed };
  });

export const synthesisStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = admin();
  const states = ["pending", "running", "succeeded", "failed"] as const;
  const counts: Record<string, number> = {};
  for (const s of states) {
    const { count } = await sb.from("synthesis_jobs").select("*", { count: "exact", head: true }).eq("status", s);
    counts[s] = count ?? 0;
  }
  return counts;
});

export const getAudioUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(data.path, 3600);
    if (error) throw error;
    return { url: signed.signedUrl };
  });
