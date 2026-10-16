-- Fully rollback-scoped; repeat this file in the SAME isolated PostgreSQL instance.
begin;
create or replace function pg_temp.change_goal(p_user uuid,p_goal jsonb) returns uuid language plpgsql as $$
declare mid uuid:=gen_random_uuid(); rev bigint;
begin
  perform set_config('request.jwt.claim.sub',p_user::text,true);
  select revision into rev from waterking_private.sync_entities where user_id=p_user and entity='settings' and entity_id='settings';
  perform public.sync_apply(mid,'settings','settings',coalesce(rev,0),jsonb_build_object('goal',p_goal));
  return mid;
end $$;
select set_config('goal_test.a',gen_random_uuid()::text,true);
select set_config('goal_test.b',gen_random_uuid()::text,true);
select set_config('goal_test.empty',gen_random_uuid()::text,true);
insert into auth.users(id,is_anonymous,created_at) values
 (current_setting('goal_test.a')::uuid,true,now()),
 (current_setting('goal_test.b')::uuid,false,now()),
 (current_setting('goal_test.empty')::uuid,true,now());
do $$
declare a uuid:=current_setting('goal_test.a')::uuid; b uuid:=current_setting('goal_test.b')::uuid;
  bad_user uuid:=gen_random_uuid();
  empty_user uuid:=current_setting('goal_test.empty')::uuid;
  cutover timestamptz:='2026-10-15T15:55:00Z'; mid uuid; old_mid uuid; event_a uuid:=gen_random_uuid();
  result jsonb; before_replay jsonb; count_before integer;
begin
  old_mid:=pg_temp.change_goal(a,'1500');
  update waterking_private.sync_entities set updated_at=cutover-interval '1 minute' where user_id=a and entity='settings';
  perform waterking_private.draft_capture_goal_baseline(a,cutover);
  perform waterking_private.draft_capture_goal_baseline(a,cutover); -- backfill replay must not duplicate
  if (select count(*) from waterking_private.goal_history_baselines_draft where user_id=a)<>1 then raise exception 'Duplicate baseline'; end if;
  if (waterking_private.draft_goal_on_day(a,'2026-10-15')->>'known') is distinct from 'false' then raise exception 'Partial migration day fabricated'; end if;
  if (waterking_private.draft_goal_on_day(a,'2026-10-14')->>'known') is distinct from 'false' then raise exception 'Old history fabricated'; end if;
  result:=waterking_private.draft_goal_on_day(a,'2026-10-16');
  if result->>'goal_ml' is distinct from '1500' or result->>'source' is distinct from 'legacy_baseline' then raise exception 'Baseline coverage incorrect'; end if;
  begin
    perform waterking_private.draft_capture_goal_baseline(a,cutover+interval '1 day');
    raise exception 'Cutover reset accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),old_mid,'server_observed',cutover);
    raise exception 'Receipt with no original confirmation time fabricated history';
  exception when invalid_parameter_value then null; end;

  -- Explicitly disabled differs from an absent goal (UI used to default absent to 2000).
  perform pg_temp.change_goal(b,'null');
  update waterking_private.sync_entities set updated_at=cutover where user_id=b and entity='settings';
  perform waterking_private.draft_capture_goal_baseline(b,cutover);
  perform waterking_private.draft_capture_goal_baseline(empty_user,cutover);
  result:=waterking_private.draft_goal_on_day(b,'2026-10-16');
  if result->>'known' is distinct from 'true' or result->'goal_ml' is distinct from 'null'::jsonb then raise exception 'Disabled lost'; end if;
  if (waterking_private.draft_goal_on_day(empty_user,'2026-10-16')->>'known') is distinct from 'false' then raise exception 'Missing target became default 2000'; end if;

  -- Migration validation fails closed without altering corrupt legacy source data.
  insert into auth.users(id,is_anonymous,created_at) values(bad_user,true,now());
  insert into waterking_private.sync_entities(user_id,entity,entity_id,revision,cursor,value)
    values(bad_user,'settings','settings',1,1,'{"goal":50}');
  update waterking_private.sync_entities set updated_at=cutover+interval '1 minute' where user_id=bad_user;
  begin
    perform waterking_private.draft_capture_goal_baseline(bad_user,cutover);
    raise exception 'Future snapshot backdated into baseline';
  exception when invalid_parameter_value then null; end;
  update waterking_private.sync_entities set updated_at=cutover where user_id=bad_user;
  begin
    perform waterking_private.draft_capture_goal_baseline(bad_user,cutover);
    raise exception 'Invalid legacy target silently normalized';
  exception when check_violation then null; end;
  if exists(select 1 from waterking_private.goal_history_baselines_draft where user_id=bad_user)
    or (select value->>'goal' from waterking_private.sync_entities where user_id=bad_user) is distinct from '50' then
    raise exception 'Failed baseline validation changed source data';
  end if;
  mid:=pg_temp.change_goal(a,'2000');
  perform waterking_private.draft_capture_goal_confirmation(a,event_a,mid,'server_observed','2026-10-15T15:58:00Z');
  before_replay:=(select to_jsonb(e) from waterking_private.goal_history_events_draft e where user_id=a and event_id=event_a);
  if before_replay is null then raise exception 'Missing captured event'; end if;
  -- Reusing transport ID returns the original receipt; capturing on a later day cannot move the event.
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.sync_apply(mid,'settings','settings',1,'{"goal":2000}');
  perform waterking_private.draft_capture_goal_confirmation(a,event_a,mid,'server_observed','2026-10-20T00:00:00Z');
  if before_replay<>(select to_jsonb(e) from waterking_private.goal_history_events_draft e where user_id=a and event_id=event_a) then raise exception 'Replay changed event'; end if;
  begin
    perform waterking_private.draft_capture_goal_confirmation(a,null,mid,'server_observed','2026-10-20T00:00:00Z');
    raise exception 'Null stable ID accepted on replay';
  exception when invalid_parameter_value then null; end;
  begin
    perform waterking_private.draft_capture_goal_confirmation(a,event_a,mid,'offline_unverified','2026-10-20T00:00:00Z','1999-01-01Z');
    raise exception 'Replay changed classification';
  exception when invalid_parameter_value then null; end;

  -- A rejected CAS never produces an applied receipt and therefore cannot enter history.
  begin
    declare rejected_id uuid:=gen_random_uuid(); conflict_reply jsonb;
    begin
      conflict_reply:=public.sync_apply(rejected_id,'settings','settings',1,'{"goal":2100}');
      if conflict_reply->>'status' is distinct from 'conflict' then raise exception 'Expected conflict'; end if;
      begin
        perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),rejected_id,'server_observed','2026-10-15T15:59:00Z');
        raise exception 'Rejected mutation created goal history';
      exception when invalid_parameter_value then null; end;
    end;
  end;
  mid:=pg_temp.change_goal(a,'1800');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'server_observed','2026-10-15T15:58:00Z');
  mid:=pg_temp.change_goal(a,'null');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'server_observed','2026-10-15T16:00:00Z');
  if waterking_private.draft_goal_on_day(a,'2026-10-15')->>'goal_ml' is distinct from '1800' then raise exception 'Same day final target or previous day changed'; end if;
  result:=waterking_private.draft_goal_on_day(a,'2026-10-16');
  if result->>'known' is distinct from 'true' or result->'goal_ml' is distinct from 'null'::jsonb then raise exception 'Beijing midnight disable wrong'; end if;
  if waterking_private.draft_goal_on_day(a,'2026-10-17')->'goal_ml' is distinct from 'null'::jsonb then raise exception 'Disabled goal did not carry forward'; end if;
  -- Existing baseline is immutable even though current settings have since changed.
  perform waterking_private.draft_capture_goal_baseline(a,cutover);
  if (select goal_ml from waterking_private.goal_history_baselines_draft where user_id=a)<>1500 then raise exception 'Rerun rewrote baseline'; end if;

  mid:=pg_temp.change_goal(a,'1500');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'server_observed','2026-10-16T01:00:00Z');
  mid:=pg_temp.change_goal(a,'1000');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'offline_unverified','2026-10-17T01:00:00Z','1999-01-01Z');
  result:=waterking_private.draft_goal_on_day(a,'2026-10-16');
  if result->>'known' is distinct from 'false' or result->>'source' is distinct from 'offline_unverified' then raise exception 'Unverified gap silently reused current/previous goal'; end if;
  if (waterking_private.draft_goal_on_day(a,'1999-01-01')->>'known') is distinct from 'false' then raise exception 'Forged old timestamp became evidence'; end if;
  if waterking_private.draft_goal_on_day(a,'2026-10-15')->>'goal_ml' is distinct from '1800' then raise exception 'Untrusted client date rewrote earlier proven day'; end if;
  mid:=pg_temp.change_goal(a,'1700');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'server_observed','2026-10-18T01:00:00Z');
  if (waterking_private.draft_goal_on_day(a,'2026-10-17')->>'known') is distinct from 'false' then raise exception 'Later target repaired unsupported past'; end if;
  if waterking_private.draft_goal_on_day(a,'2026-10-18')->>'goal_ml' is distinct from '1700' then raise exception 'Verified goal did not close gap prospectively'; end if;
  mid:=pg_temp.change_goal(a,'1200');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'backup_current','2026-10-19T01:00:00Z','2010-01-01Z');
  if (waterking_private.draft_goal_on_day(a,'2026-10-18')->>'known') is distinct from 'false' then raise exception 'Backup target became historical evidence'; end if;
  -- v1 payload remains {goal}; no client history fields have been admitted.
  perform set_config('request.jwt.claim.sub',a::text,true);
  begin
    perform public.sync_apply(gen_random_uuid(),'settings','settings',8,'{"goal":1000,"effective_day":"1999-01-01"}');
    raise exception 'Old RPC accepted forged historical date';
  exception when invalid_parameter_value then null; end;
  mid:=pg_temp.change_goal(a,'1300');
  perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'legacy_write','2026-10-20T01:00:00Z');
  if (waterking_private.draft_goal_on_day(a,'2026-10-20')->>'known') is distinct from 'false' then raise exception 'Old client was misclassified online'; end if;

  -- Stable event IDs are scoped by user, not globally, and cannot be reused for a second accepted mutation.
  mid:=pg_temp.change_goal(b,'2200');
  perform waterking_private.draft_capture_goal_confirmation(b,event_a,mid,'server_observed','2026-10-16T01:00:00Z');
  if waterking_private.draft_goal_on_day(b,'2026-10-16')->>'goal_ml' is distinct from '2200' then raise exception 'Users mixed'; end if;
  begin
    perform waterking_private.draft_capture_goal_confirmation(a,gen_random_uuid(),mid,'server_observed','2026-10-20T01:00:00Z');
    raise exception 'Another user receipt was accepted';
  exception when invalid_parameter_value then null; end;
  select count(*) into count_before from waterking_private.sync_receipts where user_id=a;
  begin
    mid:=pg_temp.change_goal(a,'1900');
    perform waterking_private.draft_capture_goal_confirmation(a,event_a,mid,'server_observed','2026-10-21T01:00:00Z');
    raise exception 'Stable event ID reused';
  exception when unique_violation then null; end;
  if (select count(*) from waterking_private.sync_receipts where user_id=a)<>count_before then raise exception 'Failed capture did not rollback paired write fixture'; end if;
end $$;
set local role authenticated;
-- Authenticated callers (including anonymous Auth users) cannot even query their own audit tables.
do $$ begin
  begin perform * from waterking_private.goal_history_events_draft; raise exception 'History table exposed'; exception when insufficient_privilege then null; end;
  begin perform waterking_private.draft_goal_on_day(current_setting('goal_test.a')::uuid,'2026-10-16'); raise exception 'History reader exposed'; exception when insufficient_privilege then null; end;
  begin perform waterking_private.draft_capture_goal_baseline(current_setting('goal_test.a')::uuid,now()); raise exception 'Client baseline forgery allowed'; exception when insufficient_privilege then null; end;
  begin perform waterking_private.draft_capture_goal_confirmation(current_setting('goal_test.a')::uuid,gen_random_uuid(),gen_random_uuid(),'server_observed',now()); raise exception 'Client source forgery allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from waterking_private.goal_history_baselines_draft; raise exception 'Anon baseline exposed'; exception when insufficient_privilege then null; end;
  begin perform waterking_private.draft_goal_on_day(current_setting('goal_test.b')::uuid,'2026-10-16'); raise exception 'Anon history exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Session timezone never determines a historical Beijing target day.
set local timezone='America/New_York';
do $$ begin
  if waterking_private.draft_goal_on_day(current_setting('goal_test.a')::uuid,'2026-10-15')->>'goal_ml' is distinct from '1800' then raise exception 'Session timezone changed target'; end if;
end $$;
rollback;
