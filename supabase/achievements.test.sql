begin;
create function pg_temp.achievement_met(p_id text) returns boolean language sql as $$
 select (item->>'achieved')::boolean from jsonb_array_elements(public.achievement_page()->'items') item where item->>'id'=p_id;
$$;
do $$
declare u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); expired uuid:=gen_random_uuid(); r jsonb; mid uuid:=gen_random_uuid();
 stamp timestamptz:=((now() at time zone 'Asia/Shanghai')::date-40)::timestamp at time zone 'Asia/Shanghai';
 today date:=(now() at time zone 'Asia/Shanghai')::date;ticket jsonb;
begin
 insert into auth.users(id,is_anonymous,created_at) values(u,true,now()),(b,false,now()),(expired,true,now()-interval '31 days');
 perform set_config('achievement_test.u',u::text,true);
 perform set_config('achievement_test.b',b::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 r:=public.achievement_page();
 if jsonb_array_length(r->'items')<>9 or r->>'achievedCount'<>'0' then raise exception 'Empty catalogue';end if;
 -- Seven distinct past days unlock longest historical streak despite no record today/yesterday.
 for n in 0..6 loop
  perform public.sync_apply(case when n=0 then mid else gen_random_uuid() end,'record','day-'||n,0,
   jsonb_build_object('id','day-'||n,'kind',case when n=0 then 'small' else 'water' end,'amount',case when n=0 then 1 else 200 end,'at',stamp+n*interval '1 day'));
 end loop;
 if not pg_temp.achievement_met('first_record') or not pg_temp.achievement_met('record_days_7') or not pg_temp.achievement_met('streak_7') then raise exception 'Historical backfill';end if;
 if pg_temp.achievement_met('record_days_30') or pg_temp.achievement_met('goal_days_3') then raise exception 'Unreliable targets counted';end if;
 -- Replay and many records in one day cannot inflate distinct days.
 perform public.sync_apply(mid,'record','day-0',0,jsonb_build_object('id','day-0','kind','small','amount',1,'at',stamp));
 r:=public.achievement_page();
 if (select item->>'progress' from jsonb_array_elements(r->'items') item where item->>'id'='record_days_30')<>'7' then raise exception 'Duplicate days';end if;
 -- Deleting a middle day retracts 7-day badges; 3-day island remains.
 perform public.sync_apply(gen_random_uuid(),'record','day-3',1,null);
 if pg_temp.achievement_met('streak_7') or pg_temp.achievement_met('record_days_7') or not pg_temp.achievement_met('streak_3') then raise exception 'Deletion did not retract';end if;
 -- Restoring the same ID restores status without an award ledger.
 perform public.sync_apply(gen_random_uuid(),'record','day-3',2,jsonb_build_object('id','day-3','kind','water','amount',200,'at',stamp+interval '3 days'));
 if not pg_temp.achievement_met('streak_7') then raise exception 'Restoration';end if;
 -- Confirm a reliable goal, then simulate a server-observed past effective date only in fixture.
 ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),0,'{"goal":100}',(ticket->>'ticket')::uuid,gen_random_uuid());
 update waterking_private.goal_events set effective_day=(stamp at time zone 'Asia/Shanghai')::date,confirmed_at=stamp where user_id=u;
 update waterking_private.goal_tickets set issued_at=stamp,issued_day=(stamp at time zone 'Asia/Shanghai')::date where user_id=u;
 if not pg_temp.achievement_met('goal_days_3') or pg_temp.achievement_met('goal_days_7') then raise exception 'Goal days include urine or wrong thresholds';end if;
 for n in 7..30 loop
  perform public.sync_apply(gen_random_uuid(),'record','day-'||n,0,jsonb_build_object('id','day-'||n,'kind','water','amount',200,'at',stamp+n*interval '1 day'));
 end loop;
 if not pg_temp.achievement_met('record_days_30') or not pg_temp.achievement_met('goal_days_30') then raise exception 'Thirty days thresholds';end if;
 -- A late legacy change invalidates unverified history and retracts goal badges.
 perform public.sync_apply(gen_random_uuid(),'settings','settings',1,'{"goal":150}');
 if pg_temp.achievement_met('goal_days_3') then raise exception 'Unknown gap did not retract';end if;
 -- Other accounts see their own zero state; table readers and arbitrary user/time args do not exist.
 perform set_config('request.jwt.claim.sub',b::text,true);
 if public.achievement_page()->>'achievedCount'<>'0' then raise exception 'Cross account facts';end if;
 perform set_config('request.jwt.claim.sub',expired::text,true);
 begin perform public.achievement_page();raise exception 'Expired guest read';exception when sqlstate 'PT401' then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 r:=public.achievement_page();
 if r::text like '%'||u::text||'%' or r::text like '%"at"%' or r::text like '%"email"%' then raise exception 'Private record fields leaked';end if;
 perform set_config('TimeZone','America/New_York',true);
 if public.achievement_page()->>'day'<>today::text then raise exception 'Timezone leaked';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('achievement_test.b'),true);
do $$ begin
 if public.achievement_page()->>'achievedCount'<>'0' then raise exception 'Authenticated account isolation';end if;
 begin perform * from waterking_private.achievement_facts(current_setting('achievement_test.u')::uuid,now());raise exception 'Arbitrary user facts';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.achievement_page();raise exception 'Missing uid';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.achievement_page();raise exception 'Anonymous achievement read';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
