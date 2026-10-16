-- Private reusable facts only. No badge catalogue, thresholds, grants or award writes.
create function waterking_private.achievement_facts(p_user uuid,p_as_of timestamptz)
returns table(record_count bigint,record_days bigint,longest_streak bigint,goal_days bigint,goal_history_incomplete boolean)
language sql stable security invoker set search_path='' as $$
 with days as (select * from waterking_private.leaderboard_record_days(p_user,p_as_of)),
 islands as (
   select day,day-(row_number() over(order by day))::integer as island from days
 ), streaks as (select count(*) as length from islands group by island),
 goals as (
   select d.day,d.water_ml,g.known,g.goal_ml from days d
   cross join lateral waterking_private.goal_on_day(p_user,d.day) g
 )
 select coalesce((select sum(record_count)::bigint from days),0),
 (select count(*) from days),coalesce((select max(length) from streaks),0),
 (select count(*) from goals where known and goal_ml>0 and water_ml>=goal_ml),
 exists(select 1 from goals where not known)
$$;
revoke all on function waterking_private.achievement_facts(uuid,timestamptz) from public,anon,authenticated;
