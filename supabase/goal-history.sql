-- Production: conservative date policy confirmed by product owner on 2026-10-16.
-- Atomic rollout, auth-first lock order shared with sync and lifecycle. No Cron/deletion.
set local lock_timeout='5s';
lock table auth.users in share row exclusive mode;
create table waterking_private.goal_baselines (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cutover_at timestamptz not null check(isfinite(cutover_at)),
 from_day date not null,
 revision bigint not null check(revision>=0),
 known boolean not null,
 goal_ml integer check(goal_ml between 100 and 10000),
 check(known or goal_ml is null)
);
create table waterking_private.goal_tickets (
 user_id uuid not null references auth.users(id) on delete cascade,
 ticket_id uuid not null default gen_random_uuid(),
 base_revision bigint not null check(base_revision>=0),
 issued_at timestamptz not null check(isfinite(issued_at)),
 issued_day date not null,
 mutation_id uuid,
 event_id uuid,
 primary key(user_id,ticket_id),
 unique(user_id,base_revision,issued_day),
 unique(user_id,mutation_id),
 check((mutation_id is null)=(event_id is null))
);
create table waterking_private.goal_events (
 user_id uuid not null references waterking_private.goal_baselines(user_id) on delete cascade,
 event_id uuid not null,
 mutation_id uuid not null,
 revision bigint not null check(revision>0),
 cursor bigint not null check(cursor>0),
 goal_ml integer check(goal_ml between 100 and 10000),
 confirmed_at timestamptz not null check(isfinite(confirmed_at)),
 ticket_id uuid,
 effective_day date,
 uncertain_from_day date,
 primary key(user_id,event_id),
 unique(user_id,mutation_id),unique(user_id,revision),unique(user_id,cursor),
 foreign key(user_id,mutation_id) references waterking_private.sync_receipts(user_id,mutation_id) on delete cascade,
 foreign key(user_id,ticket_id) references waterking_private.goal_tickets(user_id,ticket_id),
 check((effective_day is null)<>(uncertain_from_day is null))
);
create index goal_events_effective on waterking_private.goal_events(user_id,effective_day,revision desc) where effective_day is not null;
create index goal_events_unknown on waterking_private.goal_events(user_id,uncertain_from_day,revision desc) where uncertain_from_day is not null;
alter table waterking_private.goal_baselines enable row level security;
alter table waterking_private.goal_tickets enable row level security;
alter table waterking_private.goal_events enable row level security;
revoke all on waterking_private.goal_baselines,waterking_private.goal_tickets,waterking_private.goal_events from public,anon,authenticated;

create function waterking_private.capture_goal_baseline() returns trigger
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if new.entity='settings' then
  insert into waterking_private.goal_baselines values(new.user_id,stamp,(stamp at time zone 'Asia/Shanghai')::date+1,
   case when tg_op='UPDATE' then old.revision else 0 end,
   tg_op='UPDATE' and old.value is not null,
   case when tg_op='UPDATE' then (old.value->>'goal')::integer else null end)
  on conflict(user_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function waterking_private.capture_goal_baseline() from public,anon,authenticated;
create trigger waterking_goal_baseline before insert or update on waterking_private.sync_entities
for each row execute function waterking_private.capture_goal_baseline();

-- Capture every successful settings write, including v1; CAS failures/retries insert no receipt.
create function waterking_private.capture_goal_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); t waterking_private.goal_tickets%rowtype; effective date; gap date;
begin
 if new.request->>'entity'<>'settings' then return new; end if;
 select * into t from waterking_private.goal_tickets where user_id=new.user_id and mutation_id=new.mutation_id;
 if found and t.base_revision=(new.request->>'expectedRevision')::bigint
 and t.issued_day=(stamp at time zone 'Asia/Shanghai')::date and t.issued_at<=stamp then
  effective:=t.issued_day;
 else
  select coalesce((select effective_day from waterking_private.goal_events where user_id=new.user_id
   and effective_day is not null order by revision desc limit 1),
   (select (cutover_at at time zone 'Asia/Shanghai')::date from waterking_private.goal_baselines where user_id=new.user_id)) into gap;
 end if;
 insert into waterking_private.goal_events values(new.user_id,coalesce(t.event_id,new.mutation_id),new.mutation_id,
  (new.response->>'revision')::bigint,(new.response->>'cursor')::bigint,(new.request->'value'->>'goal')::integer,
  stamp,t.ticket_id,effective,gap);
 return new;
end $$;
revoke all on function waterking_private.capture_goal_receipt() from public,anon,authenticated;
create trigger waterking_goal_receipt after insert on waterking_private.sync_receipts
for each row execute function waterking_private.capture_goal_receipt();

-- Snapshot current values once, while auth writes are locked and both hooks are installed.
insert into waterking_private.goal_baselines
select u.id,statement_timestamp(),(statement_timestamp() at time zone 'Asia/Shanghai')::date+1,
 coalesce(e.revision,0),e.value is not null,(e.value->>'goal')::integer
from auth.users u left join waterking_private.sync_entities e on e.user_id=u.id and e.entity='settings' and e.entity_id='settings'
on conflict(user_id) do nothing;

create function waterking_private.goal_ticket() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; rev bigint; stamp timestamptz; t waterking_private.goal_tickets%rowtype;
begin
 uid:=waterking_private.require_active_user(true);stamp:=clock_timestamp();
 select coalesce((select revision from waterking_private.sync_entities where user_id=uid and entity='settings' and entity_id='settings'),0) into rev;
 insert into waterking_private.goal_tickets(user_id,base_revision,issued_at,issued_day)
 values(uid,rev,stamp,(stamp at time zone 'Asia/Shanghai')::date)
 on conflict(user_id,base_revision,issued_day) do nothing;
 select * into t from waterking_private.goal_tickets where user_id=uid and base_revision=rev and issued_day=(stamp at time zone 'Asia/Shanghai')::date;
 return jsonb_build_object('ticket',t.ticket_id,'revision',rev,'day',t.issued_day);
end $$;
revoke all on function waterking_private.goal_ticket() from public,anon,authenticated;
grant execute on function waterking_private.goal_ticket() to authenticated;
create function public.goal_ticket() returns jsonb language sql security invoker set search_path='' as $$ select waterking_private.goal_ticket(); $$;
revoke all on function public.goal_ticket() from public,anon,authenticated;
grant execute on function public.goal_ticket() to authenticated;

create function waterking_private.sync_goal_apply(p_mutation_id uuid,p_expected_revision bigint,p_value jsonb,p_ticket uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; t waterking_private.goal_tickets%rowtype; e waterking_private.goal_events%rowtype; result jsonb; current_rev bigint;
begin
 uid:=waterking_private.require_active_user(true);
 if p_mutation_id is null or p_expected_revision is null then raise exception 'Invalid goal mutation' using errcode='22023';end if;
 -- Exact legacy payload validation and transport replay remain in the existing function.
 if exists(select 1 from waterking_private.sync_receipts where user_id=uid and mutation_id=p_mutation_id) then
  result:=waterking_private.apply_mutation(p_mutation_id,'settings','settings',p_expected_revision,p_value);
  select * into e from waterking_private.goal_events where user_id=uid and mutation_id=p_mutation_id;
  -- An older cached tab may already have committed this same payload via v1.
  -- Acknowledge it without attaching new proof or changing its unknown history.
  if e.ticket_id is null then return result;end if;
  if e.ticket_id is distinct from p_ticket or (p_ticket is not null and e.event_id is distinct from p_event_id) then
   raise exception 'Goal replay metadata changed' using errcode='22023';end if;
  return result;
 end if;
 select coalesce((select revision from waterking_private.sync_entities where user_id=uid and entity='settings' and entity_id='settings'),0) into current_rev;
 -- A failed CAS must not consume another editor's ticket.
 if current_rev<>p_expected_revision then
  return waterking_private.apply_mutation(p_mutation_id,'settings','settings',p_expected_revision,p_value);
 end if;
 if p_ticket is not null then
  if p_event_id is null then raise exception 'Missing goal event' using errcode='22023';end if;
  select * into t from waterking_private.goal_tickets where user_id=uid and ticket_id=p_ticket for update;
  if not found then raise exception 'Invalid goal ticket owner' using errcode='42501';end if;
  if t.mutation_id is not null and (t.mutation_id<>p_mutation_id or t.event_id<>p_event_id) then
   raise exception 'Goal ticket already consumed' using errcode='22023';end if;
  update waterking_private.goal_tickets set mutation_id=p_mutation_id,event_id=p_event_id where user_id=uid and ticket_id=p_ticket;
 elsif p_event_id is not null then raise exception 'Event requires ticket' using errcode='22023';
 end if;
 return waterking_private.apply_mutation(p_mutation_id,'settings','settings',p_expected_revision,p_value);
end $$;
revoke all on function waterking_private.sync_goal_apply(uuid,bigint,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function waterking_private.sync_goal_apply(uuid,bigint,jsonb,uuid,uuid) to authenticated;
create function public.sync_goal_apply(p_mutation_id uuid,p_expected_revision bigint,p_value jsonb,p_ticket uuid default null,p_event_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select waterking_private.sync_goal_apply(p_mutation_id,p_expected_revision,p_value,p_ticket,p_event_id);
$$;
revoke all on function public.sync_goal_apply(uuid,bigint,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sync_goal_apply(uuid,bigint,jsonb,uuid,uuid) to authenticated;

create function waterking_private.goal_on_day(p_user uuid,p_day date)
returns table(known boolean,goal_ml integer) language sql stable security invoker set search_path='' as $$
 with candidates as (
 select b.revision,b.known,b.goal_ml from waterking_private.goal_baselines b where user_id=p_user and from_day<=p_day
 union all
 select e.revision,e.effective_day is not null,e.goal_ml from waterking_private.goal_events e
 where user_id=p_user and coalesce(e.effective_day,e.uncertain_from_day)<=p_day
 ), winner as (select * from candidates order by revision desc limit 1)
 select coalesce(w.known,false),case when w.known then w.goal_ml end from (select 1) dummy left join winner w on true;
$$;
revoke all on function waterking_private.goal_on_day(uuid,date) from public,anon,authenticated;

-- Existing public contract; replace only the private source of reliable goals.
create or replace function waterking_private.leaderboard_page(p_metric text,p_offset integer,p_snapshot text)
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
   select count(*) filter(where g.known and d.water_ml>=g.goal_ml and g.goal_ml>0) as goal_days,
     count(*) filter(where g.known) as covered_days
   from waterking_private.leaderboard_record_days(u.id,stamp) d
   cross join lateral waterking_private.goal_on_day(u.id,d.day) g
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
 'goalCoverageStart',(select min(start_day) from (
  select from_day as start_day from waterking_private.goal_baselines where user_id=uid and known
  union all select effective_day from waterking_private.goal_events where user_id=uid and effective_day is not null
 ) starts),
 'goalHistoryAvailable',(select exists(select 1 from ranked where covered_days>0))
 ) into result from version v;
 return result;
end $$;
