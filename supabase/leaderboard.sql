grant usage on schema waterking_private to anon;
-- Production leaderboard projection. No raw records, identifiers or email leave the API.
create table waterking_private.leaderboard_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 participating boolean not null
);
alter table waterking_private.leaderboard_preferences enable row level security;
revoke all on waterking_private.leaderboard_preferences from public,anon,authenticated;
-- Reliable daily goals only. Legacy current settings are NOT historical evidence.
-- Reserved for reviewed server history ingestion; clients cannot populate this table.
create table waterking_private.leaderboard_daily_goals (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 goal_ml integer check(goal_ml between 100 and 10000),
 primary key(user_id,day)
);
alter table waterking_private.leaderboard_daily_goals enable row level security;
revoke all on waterking_private.leaderboard_daily_goals from public,anon,authenticated;

create function waterking_private.leaderboard_participation(p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if p_enabled is null then raise exception 'Invalid preference' using errcode='22023'; end if;
 uid:=waterking_private.require_active_user(true);
 insert into waterking_private.leaderboard_preferences values(uid,p_enabled)
 on conflict(user_id) do update set participating=excluded.participating;
 return p_enabled;
end $$;
revoke all on function waterking_private.leaderboard_participation(boolean) from public,anon,authenticated;
grant execute on function waterking_private.leaderboard_participation(boolean) to authenticated;
create function public.leaderboard_participation(p_enabled boolean)
returns boolean language sql security invoker set search_path='' as $$
 select waterking_private.leaderboard_participation(p_enabled);
$$;
revoke all on function public.leaderboard_participation(boolean) from public,anon,authenticated;
grant execute on function public.leaderboard_participation(boolean) to authenticated;

create function waterking_private.leaderboard_page(p_metric text,p_offset integer,p_snapshot text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; stamp timestamptz:=statement_timestamp(); uid uuid:=auth.uid();
begin
 if p_metric is null or p_metric not in ('streak','days','goals','today','total')
 or p_offset is null or p_offset<0 or p_offset>1000000
 or p_offset%20<>0 or (p_offset>0 and p_snapshot is null)
 or (p_snapshot is not null and p_snapshot !~ '^[a-f0-9]{32}$') then
 raise exception 'Invalid leaderboard query' using errcode='22023'; end if;
 with candidates as (
 select u.id,coalesce(p.nickname,'水友') as nickname,
   not u.is_anonymous and u.email_confirmed_at is not null as verified,
   s.*,g.goal_days,g.covered_days
 from auth.users u
 left join public.profiles p on p.user_id=u.id
 left join waterking_private.leaderboard_preferences pref on pref.user_id=u.id
 left join waterking_private.guest_activity a on a.user_id=u.id
 cross join lateral waterking_private.leaderboard_record_scores(u.id,stamp) s
 cross join lateral (
   select count(*) filter(where d.water_ml>=g.goal_ml and g.goal_ml>0) as goal_days,
     count(*) as covered_days
   from waterking_private.leaderboard_record_days(u.id,stamp) d
   join waterking_private.leaderboard_daily_goals g on g.user_id=u.id and g.day=d.day
 ) g
 where coalesce(pref.participating,true)
 and not waterking_private.guest_expired(u.is_anonymous,coalesce(a.last_active_at,u.created_at),stamp)
 ), scored as (
 select *,case p_metric when 'streak' then current_streak when 'days' then record_days
 when 'goals' then goal_days when 'today' then today_ml else total_ml end as score from candidates
 ), ranked as (
 select *,rank() over(order by score desc) as rank,
 row_number() over(order by score desc,
   case when score=0 and record_days=0 and verified then 0 else 1 end,
   lower(btrim(nickname)) collate "C",id) as position from scored
 ), version as (
 select md5(coalesce(string_agg(jsonb_build_array(id,nickname,score,rank,position,record_days,covered_days)::text,'|' order by position),'')||
 (stamp at time zone 'Asia/Shanghai')::date::text||p_metric) as snapshot from ranked
 )
 select jsonb_build_object(
 'snapshot',v.snapshot,'stale',p_snapshot is not null and p_snapshot<>v.snapshot,
 'updatedAt',stamp,'day',(stamp at time zone 'Asia/Shanghai')::date,
 'total',(select count(*) from ranked),
 'participating',case when uid is null then null else exists(select 1 from ranked where id=uid) end,
 'mine',(select jsonb_build_object('nickname',nickname,'score',score,'rank',rank,'empty',record_days=0,
 'incomplete',p_metric='goals' and covered_days<record_days) from ranked where id=uid),
 'rows',case when p_snapshot is not null and p_snapshot<>v.snapshot then '[]'::jsonb else
 coalesce((select jsonb_agg(jsonb_build_object('nickname',nickname,'score',score,'rank',rank,'empty',record_days=0,
 'incomplete',p_metric='goals' and covered_days<record_days) order by position)
 from ranked where position>p_offset and position<=p_offset+20),'[]'::jsonb) end,
 'hasMore',(select count(*) from ranked)>p_offset+20,
 'goalHistoryAvailable',(select exists(select 1 from waterking_private.leaderboard_daily_goals where day<=(stamp at time zone 'Asia/Shanghai')::date))
 ) into result from version v;
 return result;
end $$;
revoke all on function waterking_private.leaderboard_page(text,integer,text) from public,anon,authenticated;
grant execute on function waterking_private.leaderboard_page(text,integer,text) to anon,authenticated;
create function public.leaderboard_page(p_metric text default 'streak',p_offset integer default 0,p_snapshot text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select waterking_private.leaderboard_page(p_metric,p_offset,p_snapshot);
$$;
revoke all on function public.leaderboard_page(text,integer,text) from public,anon,authenticated;
grant execute on function public.leaderboard_page(text,integer,text) to anon,authenticated;
