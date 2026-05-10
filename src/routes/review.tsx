import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { submitReview, bulkReview, autoApproveHighScores } from "@/lib/review.functions";
import { wordDiff } from "@/lib/ssdp/diff";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Waveform } from "@/components/ssdp/Waveform";
import {
  ArrowLeft,
  Check,
  X,
  AlertTriangle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Filter,
  Keyboard,
} from "lucide-react";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
  head: () => ({
    meta: [
      { title: "S.S.D.P. — Review" },
      { name: "description", content: "Human-in-the-loop review for synthetic speech samples." },
    ],
  }),
});

type ReviewItem = {
  id: string;
  prompt_id: string;
  storage_path: string;
  duration_sec: number | null;
  prompts: { text: string; category: string; language_mix_pct: number; emotion: string; speaking_style: string } | null;
  voices: { label: string; gender: string } | null;
  qa_results: Array<{ transcript: string | null; wer: number | null; cer: number | null; quality_score: number; flags: string[]; language_drift: boolean | null }>;
  reviews: Array<{ status: string; edited_transcript: string | null; reviewer_notes: string | null }>;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const audioUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/ssdp-audio/${path}`;

type Filter = "all" | "pending" | "flagged" | "high" | "low";

function ReviewPage() {
  const qc = useQueryClient();
  const submit = useServerFn(submitReview);
  const bulk = useServerFn(bulkReview);
  const auto = useServerFn(autoApproveHighScores);

  const [filter, setFilter] = useState<Filter>("pending");
  const [reviewerId, setReviewerId] = useState("you");
  const [cursor, setCursor] = useState(0);
  const [edited, setEdited] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const itemsQuery = useQuery({
    queryKey: ["reviewItems"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audio_samples")
        .select(
          "id, prompt_id, storage_path, duration_sec, prompts(text, category, language_mix_pct, emotion, speaking_style), voices(label, gender), qa_results(transcript, wer, cer, quality_score, flags, language_drift), reviews(status, edited_transcript, reviewer_notes)"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ReviewItem[];
    },
    refetchInterval: 6000,
  });

  const items = useMemo(() => {
    const all = itemsQuery.data ?? [];
    const filtered = all.filter((it) => {
      const qa = it.qa_results?.[0];
      const rv = it.reviews?.[0];
      if (filter === "pending") return !rv && !!qa;
      if (filter === "flagged") return !!qa && (qa.quality_score < 50 || qa.language_drift || (qa.flags?.length ?? 0) > 0);
      if (filter === "high") return !!qa && qa.quality_score >= 75;
      if (filter === "low") return !!qa && qa.quality_score < 50;
      return true;
    });
    return filtered;
  }, [itemsQuery.data, filter]);

  const current = items[cursor];

  // Reset cursor & form when filter changes / list resizes around cursor
  useEffect(() => {
    setCursor(0);
  }, [filter]);

  useEffect(() => {
    if (!current) {
      setEdited("");
      setNotes("");
      return;
    }
    const rv = current.reviews?.[0];
    setEdited(rv?.edited_transcript ?? current.qa_results?.[0]?.transcript ?? "");
    setNotes(rv?.reviewer_notes ?? "");
  }, [current?.id]);

  const submitMut = useMutation({
    mutationFn: async (status: "approved" | "rejected" | "needs_changes") => {
      if (!current) throw new Error("No item");
      return submit({
        data: {
          sample_id: current.id,
          status,
          edited_transcript: edited || undefined,
          reviewer_notes: notes || undefined,
          reviewer_id: reviewerId,
        },
      });
    },
    onSuccess: (_r, status) => {
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["reviewItems"] });
      // Advance cursor
      setCursor((c) => Math.min(items.length - 2, c));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMut = useMutation({
    mutationFn: async (status: "approved" | "rejected") => {
      if (selected.size === 0) throw new Error("Nothing selected");
      return bulk({ data: { sample_ids: Array.from(selected), status, reviewer_id: reviewerId } });
    },
    onSuccess: (r) => {
      toast.success(`Bulk ${r.count} reviewed`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["reviewItems"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoMut = useMutation({
    mutationFn: async () => auto({ data: { minScore: 85 } }),
    onSuccess: (r) => {
      toast.success(`Auto-approved ${r.count}`);
      qc.invalidateQueries({ queryKey: ["reviewItems"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Keyboard shortcuts
  const next = useCallback(() => setCursor((c) => Math.min(items.length - 1, c + 1)), [items.length]);
  const prev = useCallback(() => setCursor((c) => Math.max(0, c - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "a" || e.key === "A") submitMut.mutate("approved");
      else if (e.key === "r" || e.key === "R") submitMut.mutate("rejected");
      else if (e.key === "n" || e.key === "N") submitMut.mutate("needs_changes");
      else if (e.key === "ArrowRight" || e.key === "j") next();
      else if (e.key === "ArrowLeft" || e.key === "k") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitMut, next, prev]);

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const qa = current?.qa_results?.[0];
  const refText = current?.prompts?.text ?? "";
  const hypText = qa?.transcript ?? "";
  const diffOps = useMemo(() => (refText ? wordDiff(refText, hypText) : []), [refText, hypText]);

  return (
    <div className="min-h-screen">
      <Toaster theme="dark" position="top-right" />
      <header className="border-b border-border/50 backdrop-blur sticky top-0 z-10 bg-background/80">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="font-semibold tracking-tight">Review console</h1>
              <p className="text-xs text-muted-foreground">Human-in-the-loop QA · {items.length} in queue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-32 h-9"
              placeholder="reviewer"
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={() => autoMut.mutate()} disabled={autoMut.isPending}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Auto-approve ≥85
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="space-y-4">
          <Card className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Filter className="h-3.5 w-3.5" /> Filter
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["pending", "flagged", "high", "low", "all"] as Filter[]).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "secondary"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFilter(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Keyboard className="h-3.5 w-3.5" /> Shortcuts
            </div>
            <ul className="text-[11px] space-y-1 text-muted-foreground">
              <li><Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>N</Kbd> needs changes</li>
              <li><Kbd>←</Kbd>/<Kbd>→</Kbd> or <Kbd>J</Kbd>/<Kbd>K</Kbd> navigate</li>
            </ul>
          </Card>

          {selected.size > 0 && (
            <Card className="p-3 space-y-2">
              <div className="text-xs text-muted-foreground">{selected.size} selected</div>
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1 h-8" onClick={() => bulkMut.mutate("approved")}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="destructive" className="flex-1 h-8" onClick={() => bulkMut.mutate("rejected")}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </Card>
          )}

          <Card className="p-2 max-h-[60vh] overflow-y-auto">
            <ul className="space-y-0.5">
              {items.map((it, idx) => {
                const s = it.qa_results?.[0]?.quality_score ?? 0;
                const reviewed = it.reviews?.[0]?.status;
                return (
                  <li key={it.id}>
                    <button
                      onClick={() => setCursor(idx)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 ${idx === cursor ? "bg-secondary" : "hover:bg-secondary/50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(it.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3 w-3"
                      />
                      <span className={`tabular-nums w-7 text-[10px] ${s >= 75 ? "text-success" : s >= 50 ? "text-warning" : "text-destructive"}`}>
                        {s || "—"}
                      </span>
                      <span className="flex-1 truncate" dir="rtl">{it.prompts?.text ?? "—"}</span>
                      {reviewed && (
                        <span
                          className={`text-[9px] ${reviewed === "approved" ? "text-success" : reviewed === "rejected" ? "text-destructive" : "text-warning"}`}
                        >
                          ●
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {items.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">No items.</li>
              )}
            </ul>
          </Card>
        </aside>

        {/* Detail */}
        <section className="space-y-4">
          {!current && (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              Nothing to review for this filter. Generate prompts and run synthesis + QA on the home page.
            </Card>
          )}

          {current && (
            <>
              <Card className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {cursor + 1} / {items.length}
                    </Badge>
                    {current.prompts?.category && <Badge variant="secondary">{current.prompts.category}</Badge>}
                    {current.voices?.label && (
                      <Badge variant="outline">
                        {current.voices.label} · {current.voices.gender}
                      </Badge>
                    )}
                    {current.prompts && (
                      <span className="text-xs text-muted-foreground">
                        {current.prompts.emotion} · {current.prompts.speaking_style} · EN-mix {current.prompts.language_mix_pct}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="ghost" onClick={prev}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={next}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Waveform url={audioUrl(current.storage_path)} />
                <audio controls src={audioUrl(current.storage_path)} className="w-full h-9" />

                {qa && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <Metric label="Score" value={String(qa.quality_score)} tone={qa.quality_score >= 75 ? "success" : qa.quality_score >= 50 ? "warning" : "danger"} />
                    <Metric label="WER" value={Number(qa.wer ?? 0).toFixed(2)} />
                    <Metric label="CER" value={Number(qa.cer ?? 0).toFixed(2)} />
                    <Metric label="Duration" value={`${current.duration_sec ?? "—"}s`} />
                    <Metric label="Flags" value={qa.flags?.length ? qa.flags.join(", ") : "—"} />
                  </div>
                )}
              </Card>

              <Card className="p-5 space-y-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Reference (prompt)</div>
                <p dir="rtl" className="text-base leading-relaxed">{refText}</p>

                <div className="text-xs uppercase tracking-wide text-muted-foreground pt-2">Hypothesis (Scribe transcript)</div>
                <p dir="rtl" className="text-base leading-relaxed">
                  {diffOps.length === 0 && <span className="text-muted-foreground text-sm">no transcript</span>}
                  {diffOps.map((op, i) => {
                    if (op.type === "equal") return <span key={i}>{op.hyp} </span>;
                    if (op.type === "replace")
                      return (
                        <span key={i} className="bg-warning/15 text-warning rounded px-1 mx-0.5">
                          {op.hyp}
                        </span>
                      );
                    if (op.type === "insert")
                      return (
                        <span key={i} className="bg-destructive/15 text-destructive rounded px-1 mx-0.5">
                          +{op.hyp}
                        </span>
                      );
                    if (op.type === "delete")
                      return (
                        <span key={i} className="line-through text-muted-foreground/70 mx-0.5">
                          {op.ref}
                        </span>
                      );
                    return null;
                  })}
                </p>
              </Card>

              <Card className="p-5 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Edited transcript (gold label)</label>
                  <Textarea
                    dir="rtl"
                    rows={3}
                    value={edited}
                    onChange={(e) => setEdited(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Reviewer notes</label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button onClick={() => submitMut.mutate("approved")} disabled={submitMut.isPending}>
                    <Check className="h-4 w-4 mr-1.5" /> Approve <Kbd className="ml-2">A</Kbd>
                  </Button>
                  <Button variant="secondary" onClick={() => submitMut.mutate("needs_changes")} disabled={submitMut.isPending}>
                    <AlertTriangle className="h-4 w-4 mr-1.5" /> Needs changes <Kbd className="ml-2">N</Kbd>
                  </Button>
                  <Button variant="destructive" onClick={() => submitMut.mutate("rejected")} disabled={submitMut.isPending}>
                    <X className="h-4 w-4 mr-1.5" /> Reject <Kbd className="ml-2">R</Kbd>
                  </Button>
                  {current.reviews?.[0]?.status && (
                    <Badge variant="outline" className="ml-auto">
                      Last: {current.reviews[0].status}
                    </Badge>
                  )}
                </div>
              </Card>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  const cls = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-destructive" : "";
  return (
    <div className="rounded-md border border-border/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`px-1.5 py-0.5 rounded border border-border/60 bg-secondary/50 text-[10px] font-mono ${className}`}>
      {children}
    </kbd>
  );
}
