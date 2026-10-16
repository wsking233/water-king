-- Repeatable fixture; writes only ephemeral users via the existing sync protocol.
begin;
create function pg_temp.record_change(u uuid, rid text, v jsonb, mid uuid default gen_random_uuid())
returns void language plpgsql as $$
declare rev bigint;
begin
  perform set_config('request.jwt.claim.sub',u::text,true);
  select revision into rev from waterking_private.sync_entities where user_id=u and entity='record' and entity_id=rid;
  perform public.sync_apply(mid,'record',rid,coalesce(rev,0),v);
end $$;
do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); s record;
  v jsonb:='{"id":"a","kind":"water","amount":500,"at":"2020-01-13T16:00:00Z"}';
begin
  insert into auth.users(id,is_anonymous) values(u,true),(other_user,false);
  perform pg_temp.record_change(u,'a',v,mid);
  -- Exact transport replay must not create a second fact.
  perform public.sync_apply(mid,'record','a',0,v);
  perform pg_temp.record_change(u,'b','{"id":"b","kind":"small","amount":1,"at":"2020-01-14T16:00:00Z"}');
  perform pg_temp.record_change(other_user,'a','{"id":"a","kind":"water","amount":4000,"at":"2020-01-14T16:00:00Z"}');
  select * into s from waterking_private.draft_record_scores(u,'2020-01-15T15:59:59Z');
  if s.record_days<>2 or s.current_streak<>2 or s.today_ml<>0 or s.total_ml<>500 then raise exception 'Dedup, urine day or account scope: %',s; end if;
  -- No writes at midnight; yesterday still anchors streak, then a blank day breaks it.
  if (select current_streak from waterking_private.draft_record_scores(u,'2020-01-15T16:00:00Z'))<>2
    or (select current_streak from waterking_private.draft_record_scores(u,'2020-01-16T16:00:00Z'))<>0 then raise exception 'Midnight streak'; end if;
  perform pg_temp.record_change(u,'c','{"id":"c","kind":"water","amount":700,"at":"2020-01-16T16:00:00Z"}');
  perform pg_temp.record_change(u,'gap','{"id":"gap","kind":"small","amount":1,"at":"2020-01-15T16:00:00Z"}');
  if (select current_streak from waterking_private.draft_record_scores(u,'2020-01-17T01:00:00Z'))<>4 then raise exception 'Backfill gap'; end if;
  perform pg_temp.record_change(u,'gap',null);
  if (select current_streak from waterking_private.draft_record_scores(u,'2020-01-17T01:00:00Z'))<>1 then raise exception 'Delete gap'; end if;
  -- Move and resize the same stable record: remove old day, replace amount.
  perform pg_temp.record_change(u,'a','{"id":"a","kind":"water","amount":900,"at":"2020-01-16T16:00:00Z"}');
  select * into s from waterking_private.draft_record_scores(u,'2020-01-17T01:00:00Z');
  if s.record_days<>2 or s.today_ml<>1600 or s.total_ml<>1600 then raise exception 'Edit recalculation: %',s; end if;
  -- Earlier as-of excludes records later than the server's clock.
  if (select total_ml from waterking_private.draft_record_scores(u,'2020-01-16T15:59:59Z'))<>0 then raise exception 'Future record counted'; end if;
  perform set_config('TimeZone','America/New_York',true);
  if (select today_ml from waterking_private.draft_record_scores(u,'2020-01-17T01:00:00Z'))<>1600 then raise exception 'Session timezone leaked'; end if;
  if (select total_ml from waterking_private.draft_record_scores(other_user,'2020-01-17T01:00:00Z'))<>4000 then raise exception 'Cross user contamination'; end if;
  if exists(select 1 from waterking_private.draft_record_scores(gen_random_uuid(),'2020-01-17T01:00:00Z') where record_days<>0 or current_streak<>0 or today_ml<>0 or total_ml<>0) then raise exception 'Empty scores'; end if;
  if has_function_privilege('authenticated','waterking_private.draft_record_scores(uuid,timestamptz)','execute')
    or has_function_privilege('anon','waterking_private.draft_record_days(uuid,timestamptz)','execute') then raise exception 'Private facts exposed'; end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform * from waterking_private.draft_record_scores(gen_random_uuid(),now());
    raise exception 'Authenticated reader reached private facts';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from waterking_private.draft_record_days(gen_random_uuid(),now());
    raise exception 'Anonymous reader reached private facts';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
