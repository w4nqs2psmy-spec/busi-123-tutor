-- BUSI1620 Adaptive Tutor — initial schema
--
-- Implements mastery-model.md §6 plus the additions agreed in planning.
-- Findings referenced as [Fn] are documented in the Phase-1 plan.
--
-- Security posture (load-bearing — read before changing any policy):
--   * Learners hold SELECT on their own rows only. They hold no INSERT or
--     UPDATE anywhere. Every write goes through a server route using the
--     service role, which bypasses RLS. A learner who could write `attempts`
--     or `learner_topic_mastery` could fabricate their own mastery.
--   * `items` and `item_keys` have RLS enabled and NO policy at all, so they
--     are unreachable by `anon`/`authenticated` in any query. This is what
--     enforces quiz-generation-prompt.md §5.5 (never expose the answer key to
--     the browser) under RLS. [F2]

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- `venture_idea` exists because every generative_activity in topics.json is
-- phrased "for your own venture" — the open tasks are ungradeable without it.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'learner' check (role in ('learner', 'instructor')),
  cohort       text,
  venture_idea text,
  created_at   timestamptz not null default now()
);

-- SECURITY DEFINER so the function body bypasses RLS on profiles. A policy on
-- profiles that selected from profiles directly would recurse infinitely.
create function public.is_instructor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'instructor'
  );
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- topics
-- ---------------------------------------------------------------------------
-- topics.json stays the source of truth for CONTENT (prompts, options, keys,
-- rubrics). This table exists for referential integrity and per-LO reporting.
-- learning_outcomes is an array so "LO2/LO3" stops being an unsplittable
-- string. [F12]  spec_version tracks which topics.json revision seeded it. [F20]

create table public.topics (
  id                text primary key,
  title             text not null,
  learning_outcomes text[] not null check (cardinality(learning_outcomes) > 0),
  position          int  not null,
  spec_version      text not null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- items  [F1]
-- ---------------------------------------------------------------------------
-- One pool for both anchor questions (from topics.json) and AI-generated ones.
-- mastery-model.md §6 gave `attempts.item_id` no referent; without this table
-- the avoid-list (quiz-generation-prompt.md §5.2) and server-side grading are
-- both impossible.
--
-- source_ref holds the human/model-facing id ('mr-q1', 'market-research-gen-1').
-- It is deliberately NOT unique: the generator emits "-gen-1" on every call
-- with count=1, so those ids collide by construction. [F3]

create table public.items (
  id                  uuid primary key default gen_random_uuid(),
  topic_id            text not null references public.topics(id) on delete restrict,
  source              text not null check (source in ('anchor', 'generated')),
  source_ref          text,
  type                text not null check (type in ('mcq', 'open')),
  difficulty          text not null check (difficulty in ('easy', 'medium', 'hard')),
  generative_strategy text check (
                        generative_strategy in ('self_test', 'self_explain', 'elaborate', 'apply')
                      ),
  prompt              text not null,
  options             jsonb,
  rubric              jsonb,
  created_for         uuid references public.profiles(id) on delete set null,
  verification_passed boolean,
  created_at          timestamptz not null default now(),

  -- quiz-generation-prompt.md §1: "Always produce exactly 4 options."
  -- §4: open tasks carry 2–4 rubric criteria and no options/answer.
  constraint items_shape check (
    (type = 'mcq'  and options is not null and jsonb_array_length(options) = 4
                   and rubric is null)
    or
    (type = 'open' and rubric is not null and jsonb_array_length(rubric) between 2 and 4
                   and options is null)
  )
);

create index items_topic_difficulty_idx on public.items (topic_id, difficulty);
create index items_created_for_idx on public.items (created_for) where created_for is not null;

-- ---------------------------------------------------------------------------
-- item_keys  [F2]
-- ---------------------------------------------------------------------------
-- Answer keys live in their own table with no RLS policy, so no learner-facing
-- query can reach them regardless of how the items table is later exposed.
-- Grading happens server-side against this table only.

create table public.item_keys (
  item_id   uuid primary key references public.items(id) on delete cascade,
  answer    int,
  rationale text
);

revoke all on public.item_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- sessions  [F13]
-- ---------------------------------------------------------------------------
-- mastery-model.md §5 asks for active learners, return rate (sessions on >= 2
-- distinct days) and streak length. None of it is computable from §6 as given.

create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  learner_id   uuid not null references public.profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index sessions_learner_started_idx on public.sessions (learner_id, started_at desc);

-- ---------------------------------------------------------------------------
-- learner_topic_mastery  (mastery-model.md §6)
-- ---------------------------------------------------------------------------
-- mastery_prob and band are a denormalised cache of masteryProbability(rating)
-- and masteryBand(p, attempts). They are always written together with rating by
-- lib/mastery.ts — never computed ad hoc in SQL, or the two drift.

create table public.learner_topic_mastery (
  learner_id   uuid not null references public.profiles(id) on delete cascade,
  topic_id     text not null references public.topics(id) on delete restrict,
  rating       double precision not null default 1500,
  attempts     int  not null default 0 check (attempts >= 0),
  mastery_prob double precision not null default 0.5 check (mastery_prob between 0 and 1),
  band         text not null default 'provisional' check (
                 band in ('provisional', 'novice', 'developing', 'proficient')
               ),
  updated_at   timestamptz not null default now(),
  primary key (learner_id, topic_id)   -- §6 declared no key [F17]
);

-- ---------------------------------------------------------------------------
-- attempts  (mastery-model.md §6)
-- ---------------------------------------------------------------------------
-- One row per answered item — the raw signal. rating_before/rating_after make
-- the whole mastery trajectory replayable and auditable from this table alone.
--
-- `context` separates baseline scoring from the adaptive loop and from the
-- post assessment; §6 had no way to tell them apart. [F5]
-- `score` carries the fractional rubric proportion for AI-graded open tasks,
-- which Elo consumes natively as an outcome in [0,1]. [F9]

create table public.attempts (
  id            uuid primary key default gen_random_uuid(),
  learner_id    uuid not null references public.profiles(id) on delete cascade,
  topic_id      text not null references public.topics(id) on delete restrict,
  item_id       uuid not null references public.items(id) on delete restrict,
  session_id    uuid references public.sessions(id) on delete set null,
  context       text not null check (context in ('baseline', 'adaptive', 'post')),
  difficulty    text not null check (difficulty in ('easy', 'medium', 'hard')),
  response      jsonb not null,
  correct       boolean,
  score         double precision check (score between 0 and 1),
  rating_before double precision not null,
  rating_after  double precision not null,
  created_at    timestamptz not null default now(),

  -- Idempotency: a double-submit must not run updateMastery twice. Also
  -- enforces §4's "same items forbidden" at the database level. [F19]
  constraint attempts_one_per_item unique (learner_id, item_id)
);

-- Serves both the avoid-list query (most recent 30 prompts [F18]) and the
-- dashboard trajectory.
create index attempts_learner_topic_created_idx
  on public.attempts (learner_id, topic_id, created_at desc);

-- ---------------------------------------------------------------------------
-- assessment_snapshots  (mastery-model.md §6)
-- ---------------------------------------------------------------------------
-- Fixed pre/post checkpoints. Deliberately NOT derived from the drifting Elo
-- estimate — see the table at the top of mastery-model.md.
--
-- item_count is load-bearing for Phase 3: when a post-form item fails
-- generation we drop it and score out of the valid remainder rather than
-- falling back to an anchor, which would violate §4. [F8]

create table public.assessment_snapshots (
  id           uuid primary key default gen_random_uuid(),
  learner_id   uuid not null references public.profiles(id) on delete cascade,
  topic_id     text not null references public.topics(id) on delete restrict,
  kind         text not null check (kind in ('baseline', 'post')),
  score        double precision not null check (score between 0 and 1),
  item_count   int  not null check (item_count > 0),
  spec_version text not null,   -- content revision this was taken against [F20]
  taken_at     timestamptz not null default now(),

  -- One baseline and one post per learner per topic, or normalizedGain is
  -- ambiguous about which pair to use. [F17]
  constraint snapshots_one_per_kind unique (learner_id, topic_id, kind)
);

-- ---------------------------------------------------------------------------
-- generation_failures
-- ---------------------------------------------------------------------------
-- Every rejected generation, with the reason and the raw response. This is the
-- QA surface for verification_passed = false and for validator rejections.

create table public.generation_failures (
  id                uuid primary key default gen_random_uuid(),
  learner_id        uuid references public.profiles(id) on delete set null,
  topic_id          text references public.topics(id) on delete set null,
  target_difficulty text,
  reason            text not null,
  raw_response      text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger learner_topic_mastery_touch
  before update on public.learner_topic_mastery
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.topics                enable row level security;
alter table public.items                 enable row level security;
alter table public.item_keys             enable row level security;
alter table public.sessions              enable row level security;
alter table public.learner_topic_mastery enable row level security;
alter table public.attempts              enable row level security;
alter table public.assessment_snapshots  enable row level security;
alter table public.generation_failures   enable row level security;

-- profiles: own row readable and updatable; instructors read all.
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_select_instructor on public.profiles
  for select using (public.is_instructor());

-- topics: metadata only, no secrets. Readable by any signed-in learner.
create policy topics_select_authenticated on public.topics
  for select to authenticated using (true);

-- items, item_keys: NO POLICY. RLS is on and nothing matches, so both tables
-- are invisible to anon/authenticated. Server routes use the service role and
-- strip `answer`/`rationale` before anything reaches the browser. Adding a
-- SELECT policy to either table would leak the answer key. [F2]

-- sessions / mastery / attempts / snapshots: read your own, write nothing.
create policy sessions_select_own on public.sessions
  for select using (learner_id = auth.uid());

create policy mastery_select_own on public.learner_topic_mastery
  for select using (learner_id = auth.uid());
create policy mastery_select_instructor on public.learner_topic_mastery
  for select using (public.is_instructor());

create policy attempts_select_own on public.attempts
  for select using (learner_id = auth.uid());
create policy attempts_select_instructor on public.attempts
  for select using (public.is_instructor());

create policy snapshots_select_own on public.assessment_snapshots
  for select using (learner_id = auth.uid());
create policy snapshots_select_instructor on public.assessment_snapshots
  for select using (public.is_instructor());

-- generation_failures: operational only, service role reads it.
