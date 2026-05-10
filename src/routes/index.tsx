import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generatePrompts } from "@/lib/prompts.functions";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/ssdp/categories";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loader2, Sparkles, Database, Mic, ListChecks, Download } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "S.S.D.P. — Synthetic Speech Data Pipeline" },
      {
        name: "description",
        content:
          "Egyptian Arabic synthetic speech dataset pipeline: prompt generation, TTS synthesis, automated QA, human review, and training-ready export.",
      },
    ],
  }),
});

type Prompt = {
  id: string;
  text: string;
  normalized_text: string;
  category: string;
  length_bucket: string;
  language_mix_pct: number;
  emotion: string;
  speaking_style: string;
  est_duration_sec: number;
  token_count: number;
  created_at: string;
};

function Index() {
  const qc = useQueryClient();
  const generate = useServerFn(generatePrompts);
  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState<string>("");

  const promptsQuery = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Prompt[];
    },
    refetchInterval: 5000,
  });

  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const [{ count: prompts }, { count: samples }, { count: reviews }] = await Promise.all([
        supabase.from("prompts").select("*", { count: "exact", head: true }),
        supabase.from("audio_samples").select("*", { count: "exact", head: true }),
        supabase.from("reviews").select("*", { count: "exact", head: true }).eq("status", "approved"),
      ]);
      return { prompts: prompts ?? 0, samples: samples ?? 0, approved: reviews ?? 0 };
    },
    refetchInterval: 5000,
  });

  const genMut = useMutation({
    mutationFn: async () => {
      return generate({
        data: {
          count,
          seed: seed ? Number(seed) : undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`Generated ${res.inserted} prompts (seed ${res.seed}, ${res.failures} failed)`);
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen">
      <Toaster theme="dark" position="top-right" />
      <header className="border-b border-border/50 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center font-bold text-primary-foreground">
              S
            </div>
            <div>
              <h1 className="font-semibold tracking-tight">S.S.D.P.</h1>
              <p className="text-xs text-muted-foreground">Synthetic Speech Data Pipeline · Egyptian Arabic</p>
            </div>
          </div>
          <Badge variant="outline" className="border-accent/40 text-accent">
            Stage 1 · live
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 space-y-10">
        {/* Hero */}
        <section className="grid lg:grid-cols-2 gap-8 items-center">
          <div className="space-y-4">
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
              Production-grade synthetic speech data — for{" "}
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Egyptian Arabic
              </span>
              .
            </h2>
            <p className="text-muted-foreground max-w-xl">
              An end-to-end pipeline that generates dialect-aware prompts, synthesizes audio with diverse voices,
              auto-scores quality, and exports training-ready manifests for STT fine-tuning.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {["Franco-Arabic", "Code-switching", "Slang", "Numbers", "Sarcasm", "Voice notes"].map((t) => (
                <Badge key={t} variant="secondary" className="bg-secondary/60">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          <Card className="p-6 glass">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-accent" />
              <h3 className="font-medium">Generate prompts</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Count (1–500)</label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Seed (optional)</label>
                <Input
                  type="number"
                  placeholder="random"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </div>
            </div>
            <Button
              className="w-full mt-4"
              disabled={genMut.isPending}
              onClick={() => genMut.mutate()}
            >
              {genMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>Generate {count} prompts</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Uses Lovable AI (Gemini 2.5 Flash). Each prompt is sampled across {CATEGORIES.length} domains with
              randomized length, emotion, style, and code-switching ratio.
            </p>
          </Card>
        </section>

        {/* Stats */}
        <section className="grid sm:grid-cols-3 gap-4">
          <StatCard icon={<Database className="h-4 w-4" />} label="Prompts" value={statsQuery.data?.prompts ?? 0} />
          <StatCard icon={<Mic className="h-4 w-4" />} label="Audio samples" value={statsQuery.data?.samples ?? 0} />
          <StatCard
            icon={<ListChecks className="h-4 w-4" />}
            label="Approved for export"
            value={statsQuery.data?.approved ?? 0}
          />
        </section>

        {/* Pipeline */}
        <section>
          <h3 className="font-semibold mb-3">Pipeline stages</h3>
          <div className="grid md:grid-cols-5 gap-3">
            {[
              { label: "Prompts", state: "live", desc: "LLM-driven EG-Arabic generation" },
              { label: "Synthesis", state: "scaffolded", desc: "ElevenLabs multilingual v2" },
              { label: "Auto QA", state: "scaffolded", desc: "Scribe v2 + WER/CER" },
              { label: "Review", state: "scaffolded", desc: "Waveform + diff UI" },
              { label: "Export", state: "scaffolded", desc: "JSONL · CSV · HF · Whisper" },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{s.label}</span>
                  <Badge
                    variant="outline"
                    className={
                      s.state === "live"
                        ? "border-success/40 text-success"
                        : "border-warning/30 text-warning"
                    }
                  >
                    {s.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Prompt list */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent prompts</h3>
            <span className="text-xs text-muted-foreground">
              {promptsQuery.data?.length ?? 0} shown · auto-refresh
            </span>
          </div>
          <div className="space-y-2">
            {promptsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {promptsQuery.data?.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No prompts yet. Click <span className="text-foreground">Generate</span> above to seed the dataset.
              </Card>
            )}
            {promptsQuery.data?.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <p dir="rtl" className="text-base leading-relaxed flex-1">
                    {p.text}
                  </p>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="secondary">{p.category}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {p.length_bucket} · {p.token_count}w · ~{p.est_duration_sec}s
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Tag>EN-mix {p.language_mix_pct}%</Tag>
                  <Tag>{p.emotion}</Tag>
                  <Tag>{p.speaking_style}</Tag>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t border-border/50 pt-8">
          <div className="flex items-start gap-3 text-sm">
            <Download className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              Stage 1 (prompt generation) is live. Stages 2–5 (TTS synthesis, automated QA, review dashboard, export)
              are scaffolded in the schema and require additional implementation passes — they are stubbed as a job
              queue plus storage bucket and ready to be wired to ElevenLabs and Whisper. The full Python +
              Celery + Next.js monorepo (the case-study deliverable) will be generated as a downloadable zip in a
              follow-up turn.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight mt-1">{value.toLocaleString()}</div>
    </Card>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground">
      {children}
    </span>
  );
}
