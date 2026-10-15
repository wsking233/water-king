begin;
select set_config('waterking.test_a',gen_random_uuid()::text,true);
select set_config('waterking.test_b',gen_random_uuid()::text,true);
insert into auth.users(id,is_anonymous) values
  (current_setting('waterking.test_a')::uuid,true),
  (current_setting('waterking.test_b')::uuid,true);
select set_config('request.jwt.claim.sub',current_setting('waterking.test_a'),true);
set local role authenticated;
do $$
declare mid uuid:=gen_random_uuid(); reply jsonb; again jsonb; page jsonb; val jsonb;
begin
  val := jsonb_build_object('id','legacy-record','kind','water','amount',10,'at','2026-01-01T00:00:00Z');
  reply := public.sync_apply(mid,'record','legacy-record',0,val);
  again := public.sync_apply(mid,'record','legacy-record',0,val);
  if reply <> again or reply->>'revision' <> '1' or reply->>'cursor' <> '1' then
    raise exception 'Receipt replay failed';
  end if;
  begin
    perform public.sync_apply(mid,'record','legacy-record',0,val || '{"amount":20}'::jsonb);
    raise exception 'Reused mutation ID accepted';
  exception when invalid_parameter_value then null; end;
  reply := public.sync_apply(gen_random_uuid(),'record','legacy-record',0,val);
  if reply->>'status' <> 'conflict' or reply->'current'->>'revision' <> '1' then
    raise exception 'Stale update not detected';
  end if;
  perform public.sync_apply(gen_random_uuid(),'record','legacy-record',1,null);
  reply := public.sync_apply(gen_random_uuid(),'record','legacy-record',1,val);
  if reply->>'status' <> 'conflict' or reply->'current'->'value' <> 'null'::jsonb then
    raise exception 'Stale edit resurrected deletion';
  end if;
  perform public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":null}');
  perform public.sync_apply(gen_random_uuid(),'cup','device-a',0,'{"id":"cup-a","capacity":250,"day":"2026-0-1"}');
  page := public.sync_pull('0',1);
  if jsonb_array_length(page->'changes') <> 1 or page->>'cursor' <> '2'
    or page->>'hasMore' <> 'true' or page->'changes'->0->'value' <> 'null'::jsonb then
    raise exception 'Paginated tombstone missing';
  end if;
  page := public.sync_pull(page->>'cursor',1);
  if page->>'cursor' <> '3' then raise exception 'Page cursor skipped settings'; end if;
  page := public.sync_pull(page->>'cursor',1);
  if page->>'cursor' <> '4' or page->>'hasMore' <> 'false' then raise exception 'Final page incorrect'; end if;
  if jsonb_array_length(public.sync_pull('4',100)->'changes') <> 0 then raise exception 'Empty page incorrect'; end if;
  -- A later edit to an already delivered entity must appear beyond the cursor.
  perform public.sync_apply(gen_random_uuid(),'record','legacy-record',2,val);
  page := public.sync_pull('4',1);
  if page->>'cursor' <> '5' or page->'changes'->0->>'revision' <> '3' then
    raise exception 'Edit after pagination was skipped';
  end if;
  reply := public.sync_apply(mid,'record','legacy-record',0,val);
  if reply <> again then raise exception 'Receipt changed after later edits'; end if;
  reply := public.sync_apply(gen_random_uuid(),'record','missing-record',1,val || '{"id":"missing-record"}'::jsonb);
  if reply->>'status' <> 'conflict' or reply->'current' <> 'null'::jsonb then
    raise exception 'Missing-entity conflict invalid';
  end if;
  begin
    perform public.sync_apply(gen_random_uuid(),'record','bad',0,'{"id":"bad","kind":"water","amount":-10,"at":"2026-01-01T00:00:00Z"}');
    raise exception 'Invalid amount accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":2000,"user_id":"forged"}');
    raise exception 'Injected fields accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.sync_pull('999',1);
    raise exception 'Ahead cursor accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from waterking_private.sync_entities;
    raise exception 'Direct private table access allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('waterking.test_b'),true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.sync_pull('0',200)->'changes') <> 0 then
    raise exception 'Other account data leaked';
  end if;
  perform public.sync_apply(gen_random_uuid(),'record','legacy-record',0,
    '{"id":"legacy-record","kind":"small","amount":1,"at":"2026-01-01T00:00:00Z"}');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin
    perform public.sync_pull('0',200);
    raise exception 'Unauthenticated RPC allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
