-- Add public handle to leaderboard RPCs + athlete profile detail RPC.
-- Handles come from GitHub usernames; profiles expose only aggregate bests/counts.

create or replace function private.user_handle(u auth.users)
returns text
language sql
immutable
as $$
  select lower(
    coalesce(
      nullif(u.raw_user_meta_data->>'user_name', ''),
      nullif(u.raw_user_meta_data->>'preferred_username', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      replace(u.id::text, '-', '')
    )
  );
$$;

drop function if exists public.leaderboard_schulte(integer);
drop function if exists public.leaderboard_aim(integer);
drop function if exists public.leaderboard_weekly(integer);
drop function if exists private.leaderboard_schulte(integer);
drop function if exists private.leaderboard_aim(integer);
drop function if exists private.leaderboard_weekly(integer);

create function private.leaderboard_schulte(limit_n integer)
returns table (
  rank bigint,
  handle text,
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
    private.user_handle(u) as handle,
    private.display_name_for(u) as display_name,
    b.duration_ms::double precision as metric_value,
    b.completed_at
  from best b
  join auth.users u on u.id = b.user_id
  order by b.duration_ms asc, b.completed_at asc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create function private.leaderboard_aim(limit_n integer)
returns table (
  rank bigint,
  handle text,
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
    private.user_handle(u) as handle,
    private.display_name_for(u) as display_name,
    b.score::double precision as metric_value,
    b.completed_at
  from best b
  join auth.users u on u.id = b.user_id
  order by b.score desc, b.completed_at desc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create function private.leaderboard_weekly(limit_n integer)
returns table (
  rank bigint,
  handle text,
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
    private.user_handle(u) as handle,
    private.display_name_for(u) as display_name,
    c.session_count as metric_value,
    c.last_at as completed_at
  from counted c
  join auth.users u on u.id = c.user_id
  order by c.session_count desc, c.last_at desc
  limit greatest(1, least(coalesce(limit_n, 10), 50));
$$;

create function public.leaderboard_schulte(limit_n integer default 10)
returns table (
  rank bigint,
  handle text,
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

create function public.leaderboard_aim(limit_n integer default 10)
returns table (
  rank bigint,
  handle text,
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

create function public.leaderboard_weekly(limit_n integer default 10)
returns table (
  rank bigint,
  handle text,
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

create or replace function private.resolve_user_by_handle(p_handle text)
returns auth.users
language sql
security definer
set search_path = public
stable
as $$
  select u.*
  from auth.users u
  where private.user_handle(u) = lower(trim(p_handle))
  limit 1;
$$;

create or replace function public.athlete_profile(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  u auth.users;
  result jsonb;
begin
  if p_handle is null or length(trim(p_handle)) = 0 then
    return null;
  end if;

  select * into u from private.resolve_user_by_handle(p_handle);
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'handle', private.user_handle(u),
    'displayName', private.display_name_for(u),
    'bestSchulteMs', (
      select min(ts.duration_ms)
      from public.training_sessions ts
      where ts.user_id = u.id and ts.training_id = 'schulte' and ts.duration_ms > 0
    ),
    'bestAimScore', (
      select max(a.score)
      from public.aim_sessions a
      where a.user_id = u.id
        and a.mode_id in ('gridshot', 'gridshot-3x3', 'sixshot', 'sixshot-beginner')
        and a.score > 0
    ),
    'weeklySessions', (
      select count(*)::int
      from (
        select completed_at from public.training_sessions
        where user_id = u.id and completed_at >= now() - interval '7 days'
        union all
        select completed_at from public.aim_sessions
        where user_id = u.id and completed_at >= now() - interval '7 days'
      ) w
    ),
    'totalDrills', (
      select count(*)::int from public.training_sessions where user_id = u.id
    ),
    'totalAim', (
      select count(*)::int from public.aim_sessions where user_id = u.id
    ),
    'drillBreakdown', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'trainingId', d.training_id,
          'count', d.cnt,
          'bestDurationMs', d.best_ms,
          'avgAccuracy', d.avg_acc
        )
        order by d.cnt desc
      )
      from (
        select
          ts.training_id,
          count(*)::int as cnt,
          min(ts.duration_ms) filter (where ts.duration_ms > 0) as best_ms,
          avg(ts.accuracy) filter (where ts.accuracy is not null) as avg_acc
        from public.training_sessions ts
        where ts.user_id = u.id
        group by ts.training_id
      ) d
    ), '[]'::jsonb),
    'lastActiveAt', (
      select max(x.completed_at)
      from (
        select completed_at from public.training_sessions where user_id = u.id
        union all
        select completed_at from public.aim_sessions where user_id = u.id
      ) x
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.athlete_profile(text) from public;
grant execute on function public.athlete_profile(text) to anon, authenticated;
