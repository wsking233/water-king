begin;
do $$
declare u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid();
 ticket jsonb; other_ticket jsonb; original_event jsonb; result jsonb; today date:=(now() at time zone 'Asia/Shanghai')::date;
 count_before integer;rev bigint; historic_user uuid:=gen_random_uuid();
begin
 insert into auth.users(id,is_anonymous) values(u,true),(b,false);
 perform set_config('request.jwt.claim.sub',u::text,true);
 -- Legacy first write: no invented default/history.
 perform public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":1000}');
 if (select known from waterking_private.goal_on_day(u,today)) then raise exception 'Legacy fabricated today';end if;
 ticket:=public.goal_ticket();
 -- A cached v1 tab can accept a queued payload first: replay acknowledges, never upgrades its date.
 select mutation_id into mid from waterking_private.goal_events where user_id=u and revision=1;
 perform public.sync_goal_apply(mid,0,'{"goal":1000}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if (select known from waterking_private.goal_on_day(u,today)) then raise exception 'Legacy replay retroactively certified';end if;
 mid:=gen_random_uuid();
 if public.goal_ticket()<>ticket then raise exception 'Ticket issue replay';end if;
 result:=public.sync_goal_apply(mid,1,'{"goal":500}',(ticket->>'ticket')::uuid,eid);
 if result->>'status'<>'applied' or (select goal_ml from waterking_private.goal_on_day(u,today))<>500 then raise exception 'Same day confirmation';end if;
 select to_jsonb(e) into original_event from waterking_private.goal_events e where user_id=u and mutation_id=mid;
 perform public.sync_goal_apply(mid,1,'{"goal":500}',(ticket->>'ticket')::uuid,eid);
 if original_event is distinct from (select to_jsonb(e) from waterking_private.goal_events e where user_id=u and mutation_id=mid) then raise exception 'Replay moved history';end if;
 begin perform public.sync_goal_apply(mid,1,'{"goal":500}',(ticket->>'ticket')::uuid,gen_random_uuid());raise exception 'Metadata reuse';exception when invalid_parameter_value then null;end;
 -- Reliable goal counts actual water; edits/deletes recalculate without accumulating receipts.
 perform public.sync_apply(gen_random_uuid(),'record','water',0,jsonb_build_object('id','water','kind','water','amount',500,'at',now()));
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'1' then raise exception 'Goal leaderboard disconnected';end if;
 perform public.sync_apply(gen_random_uuid(),'record','water',1,jsonb_build_object('id','water','kind','water','amount',400,'at',now()));
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'0' then raise exception 'Edited water counted twice';end if;
 perform public.sync_apply(gen_random_uuid(),'record','water',2,null);
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'0' then raise exception 'Deleted record counted';end if;
 -- Same-day last revision wins, including disabled targets, and carries forward.
 ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),2,'{"goal":null}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if not (select known from waterking_private.goal_on_day(u,today+1)) or (select goal_ml from waterking_private.goal_on_day(u,today)) is not null then raise exception 'Disabled state lost';end if;
 -- An old receipt CAS conflict produces no event and does not consume a fresh ticket.
 ticket:=public.goal_ticket();select count(*) into count_before from waterking_private.goal_events where user_id=u;
 result:=public.sync_goal_apply(gen_random_uuid(),0,'{"goal":2000}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if result->>'status'<>'conflict' or (select count(*) from waterking_private.goal_events where user_id=u)<>count_before
 or (select mutation_id from waterking_private.goal_tickets where user_id=u and ticket_id=(ticket->>'ticket')::uuid) is not null then raise exception 'Conflict touched history';end if;
 -- Cross-midnight/offline ticket is accepted as a private setting but not a trusted day.
 update waterking_private.goal_tickets set issued_at=now()-interval '1 day',issued_day=today-1 where user_id=u and ticket_id=(ticket->>'ticket')::uuid;
 perform public.sync_goal_apply(gen_random_uuid(),3,'{"goal":700}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if (select known from waterking_private.goal_on_day(u,today)) or (select known from waterking_private.goal_on_day(u,today+1)) then raise exception 'Expired day ticket fabricated date';end if;
 -- A later online confirmation restores only its date and later; earlier days stay unknown.
 ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),4,'{"goal":800}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if (select goal_ml from waterking_private.goal_on_day(u,today+1))<>800 or (select known from waterking_private.goal_on_day(u,today-1)) then raise exception 'Recovery rewrote old history';end if;
 -- Reused event ID rolls back ticket claim, setting, receipt, cursor and history together.
 ticket:=public.goal_ticket();
 begin perform public.sync_goal_apply(gen_random_uuid(),5,'{"goal":900}',(ticket->>'ticket')::uuid,eid);raise exception 'Duplicate business event';exception when unique_violation then null;end;
 if (select revision from waterking_private.sync_entities where user_id=u and entity='settings')<>5
 or (select mutation_id from waterking_private.goal_tickets where user_id=u and ticket_id=(ticket->>'ticket')::uuid) is not null then raise exception 'Atomic rollback failed';end if;
 -- Cross-user proof rejected, original owner history unchanged.
 perform set_config('request.jwt.claim.sub',b::text,true);
 begin perform public.sync_goal_apply(gen_random_uuid(),0,'{"goal":900}',(ticket->>'ticket')::uuid,gen_random_uuid());raise exception 'Cross owner ticket';exception when insufficient_privilege then null;end;
 other_ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),0,'{"goal":1000}',(other_ticket->>'ticket')::uuid,gen_random_uuid());
 -- Source classifiers/client dates cannot enter v1 payload.
 begin perform public.sync_apply(gen_random_uuid(),'settings','settings',1,'{"goal":100,"effective_day":"1999-01-01"}');raise exception 'Client date accepted';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 -- Ticket issued against another settings revision cannot certify queued changes.
 perform public.sync_apply(gen_random_uuid(),'settings','settings',5,'{"goal":1200}');
 perform public.sync_goal_apply(gen_random_uuid(),6,'{"goal":1400}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if (select known from waterking_private.goal_on_day(u,today)) then raise exception 'Stale base ticket trusted';end if;
 -- Simulate trusted past observations ONLY inside this rollback fixture.
 insert into auth.users(id,is_anonymous) values(historic_user,true);
 perform set_config('request.jwt.claim.sub',historic_user::text,true);
 ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),0,'{"goal":1000}',(ticket->>'ticket')::uuid,gen_random_uuid());
 update waterking_private.goal_events set effective_day=today-3,confirmed_at=now()-interval '3 days' where user_id=historic_user;
 update waterking_private.goal_tickets set issued_day=today-3,issued_at=now()-interval '3 days' where user_id=historic_user;
 if (select goal_ml from waterking_private.goal_on_day(historic_user,today-1))<>1000 then raise exception 'Historical carry forward';end if;
 perform public.sync_apply(gen_random_uuid(),'settings','settings',1,'{"goal":1100}');
 if (select known from waterking_private.goal_on_day(historic_user,today-2)) then raise exception 'Late unknown failed to retract uncertain interval';end if;
 ticket:=public.goal_ticket();
 perform public.sync_goal_apply(gen_random_uuid(),2,'{"goal":1200}',(ticket->>'ticket')::uuid,gen_random_uuid());
 if (select known from waterking_private.goal_on_day(historic_user,today-1)) or (select goal_ml from waterking_private.goal_on_day(historic_user,today+1))<>1200 then raise exception 'Restoration filled old gap';end if;
 -- Only synthetic fixture identities are deleted to check FK cleanup; entire file rolls back.
 delete from auth.users where id=historic_user;
 if exists(select 1 from waterking_private.goal_events where user_id=historic_user)
 or exists(select 1 from waterking_private.goal_tickets where user_id=historic_user)
 or exists(select 1 from waterking_private.goal_baselines where user_id=historic_user) then raise exception 'Lifecycle orphan';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('TimeZone','America/New_York',true);
 if (public.goal_ticket()->>'day')::date<>today then raise exception 'Timezone leaked';end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.goal_ticket();raise exception 'Anonymous ticket';exception when insufficient_privilege then null;end;
 begin perform public.sync_goal_apply(gen_random_uuid(),0,'{"goal":100}',null,null);raise exception 'Anonymous goal write';exception when insufficient_privilege then null;end;
 begin perform * from waterking_private.goal_events;raise exception 'History readable';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.goal_ticket();raise exception 'Missing uid';exception when insufficient_privilege then null;end;
 begin perform * from waterking_private.goal_tickets;raise exception 'Ticket table readable';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
