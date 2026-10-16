-- LB-02.1 LOCAL DESIGN PROTOTYPE ONLY. NOT A PRODUCTION MIGRATION.
-- Install only into the isolated runner, after existing sync/lifecycle schemas.
-- No existing RPC, trigger, cron, public grant or production data is changed.
create table waterking_private.goal_history_baselines_draft (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cutover_at timestamptz not null check (isfinite(cutover_at)),
  baseline_from_day date not null,
  settings_revision bigint not null check (settings_revision >= 0),
  settings_cursor bigint check (settings_cursor > 0),
  snapshot_updated_at timestamptz, -- observation metadata, never historical effective time
  baseline_known boolean not null,
  goal_ml integer check (goal_ml between 100 and 10000),
  check (baseline_known or goal_ml is null),
  -- Conservative draft: do not award the partly observed migration day.
  check (baseline_from_day = (cutover_at at time zone 'Asia/Shanghai')::date + 1)
);
create table waterking_private.goal_history_events_draft (
  user_id uuid not null references waterking_private.goal_history_baselines_draft(user_id) on delete cascade,
  event_id uuid not null,
  mutation_id uuid not null,
  settings_revision bigint not null check (settings_revision > 0),
  sync_cursor bigint not null check (sync_cursor > 0),
  goal_ml integer check (goal_ml between 100 and 10000), -- NULL = explicitly disabled, not unknown
  source text not null check (source in ('server_observed','offline_unverified','legacy_write','backup_current')),
  claimed_occurred_at timestamptz check (isfinite(claimed_occurred_at)),
  server_confirmed_at timestamptz not null check (isfinite(server_confirmed_at)),
  effective_day date,
  uncertain_from_day date,
  primary key (user_id,event_id),
  unique (user_id,mutation_id),
  unique (user_id,settings_revision),
  unique (user_id,sync_cursor),
  foreign key (user_id,mutation_id) references waterking_private.sync_receipts(user_id,mutation_id) on delete cascade,
  check ((source='server_observed' and effective_day=(server_confirmed_at at time zone 'Asia/Shanghai')::date
          and effective_day is not null and uncertain_from_day is null and claimed_occurred_at is null)
    or (source<>'server_observed' and effective_day is null and uncertain_from_day is not null
        and uncertain_from_day <= (server_confirmed_at at time zone 'Asia/Shanghai')::date))
);
-- Point lookup: filter by user and settings revision; no global history export.
create index goal_history_events_draft_day on waterking_private.goal_history_events_draft(user_id,effective_day,settings_revision desc)
  where effective_day is not null;
create index goal_history_events_draft_gap on waterking_private.goal_history_events_draft(user_id,uncertain_from_day,settings_revision desc)
  where uncertain_from_day is not null;
alter table waterking_private.goal_history_baselines_draft enable row level security;
alter table waterking_private.goal_history_events_draft enable row level security;
revoke all on waterking_private.goal_history_baselines_draft,waterking_private.goal_history_events_draft from public,anon,authenticated;

-- Trusted fixture/operator adapter. p_cutover_at is a TEST CLOCK, not client input.
create function waterking_private.draft_capture_goal_baseline(p_user uuid,p_cutover_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare current_setting_row waterking_private.sync_entities%rowtype; previous_cutover timestamptz;
begin
  if p_cutover_at is null or not isfinite(p_cutover_at) then raise exception 'Invalid cutover' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_user for update;
  select cutover_at into previous_cutover from waterking_private.goal_history_baselines_draft where user_id=p_user;
  if found then
    if previous_cutover<>p_cutover_at then raise exception 'Cutover cannot be reset' using errcode='22023'; end if;
    return;
  end if;
  select * into current_setting_row from waterking_private.sync_entities
    where user_id=p_user and entity='settings' and entity_id='settings';
  if current_setting_row.updated_at>p_cutover_at then
    raise exception 'Snapshot postdates cutover' using errcode='22023';
  end if;
  insert into waterking_private.goal_history_baselines_draft values (
    p_user,p_cutover_at,(p_cutover_at at time zone 'Asia/Shanghai')::date+1,
    coalesce(current_setting_row.revision,0),current_setting_row.cursor,current_setting_row.updated_at,
    current_setting_row.value is not null and current_setting_row.value ? 'goal',
    (current_setting_row.value->>'goal')::integer
  );
end $$;

-- Only a future server write hook can classify a change as online-observed.
-- This adapter intentionally has NO client EXECUTE grant and is NOT wired to sync_apply.
-- p_confirmed_at is injected for reproducible fixtures. Production must use clock_timestamp().
create function waterking_private.draft_capture_goal_confirmation(
  p_user uuid,p_event uuid,p_mutation uuid,p_source text,p_confirmed_at timestamptz,p_claimed_at timestamptz default null
) returns void language plpgsql security invoker set search_path='' as $$
declare receipt waterking_private.sync_receipts%rowtype; baseline waterking_private.goal_history_baselines_draft%rowtype;
  prior waterking_private.goal_history_events_draft%rowtype; revision bigint; goal integer; gap_start date;
begin
  if p_event is null or p_mutation is null then raise exception 'Stable IDs required' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_user for update;
  select * into baseline from waterking_private.goal_history_baselines_draft where user_id=p_user;
  if not found then raise exception 'Baseline required' using errcode='22023'; end if;
  select * into receipt from waterking_private.sync_receipts where user_id=p_user and mutation_id=p_mutation;
  if not found or receipt.response->>'status' is distinct from 'applied'
    or receipt.request->>'entity' is distinct from 'settings'
    or receipt.request->>'entityId' is distinct from 'settings'
    or not (receipt.request->'value' ? 'goal') then
    raise exception 'An applied settings receipt is required' using errcode='22023';
  end if;
  if p_source is null or p_source not in ('server_observed','offline_unverified','legacy_write','backup_current')
    or (p_source='server_observed' and p_claimed_at is not null) then
    raise exception 'Untrusted source classification' using errcode='22023';
  end if;
  select * into prior from waterking_private.goal_history_events_draft where user_id=p_user and mutation_id=p_mutation;
  if found then
    if prior.event_id is distinct from p_event or prior.source<>p_source or prior.claimed_occurred_at is distinct from p_claimed_at then
      raise exception 'Receipt metadata changed on replay' using errcode='22023';
    end if;
    return; -- retries cannot move the original confirmation day or create a new event
  end if;
  if p_confirmed_at is null or not isfinite(p_confirmed_at) or p_confirmed_at<baseline.cutover_at then
    raise exception 'Confirmation predates cutover' using errcode='22023';
  end if;
  revision:=(receipt.response->>'revision')::bigint;
  if revision<=baseline.settings_revision then raise exception 'Historical receipt is not new evidence' using errcode='22023'; end if;
  goal:=(receipt.request->'value'->>'goal')::integer;
  -- Unknown offline/old-client/import timing can invalidate carry-forward history.
  -- Conservative lower bound from SERVER evidence, never the claimed client day.
  if p_source<>'server_observed' then
    select max((server_confirmed_at at time zone 'Asia/Shanghai')::date) into gap_start
      from waterking_private.goal_history_events_draft
      where user_id=p_user and source='server_observed' and settings_revision<revision;
    gap_start:=coalesce(gap_start,(baseline.cutover_at at time zone 'Asia/Shanghai')::date);
  end if;
  insert into waterking_private.goal_history_events_draft values (
    p_user,p_event,p_mutation,revision,(receipt.response->>'cursor')::bigint,goal,p_source,p_claimed_at,p_confirmed_at,
    case when p_source='server_observed' then (p_confirmed_at at time zone 'Asia/Shanghai')::date end,gap_start
  );
end $$;

-- A contract fixture, NOT a score or public RPC. Future dates are allowed solely
-- to test carry-forward; a real leaderboard must bound dates by server Beijing today.
create function waterking_private.draft_goal_on_day(p_user uuid,p_day date)
returns jsonb language sql stable security invoker set search_path='' as $$
  with candidates as (
    select b.settings_revision as revision,b.baseline_known as known,b.goal_ml,'legacy_baseline'::text as source
      from waterking_private.goal_history_baselines_draft b
      where b.user_id=p_user and b.baseline_from_day<=p_day
    union all
    select e.settings_revision,true,e.goal_ml,e.source
      from waterking_private.goal_history_events_draft e
      where e.user_id=p_user and e.effective_day<=p_day
    union all
    select e.settings_revision,false,e.goal_ml,e.source
      from waterking_private.goal_history_events_draft e
      where e.user_id=p_user and e.uncertain_from_day<=p_day
  ), winner as (select * from candidates order by revision desc limit 1)
  select coalesce((select jsonb_build_object('known',known,'goal_ml',case when known then goal_ml end,
    'source',source,'settings_revision',revision) from winner),
    jsonb_build_object('known',false,'goal_ml',null,'source','no_evidence','settings_revision',null));
$$;
revoke all on function waterking_private.draft_capture_goal_baseline(uuid,timestamptz) from public,anon,authenticated;
revoke all on function waterking_private.draft_capture_goal_confirmation(uuid,uuid,uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function waterking_private.draft_goal_on_day(uuid,date) from public,anon,authenticated;
