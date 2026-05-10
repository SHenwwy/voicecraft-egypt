import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const ReviewStatus = z.enum(["pending", "approved", "rejected", "needs_changes"]);

export const submitReview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sample_id: z.string().uuid(),
        status: ReviewStatus,
        edited_transcript: z.string().max(2000).optional(),
        reviewer_notes: z.string().max(1000).optional(),
        tags: z.array(z.string()).optional(),
        reviewer_id: z.string().max(80).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const sb = admin();
    // Upsert by sample_id (one active review per sample). Delete prior, insert fresh.
    await sb.from("reviews").delete().eq("sample_id", data.sample_id);
    const { error } = await sb.from("reviews").insert({
      sample_id: data.sample_id,
      status: data.status,
      edited_transcript: data.edited_transcript ?? null,
      reviewer_notes: data.reviewer_notes ?? null,
      tags: data.tags ?? [],
      reviewer_id: data.reviewer_id ?? "anonymous",
      reviewed_at: new Date().toISOString(),
    });
    if (error) throw error;
    await sb.from("audit_log").insert({
      entity: "reviews",
      entity_id: data.sample_id,
      action: `review_${data.status}`,
      detail: { reviewer: data.reviewer_id ?? "anonymous", tags: data.tags ?? [] },
    });
    return { ok: true };
  });

export const bulkReview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sample_ids: z.array(z.string().uuid()).min(1).max(500),
        status: ReviewStatus,
        reviewer_id: z.string().max(80).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const sb = admin();
    await sb.from("reviews").delete().in("sample_id", data.sample_ids);
    const rows = data.sample_ids.map((sid) => ({
      sample_id: sid,
      status: data.status,
      reviewer_id: data.reviewer_id ?? "anonymous",
      reviewed_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("reviews").insert(rows);
    if (error) throw error;
    await sb.from("audit_log").insert({
      entity: "reviews",
      action: `bulk_${data.status}`,
      detail: { count: rows.length, reviewer: data.reviewer_id ?? "anonymous" },
    });
    return { count: rows.length };
  });

export const autoApproveHighScores = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ minScore: z.number().int().min(0).max(100).default(85) }).parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: rows } = await sb
      .from("qa_results")
      .select("sample_id, quality_score, language_drift, flags")
      .gte("quality_score", data.minScore);
    const candidates = (rows ?? [])
      .filter((r) => !r.language_drift && !(Array.isArray(r.flags) && r.flags.includes("language_drift")))
      .map((r) => r.sample_id);
    if (!candidates.length) return { count: 0 };
    const { data: existing } = await sb.from("reviews").select("sample_id").in("sample_id", candidates);
    const have = new Set((existing ?? []).map((e) => e.sample_id));
    const ids = candidates.filter((id) => !have.has(id));
    if (!ids.length) return { count: 0 };
    const { error } = await sb.from("reviews").insert(
      ids.map((sid) => ({
        sample_id: sid,
        status: "approved",
        reviewer_id: "auto",
        reviewer_notes: `auto-approved (score ≥ ${data.minScore})`,
        reviewed_at: new Date().toISOString(),
      }))
    );
    if (error) throw error;
    await sb.from("audit_log").insert({
      entity: "reviews",
      action: "auto_approve",
      detail: { count: ids.length, minScore: data.minScore },
    });
    return { count: ids.length };
  });
