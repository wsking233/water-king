begin;
set local timezone='America/New_York';
do $$
declare stamp timestamptz:='2026-03-01T00:00:00-05:00'; boundary timestamptz;
begin
  boundary:=stamp+interval '720 hours';
  if waterking_private.guest_expired(true,stamp,boundary-interval '1 microsecond') then raise exception 'Early expiry'; end if;
  if not waterking_private.guest_expired(true,stamp,boundary) then raise exception 'Boundary expiry missing'; end if;
  if not waterking_private.guest_expired(true,stamp,boundary+interval '1 microsecond') then raise exception 'Late expiry missing'; end if;
  if waterking_private.guest_expired(false,stamp,boundary+interval '100 years') then raise exception 'Bound user expired'; end if;
  if extract(epoch from boundary-stamp)<>2592000 then raise exception 'Not exactly 30 times 24 hours'; end if;
  if boundary<>'2026-03-31T01:00:00-04:00'::timestamptz then raise exception 'DST changed elapsed-hour policy'; end if;
end $$;
set local timezone='UTC';
select set_config('waterking.expired',gen_random_uuid()::text,true);
select set_config('waterking.active',gen_random_uuid()::text,true);
insert into auth.users(id,is_anonymous,created_at) values
  (current_setting('waterking.expired')::uuid,true,clock_timestamp()-interval '744 hours'),
  (current_setting('waterking.active')::uuid,true,clock_timestamp()-interval '744 hours');
insert into waterking_private.guest_activity values(current_setting('waterking.active')::uuid,clock_timestamp());
insert into public.profiles(user_id,nickname) values(current_setting('waterking.expired')::uuid,'expired fixture');
insert into waterking_private.sync_heads values(current_setting('waterking.expired')::uuid,1);
insert into waterking_private.sync_entities(user_id,entity,entity_id,revision,cursor,value)
  values(current_setting('waterking.expired')::uuid,'record','old',1,1,null);
insert into waterking_private.sync_receipts values(current_setting('waterking.expired')::uuid,gen_random_uuid(),'{}','{}');
select set_config('request.jwt.claim.sub',current_setting('waterking.expired'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('waterking.expired'),'is_anonymous',false)::text,true);
set local role authenticated;
do $$ begin
  begin perform public.account_status(); raise exception 'Expired status accepted'; exception when sqlstate 'PT401' then null; end;
  begin perform public.sync_pull('0',200); raise exception 'Expired pull accepted'; exception when sqlstate 'PT401' then null; end;
  begin perform public.sync_apply(gen_random_uuid(),'record','new',0,'{"id":"new","kind":"small","amount":1,"at":"2026-01-01T00:00:00Z"}');
    raise exception 'Expired upload accepted'; exception when sqlstate 'PT401' then null; end;
  begin perform * from public.profiles; raise exception 'Expired profile visible'; exception when sqlstate 'PT401' then null; end;
  begin perform waterking_private.cleanup_expired_guests(1,null); raise exception 'Client cleanup allowed'; exception when insufficient_privilege then null; end;
  begin update waterking_private.guest_activity set last_active_at=now(); raise exception 'Client activity rewrite allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from waterking_private.guest_activity where user_id=current_setting('waterking.expired')::uuid) then
    raise exception 'Rejected requests revived expired account'; end if;
  begin update auth.users set is_anonymous=false where id=current_setting('waterking.expired')::uuid;
    raise exception 'Expired binding resurrected user'; exception when sqlstate 'PT401' then null; end;
  begin update auth.users set last_sign_in_at=now() where id=current_setting('waterking.expired')::uuid;
    raise exception 'Expired login resurrected user'; exception when sqlstate 'PT401' then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('waterking.active'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('waterking.active'),'is_anonymous',true)::text,true);
set local role authenticated;
do $$ declare reply jsonb; begin
  reply:=public.account_status();
  if reply->>'is_anonymous'<>'true' or (reply->>'expires_at')::timestamptz<now()+interval '719 hours' then
    raise exception 'Active guest did not renew'; end if;
end $$;
reset role;
do $$ begin
  if waterking_private.cleanup_expired_guests(1,current_setting('waterking.active')::uuid)<>0 then raise exception 'Active user deleted'; end if;
end $$;
update auth.users set is_anonymous=false where id=current_setting('waterking.active')::uuid;
update waterking_private.guest_activity set last_active_at=now()-interval '1000 hours' where user_id=current_setting('waterking.active')::uuid;
set local role authenticated;
do $$ declare reply jsonb; begin
  reply:=public.account_status();
  if reply->>'is_anonymous'<>'false' or reply->'expires_at'<>'null'::jsonb then raise exception 'Bound user used stale anonymous JWT'; end if;
end $$;
reset role;
do $$ begin
  if waterking_private.cleanup_expired_guests(1,current_setting('waterking.active')::uuid)<>0 then raise exception 'Bound user deleted'; end if;
  if waterking_private.cleanup_expired_guests(1,current_setting('waterking.expired')::uuid)<>1 then raise exception 'Expired fixture not deleted'; end if;
  if exists(select 1 from public.profiles where user_id=current_setting('waterking.expired')::uuid)
    or exists(select 1 from waterking_private.sync_entities where user_id=current_setting('waterking.expired')::uuid)
    or exists(select 1 from waterking_private.sync_heads where user_id=current_setting('waterking.expired')::uuid)
    or exists(select 1 from waterking_private.sync_receipts where user_id=current_setting('waterking.expired')::uuid) then
    raise exception 'Private data did not cascade'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('waterking.expired'),true);
set local role authenticated;
do $$ begin
  begin perform public.sync_pull('0',200); raise exception 'Deleted user JWT accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.account_status(); raise exception 'Unauthenticated status allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
