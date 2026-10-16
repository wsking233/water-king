-- Production private record facts. Authorized by user on 2026-10-16.
-- Additive only; no tables, data writes, public API, or schedule.
-- Read accepted current entities, never receipts, cups, or client scores.
create function waterking_private.leaderboard_record_days(p_user uuid, p_as_of timestamptz)
returns table(day date, water_ml bigint, record_count bigint)
language sql stable security invoker set search_path = '' as $$
  select ( (e.value->>'at')::timestamptz at time zone 'Asia/Shanghai')::date,
    sum(case when e.value->>'kind'='water' then (e.value->>'amount')::bigint else 0 end)::bigint,
    count(*)
  from waterking_private.sync_entities e
  where e.user_id=p_user and e.entity='record' and e.value is not null
    and (e.value->>'at')::timestamptz <= p_as_of
    and isfinite(p_as_of)
  group by 1
$$;

-- Clock argument is a fixture/operator seam only; never grant to clients.
-- On-demand calculation makes today's totals and streak expire at midnight without Cron.
create function waterking_private.leaderboard_record_scores(p_user uuid, p_as_of timestamptz)
returns table(record_days bigint, current_streak bigint, today_ml bigint, total_ml bigint)
language sql stable security invoker set search_path = '' as $$
  with days as (select * from waterking_private.leaderboard_record_days(p_user,p_as_of)),
  clock as (select (p_as_of at time zone 'Asia/Shanghai')::date as today),
  anchor as (select max(day) as day from days,clock where day between today-1 and today),
  ordered as (select d.day,row_number() over(order by d.day desc) as n from days d,anchor a where d.day<=a.day)
  select (select count(*) from days),
    (select count(*) from ordered o,anchor a where a.day-o.day=o.n-1),
    coalesce((select water_ml from days,clock where day=today),0),
    coalesce((select sum(water_ml)::bigint from days),0)
$$;
revoke all on function waterking_private.leaderboard_record_days(uuid,timestamptz) from public,anon,authenticated;
revoke all on function waterking_private.leaderboard_record_scores(uuid,timestamptz) from public,anon,authenticated;
