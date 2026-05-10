
-- =====================================================
-- S.S.D.P. Schema
-- =====================================================

create extension if not exists "pgcrypto";

-- Prompts: generated Egyptian Arabic text scripts
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  normalized_text text not null,
  category text not null,
  difficulty text not null default 'medium',
  language_mix_pct int not null default 0,
  est_duration_sec numeric not null default 0,
  speaking_style text default 'neutral',
  emotion text default 'neutral',
  token_count int not null default 0,
  noise_level text default 'clean',
  length_bucket text not null default 'medium',
  seed int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_prompts_category on public.prompts(category);
create index idx_prompts_created_at on public.prompts(created_at desc);

-- Voices catalog
create table public.voices (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'elevenlabs',
  voice_id text not null,
  label text not null,
  gender text not null default 'unknown',
  language text not null default 'ar',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Synthesis jobs queue
create table public.synthesis_jobs (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  voice_id uuid references public.voices(id) on delete set null,
  status text not null default 'pending', -- pending | running | done | failed | cancelled
  attempts int not null default 0,
  max_attempts int not null default 3,
  next_run_at timestamptz not null default now(),
  error text,
  params jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  audio_sample_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index uniq_synthesis_fingerprint on public.synthesis_jobs(fingerprint);
create index idx_synthesis_status on public.synthesis_jobs(status, next_run_at);

-- Audio samples
create table public.audio_samples (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  voice_id uuid references public.voices(id) on delete set null,
  job_id uuid references public.synthesis_jobs(id) on delete set null,
  storage_path text not null,
  format text not null default 'mp3',
  duration_sec numeric,
  sample_rate int,
  bytes int,
  peak numeric,
  rms numeric,
  silence_ratio numeric,
  clipped boolean default false,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audio_samples_prompt on public.audio_samples(prompt_id);

-- QA results
create table public.qa_results (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.audio_samples(id) on delete cascade,
  transcript text,
  wer numeric,
  cer numeric,
  quality_score int not null default 0, -- 0..100
  language_drift boolean default false,
  flags jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_qa_sample on public.qa_results(sample_id);
create index idx_qa_score on public.qa_results(quality_score desc);

-- Human reviews
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.audio_samples(id) on delete cascade unique,
  status text not null default 'pending', -- pending | approved | rejected
  edited_transcript text,
  tags jsonb not null default '[]'::jsonb,
  reviewer_notes text,
  reviewer_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_reviews_status on public.reviews(status);

-- Dataset versions
create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  filters jsonb not null default '{}'::jsonb,
  sample_count int not null default 0,
  total_duration_sec numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Export snapshots
create table public.export_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid references public.dataset_versions(id) on delete cascade,
  format text not null, -- jsonl | csv | hf | whisper
  storage_path text,
  manifest jsonb not null default '{}'::jsonb,
  sample_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Audit log
create table public.audit_log (
  id bigserial primary key,
  entity text not null,
  entity_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_entity on public.audit_log(entity, entity_id);
create index idx_audit_created on public.audit_log(created_at desc);

-- =====================================================
-- RLS — open access (single-tenant internal tool)
-- =====================================================
alter table public.prompts enable row level security;
alter table public.voices enable row level security;
alter table public.synthesis_jobs enable row level security;
alter table public.audio_samples enable row level security;
alter table public.qa_results enable row level security;
alter table public.reviews enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.export_snapshots enable row level security;
alter table public.audit_log enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'prompts','voices','synthesis_jobs','audio_samples','qa_results',
    'reviews','dataset_versions','export_snapshots','audit_log'
  ])
  loop
    execute format('create policy "public read %I" on public.%I for select using (true);', t, t);
    execute format('create policy "public insert %I" on public.%I for insert with check (true);', t, t);
    execute format('create policy "public update %I" on public.%I for update using (true) with check (true);', t, t);
    execute format('create policy "public delete %I" on public.%I for delete using (true);', t, t);
  end loop;
end $$;

-- =====================================================
-- Storage bucket for audio
-- =====================================================
insert into storage.buckets (id, name, public)
values ('ssdp-audio', 'ssdp-audio', true)
on conflict (id) do nothing;

create policy "ssdp-audio public read"
on storage.objects for select
using (bucket_id = 'ssdp-audio');

create policy "ssdp-audio public write"
on storage.objects for insert
with check (bucket_id = 'ssdp-audio');

create policy "ssdp-audio public update"
on storage.objects for update
using (bucket_id = 'ssdp-audio');

create policy "ssdp-audio public delete"
on storage.objects for delete
using (bucket_id = 'ssdp-audio');

-- =====================================================
-- Seed voices (ElevenLabs voice IDs that handle Arabic)
-- =====================================================
insert into public.voices (provider, voice_id, label, gender, language) values
  ('elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Sarah',    'female', 'ar'),
  ('elevenlabs', 'XrExE9yKIg1WjnnlVkGX', 'Matilda',  'female', 'ar'),
  ('elevenlabs', 'pFZP5JQG7iQjIQuC4Bku', 'Lily',     'female', 'ar'),
  ('elevenlabs', 'JBFqnCBsd6RMkjVDRZzb', 'George',   'male',   'ar'),
  ('elevenlabs', 'onwK4e9ZLuTAKqWW03F9', 'Daniel',   'male',   'ar'),
  ('elevenlabs', 'iP95p4xoKVk53GoZ742B', 'Chris',    'male',   'ar')
on conflict do nothing;
