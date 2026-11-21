-- Phase B: cloud sync for suite runs, aim session logs, sensitivity
-- recommendations, and aim settings. Kept as separate tables from
-- training_sessions so cognitive drill scores never mix into sens fitting.
-- Applied to project hujqszviehruwasvdyfy via Supabase MCP.

-- Multi-drill suite summaries (cognitive prior / fatigue gate).
create table if not exists public.suite_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  completed_at timestamptz not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  constraint suite_runs_user_client_unique unique (user_id, client_id)
);

create index if not exists suite_runs_user_completed_idx
  on public.suite_runs (user_id, completed_at desc);

alter table public.suite_runs enable row level security;

drop policy if exists "suite_runs_select_own" on public.suite_runs;
create policy "suite_runs_select_own"
  on public.suite_runs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "suite_runs_insert_own" on public.suite_runs;
create policy "suite_runs_insert_own"
  on public.suite_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "suite_runs_update_own" on public.suite_runs;
create policy "suite_runs_update_own"
  on public.suite_runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "suite_runs_delete_own" on public.suite_runs;
create policy "suite_runs_delete_own"
  on public.suite_runs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Per-round aim trainer session log (L1 longitudinal data).
create table if not exists public.aim_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  source text not null default 'aim' check (source = 'aim'),
  mode_id text not null,
  profile_id text not null,
  sensitivity double precision not null,
  dpi integer,
  cm360 double precision,
  score double precision not null,
  hits integer not null,
  shots integer not null,
  accuracy double precision not null,
  avg_kill_time double precision,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint aim_sessions_user_client_unique unique (user_id, client_id)
);

create index if not exists aim_sessions_user_completed_idx
  on public.aim_sessions (user_id, completed_at desc);

alter table public.aim_sessions enable row level security;

drop policy if exists "aim_sessions_select_own" on public.aim_sessions;
create policy "aim_sessions_select_own"
  on public.aim_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "aim_sessions_insert_own" on public.aim_sessions;
create policy "aim_sessions_insert_own"
  on public.aim_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "aim_sessions_update_own" on public.aim_sessions;
create policy "aim_sessions_update_own"
  on public.aim_sessions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "aim_sessions_delete_own" on public.aim_sessions;
create policy "aim_sessions_delete_own"
  on public.aim_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Append-only sensitivity recommendation history (latest = max created_at).
create table if not exists public.sensitivity_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  cm360 double precision not null,
  cm360_low double precision not null,
  cm360_high double precision not null,
  profile_id_at_fit text not null,
  dpi integer not null,
  task_family text not null,
  s_obj double precision not null,
  s_sub double precision not null,
  verified boolean not null,
  confidence double precision,
  created_at timestamptz not null,
  constraint sensitivity_recommendations_user_client_unique unique (user_id, client_id)
);

create index if not exists sensitivity_recommendations_user_created_idx
  on public.sensitivity_recommendations (user_id, created_at desc);

alter table public.sensitivity_recommendations enable row level security;

drop policy if exists "sensitivity_recommendations_select_own" on public.sensitivity_recommendations;
create policy "sensitivity_recommendations_select_own"
  on public.sensitivity_recommendations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "sensitivity_recommendations_insert_own" on public.sensitivity_recommendations;
create policy "sensitivity_recommendations_insert_own"
  on public.sensitivity_recommendations for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "sensitivity_recommendations_update_own" on public.sensitivity_recommendations;
create policy "sensitivity_recommendations_update_own"
  on public.sensitivity_recommendations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "sensitivity_recommendations_delete_own" on public.sensitivity_recommendations;
create policy "sensitivity_recommendations_delete_own"
  on public.sensitivity_recommendations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- One control-settings row per user (DPI / sens / profile / rotation expr).
create table if not exists public.aim_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile_id text not null,
  sensitivity double precision not null,
  dpi integer,
  rotation_expr text not null,
  updated_at timestamptz not null default now()
);

alter table public.aim_settings enable row level security;

drop policy if exists "aim_settings_select_own" on public.aim_settings;
create policy "aim_settings_select_own"
  on public.aim_settings for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "aim_settings_insert_own" on public.aim_settings;
create policy "aim_settings_insert_own"
  on public.aim_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "aim_settings_update_own" on public.aim_settings;
create policy "aim_settings_update_own"
  on public.aim_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "aim_settings_delete_own" on public.aim_settings;
create policy "aim_settings_delete_own"
  on public.aim_settings for delete to authenticated
  using ((select auth.uid()) = user_id);
