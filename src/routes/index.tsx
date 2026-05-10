import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { generatePrompts, queueSynthesis } from "@/lib/prompts.functions";
import { synthesisTick, synthesisStats } from "@/lib/synthesis.functions";
import { qaTick, qaStats } from "@/lib/qa.functions";
import { previewExport, downloadPythonPipeline } from "@/lib/export.functions";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/ssdp/categories";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loader2, Sparkles, Database, Mic, ListChecks, Download, Play, Cpu, AudioLines, Gauge } from "lucide-react";

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

type Sample = {
  id: string;
  prompt_id: string;
  voice_id: string | null;
  storage_path: string;
  duration_sec: number | null;
  bytes: number | null;
  clipped: boolean | null;
  created_at: string;
  prompts?: { text: string; category: string } | null;
  voices?: { label: string; gender: string } | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const audioUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/ssdp-audio/${path}`;

type QaRow = {
  id: string;
  sample_id: string;
  transcript: string | null;
  wer: number | null;
  cer: number | null;
  quality_score: number;
  language_drift: boolean | null;
  flags: string[];
  audio_samples?: { storage_path: string; prompts?: { text: string; category: string } | null } | null;
};

function Index() {
  const qc = useQueryClient();
  const generate = useServerFn(generatePrompts);
  const queue = useServerFn(queueSynthesis);
  const tick = useServerFn(synthesisTick);
  const stats = useServerFn(synthesisStats);
  const qaTickFn = useServerFn(qaTick);
  const qaStatsFn = useServerFn(qaStats);

  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState<string>("");
  const [workerOn, setWorkerOn] = useState(false);
  const tickingRef = useRef(false);

  const promptsQuery = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
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
    refetchInterval: 4000,
  });

  const jobsQuery = useQuery({
    queryKey: ["jobStats"],
    queryFn: () => stats(),
    refetchInterval: 3000,
  });

  const qaQuery = useQuery({
    queryKey: ["qaStats"],
    queryFn: () => qaStatsFn(),
    refetchInterval: 4000,
  });

  const qaListQuery = useQuery({
    queryKey: ["qaList"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_results")
        .select("id, sample_id, transcript, wer, cer, quality_score, language_drift, flags, audio_samples(storage_path, prompts(text, category))")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as unknown as QaRow[];
    },
    refetchInterval: 4000,
  });

  const samplesQuery = useQuery({
    queryKey: ["samples"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audio_samples")
        .select("id, prompt_id, voice_id, storage_path, duration_sec, bytes, clipped, created_at, prompts(text, category), voices(label, gender)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Sample[];
    },
    refetchInterval: 4000,
  });

  const genMut = useMutation({
    mutationFn: async () =>
      generate({ data: { count, seed: seed ? Number(seed) : undefined } }),
    onSuccess: (res) => {
      toast.success(`Generated ${res.inserted} prompts (seed ${res.seed}, ${res.failures} failed)`);
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const queueMut = useMutation({
    mutationFn: async () => queue({ data: { all: true } }),
    onSuccess: (r) => {
      toast.success(`Queued ${r.queued} synthesis jobs`);
      qc.invalidateQueries({ queryKey: ["jobStats"] });
      setWorkerOn(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Worker tick loop — interleaves synthesis + QA
  useEffect(() => {
    if (!workerOn) return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        if (tickingRef.current) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        tickingRef.current = true;
        try {
          const synth = await tick({ data: { batch: 3 } });
          const qa = await qaTickFn({ data: { batch: 2 } });
          qc.invalidateQueries({ queryKey: ["jobStats"] });
          qc.invalidateQueries({ queryKey: ["samples"] });
          qc.invalidateQueries({ queryKey: ["stats"] });
          qc.invalidateQueries({ queryKey: ["qaStats"] });
          qc.invalidateQueries({ queryKey: ["qaList"] });
          if (synth.processed === 0 && qa.processed === 0) {
            await new Promise((res) => setTimeout(res, 2500));
          }
        } catch (e) {
          toast.error((e as Error).message);
          await new Promise((res) => setTimeout(res, 3000));
        } finally {
          tickingRef.current = false;
        }
      }
    };
    loop();
    return () => {
      cancelled = true;
    };
  }, [workerOn, tick, qaTickFn, qc]);

  const j = jobsQuery.data ?? { pending: 0, running: 0, succeeded: 0, failed: 0 };
  const total = j.pending + j.running + j.succeeded + j.failed;
  const pct = total ? Math.round(((j.succeeded + j.failed) / total) * 100) : 0;
  const qa = qaQuery.data;

  return (
    <div className="min-h-screen">
      <Toaster theme="dark" position="top-right" />
      <header className="border-b border-border/50 backdrop-blur sticky top-0 z-10 bg-background/80">
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
          <div className="flex items-center gap-3">
            <Link to="/review" className="text-sm font-medium hover:text-accent transition-colors">
              Review →
            </Link>
            <Badge variant="outline" className="border-success/40 text-success">
              Stages 1–3 · live
            </Badge>
          </div>
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
              Dialect-aware prompts, ElevenLabs Multilingual v2 synthesis with prosody jitter, automated QA, and
              training-ready manifests for STT fine-tuning.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {["Franco-Arabic", "Code-switching", "Slang", "Numbers", "Sarcasm", "Voice notes"].map((t) => (
                <Badge key={t} variant="secondary" className="bg-secondary/60">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          <Card className="p-6 glass space-y-4">
            <div className="flex items-center gap-2">
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
            <Button className="w-full" disabled={genMut.isPending} onClick={() => genMut.mutate()}>
              {genMut.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <>Generate {count} prompts</>
              )}
            </Button>

            <div className="border-t border-border/50 pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-accent" />
                <h3 className="font-medium">Synthesize audio</h3>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={queueMut.isPending}
                  onClick={() => queueMut.mutate()}
                >
                  {queueMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Queue all prompts
                </Button>
                <div className="flex items-center gap-2 px-3 rounded-md border border-border/60">
                  <Switch checked={workerOn} onCheckedChange={setWorkerOn} id="worker" />
                  <label htmlFor="worker" className="text-xs">Worker</label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                ElevenLabs Multilingual v2 · randomized stability/similarity/style/speed per job for diversity.
              </p>
            </div>
          </Card>
        </section>

        {/* Stats */}
        <section className="grid sm:grid-cols-4 gap-4">
          <StatCard icon={<Database className="h-4 w-4" />} label="Prompts" value={statsQuery.data?.prompts ?? 0} />
          <StatCard icon={<Mic className="h-4 w-4" />} label="Audio samples" value={statsQuery.data?.samples ?? 0} />
          <StatCard
            icon={<Cpu className="h-4 w-4" />}
            label="Jobs pending / running"
            value={j.pending + j.running}
            sub={`${j.succeeded} ok · ${j.failed} failed`}
          />
          <StatCard
            icon={<ListChecks className="h-4 w-4" />}
            label="Approved for export"
            value={statsQuery.data?.approved ?? 0}
          />
        </section>

        {/* Job progress */}
        {total > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-medium flex items-center gap-2"><AudioLines className="h-4 w-4" /> Synthesis progress</span>
              <span className="text-muted-foreground">{j.succeeded + j.failed} / {total} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
              <span>● pending {j.pending}</span>
              <span className="text-accent">● running {j.running}</span>
              <span className="text-success">● succeeded {j.succeeded}</span>
              <span className="text-destructive">● failed {j.failed}</span>
            </div>
          </Card>
        )}

        {/* QA stats */}
        {qa && qa.qaDone > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium flex items-center gap-2">
                <Gauge className="h-4 w-4" /> Automated QA · ElevenLabs Scribe v2
              </span>
              <span className="text-xs text-muted-foreground">
                {qa.qaDone}/{qa.totalSamples} samples · {qa.qaPending} pending
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <QaMetric label="Avg score" value={qa.avgScore.toFixed(1)} hint="0–100" />
              <QaMetric label="Avg WER" value={qa.avgWer.toFixed(3)} hint="word err" />
              <QaMetric label="Avg CER" value={qa.avgCer.toFixed(3)} hint="char err" />
              <QaMetric label="Passing ≥75" value={String(qa.passing)} hint="auto-approve" tone="success" />
              <QaMetric label="Flagged <50" value={String(qa.flagged)} hint="needs review" tone="warning" />
            </div>
          </Card>
        )}

        {/* Pipeline */}
        <section>
          <h3 className="font-semibold mb-3">Pipeline stages</h3>
          <div className="grid md:grid-cols-5 gap-3">
            {[
              { label: "Prompts", state: "live", desc: "LLM-driven EG-Arabic generation" },
              { label: "Synthesis", state: "live", desc: "ElevenLabs multilingual v2" },
              { label: "Auto QA", state: "live", desc: "Scribe v2 + WER/CER" },
              { label: "Review", state: "live", desc: "Waveform + diff UI" },
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

        {/* Recent QA */}
        {(qaListQuery.data?.length ?? 0) > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Recent QA results</h3>
              <span className="text-xs text-muted-foreground">{qaListQuery.data?.length} shown</span>
            </div>
            <div className="space-y-2">
              {qaListQuery.data?.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <ScoreBadge score={r.quality_score} />
                    <div className="flex-1 min-w-0 space-y-2">
                      <p dir="rtl" className="text-sm">
                        <span className="text-muted-foreground text-[10px] uppercase mr-2">ref</span>
                        {r.audio_samples?.prompts?.text ?? "—"}
                      </p>
                      <p dir="rtl" className="text-sm text-accent/90">
                        <span className="text-muted-foreground text-[10px] uppercase mr-2">hyp</span>
                        {r.transcript ?? "—"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Tag>WER {Number(r.wer ?? 0).toFixed(2)}</Tag>
                        <Tag>CER {Number(r.cer ?? 0).toFixed(2)}</Tag>
                        {r.audio_samples?.prompts?.category && <Tag>{r.audio_samples.prompts.category}</Tag>}
                        {r.flags?.map((f) => (
                          <span key={f} className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-warning/40 text-warning">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Recent samples */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent audio samples</h3>
            <span className="text-xs text-muted-foreground">{samplesQuery.data?.length ?? 0} shown</span>
          </div>
          <div className="space-y-2">
            {(samplesQuery.data?.length ?? 0) === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No audio yet. Generate prompts → Queue all → toggle Worker on.
              </Card>
            )}
            {samplesQuery.data?.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-4">
                  <Play className="h-4 w-4 mt-1 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p dir="rtl" className="text-sm leading-relaxed truncate">
                      {s.prompts?.text ?? "—"}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {s.voices?.label && <Tag>{s.voices.label} · {s.voices.gender}</Tag>}
                      {s.prompts?.category && <Tag>{s.prompts.category}</Tag>}
                      {s.duration_sec && <Tag>{s.duration_sec}s</Tag>}
                      {s.bytes && <Tag>{(s.bytes / 1024).toFixed(0)} KB</Tag>}
                      {s.clipped && <span className="text-[10px] text-warning">⚠ flagged</span>}
                    </div>
                    <audio controls preload="none" className="w-full mt-2 h-8" src={audioUrl(s.storage_path)} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Recent prompts */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent prompts</h3>
            <span className="text-xs text-muted-foreground">
              {promptsQuery.data?.length ?? 0} shown · {CATEGORIES.length} domains · auto-refresh
            </span>
          </div>
          <div className="space-y-2">
            {promptsQuery.data?.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No prompts yet. Click <span className="text-foreground">Generate</span> above.
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
              Stages 1–2 (prompts + synthesis) are live. Stages 3–5 (auto QA via Scribe v2, review dashboard, export
              manifests) are next. The full Python + Celery + FastAPI monorepo deliverable is generated as a
              downloadable zip in a follow-up turn.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight mt-1">{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
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

function QaMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning";
}) {
  const toneCls =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tracking-tight ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 75 ? "border-success/50 text-success" : score >= 50 ? "border-warning/50 text-warning" : "border-destructive/50 text-destructive";
  return (
    <div className={`shrink-0 h-12 w-12 rounded-md border ${tone} grid place-items-center`}>
      <div className="text-base font-semibold leading-none">{score}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">score</div>
    </div>
  );
}
