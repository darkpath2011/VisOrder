-- Public leaderboards: private security-definer aggregations + thin public RPCs.
-- Only display_name + best metric leave the function; raw session rows stay RLS-private.

create schema if not exists private;

create or replace function private.display_name_for(u auth.users)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(u.raw_user_meta_data->>'user_name', ''),
    nullif(u.raw_user_meta_data->>'preferred_username', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    '选手'
  );
$$;

create or replace function private.leaderboard_schulte(limit_n integer)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with best as (
    select distinct on (ts.user_id)
      ts.user_id,
      ts.duration_ms,
      ts.completed_at
    from public.training_sessions ts
    where ts.training_id = 'schulte'
      and ts.duration_ms > 0
    order by ts.user_id, ts.duration_ms asc, ts.completed_at asc
  )
  select
    row_number() over (order by b.duration_ms asc, b.completed_at asc) as rank,
    private.display_name_for(u) as display_name,
    b.duration_ms::double precision as metric_value,
    b.completed_at
  from best b
  join auth.users u on u.id = b.user_id
  order by b.duration_ms asc, b.completed_at asc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create or replace function private.leaderboard_aim(limit_n integer)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with best as (
    select distinct on (a.user_id)
      a.user_id,
      a.score,
      a.completed_at
    from public.aim_sessions a
    where a.mode_id in ('gridshot', 'gridshot-3x3', 'sixshot', 'sixshot-beginner')
      and a.score > 0
    order by a.user_id, a.score desc, a.completed_at desc
  )
  select
    row_number() over (order by b.score desc, b.completed_at desc) as rank,
    private.display_name_for(u) as display_name,
    b.score::double precision as metric_value,
    b.completed_at
  from best b
  join auth.users u on u.id = b.user_id
  order by b.score desc, b.completed_at desc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create or replace function private.leaderboard_weekly(limit_n integer)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with activity as (
    select user_id, completed_at
    from public.training_sessions
    where completed_at >= (now() - interval '7 days')
    union all
    select user_id, completed_at
    from public.aim_sessions
    where completed_at >= (now() - interval '7 days')
  ),
  counted as (
    select
      a.user_id,
      count(*)::double precision as session_count,
      max(a.completed_at) as last_at
    from activity a
    group by a.user_id
  )
  select
    row_number() over (order by c.session_count desc, c.last_at desc) as rank,
    private.display_name_for(u) as display_name,
    c.session_count as metric_value,
    c.last_at as completed_at
  from counted c
  join auth.users u on u.id = c.user_id
  order by c.session_count desc, c.last_at desc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create or replace function public.leaderboard_schulte(limit_n integer default 10)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select * from private.leaderboard_schulte(limit_n);
$$;

create or replace function public.leaderboard_aim(limit_n integer default 10)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select * from private.leaderboard_aim(limit_n);
$$;

create or replace function public.leaderboard_weekly(limit_n integer default 10)
returns table (
  rank bigint,
  display_name text,
  metric_value double precision,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select * from private.leaderboard_weekly(limit_n);
$$;

revoke all on function public.leaderboard_schulte(integer) from public;
revoke all on function public.leaderboard_aim(integer) from public;
revoke all on function public.leaderboard_weekly(integer) from public;
grant execute on function public.leaderboard_schulte(integer) to anon, authenticated;
grant execute on function public.leaderboard_aim(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly(integer) to anon, authenticated;
