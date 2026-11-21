-- Phase A: per-user attention-training history with idempotent client sync keys.
-- Applied to project hujqszviehruwasvdyfy via Supabase MCP (training_sessions + rls_initplan).

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  training_id text not null,
  completed_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  size integer,
  accuracy double precision,
  detail text,
  created_at timestamptz not null default now(),
  constraint training_sessions_user_client_unique unique (user_id, client_id)
);

create index if not exists training_sessions_user_completed_idx
  on public.training_sessions (user_id, completed_at desc);

alter table public.training_sessions enable row level security;

-- (select auth.uid()) keeps RLS initplan-friendly (evaluated once per statement).
drop policy if exists "training_sessions_select_own" on public.training_sessions;
create policy "training_sessions_select_own"
  on public.training_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "training_sessions_insert_own" on public.training_sessions;
create policy "training_sessions_insert_own"
  on public.training_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "training_sessions_update_own" on public.training_sessions;
create policy "training_sessions_update_own"
  on public.training_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "training_sessions_delete_own" on public.training_sessions;
create policy "training_sessions_delete_own"
  on public.training_sessions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
