begin;
do $$
declare u uuid; first_user uuid; result jsonb; next_page jsonb; snap text; total integer; nowday date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 -- Thresholds include zero-record guests; competition rank remains 1 across pages.
 for n in 1..41 loop
  u:=gen_random_uuid(); if n=1 then first_user:=u; end if;
  insert into auth.users(id,is_anonymous,email_confirmed_at) values(u,n<>1,case when n=1 then now() else null end);
  insert into public.profiles(user_id,nickname) values(u,case when n=1 then 'zz verified' else 'aa guest '||n end);
  if n in (19,20,21,41) then
   result:=public.leaderboard_page('streak',0,null);
   if (result->>'total')::int<>n or jsonb_array_length(result->'rows')<>least(n,20) then raise exception 'Threshold %: %',n,result; end if;
   if result->'rows'->0->>'nickname'<>'zz verified' or result->'rows'->0->>'rank'<>'1' then raise exception 'Zero email tie'; end if;
  end if;
 end loop;
 result:=public.leaderboard_page('streak',0,null);snap:=result->>'snapshot';
 next_page:=public.leaderboard_page('streak',20,snap);
 if jsonb_array_length(next_page->'rows')<>20 or next_page->'rows'->0->>'rank'<>'1' then raise exception 'Second page'; end if;
 next_page:=public.leaderboard_page('streak',40,snap);
 if jsonb_array_length(next_page->'rows')<>1 or (next_page->>'hasMore')::boolean then raise exception 'Final page'; end if;
 perform set_config('request.jwt.claim.sub',first_user::text,true);
 if (public.leaderboard_page('streak',0,null)->'mine'->>'rank')<>'1' then raise exception 'Mine missing'; end if;
 perform public.sync_apply(gen_random_uuid(),'record','one',0,jsonb_build_object('id','one','kind','water','amount',500,'at',now()));
 perform public.sync_apply(gen_random_uuid(),'record','two',0,jsonb_build_object('id','two','kind','small','amount',1,'at',now()));
 result:=public.leaderboard_page('total',0,null);
 if result->'rows'->0->>'score'<>'500' or result->'rows'->1->>'rank'<>'2' then raise exception 'Rank after positive'; end if;
 -- Current settings never count retroactively. Only verified daily evidence counts.
 perform public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":100}');
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'0' then raise exception 'Current goal fabricated history'; end if;
 insert into waterking_private.leaderboard_daily_goals values(first_user,nowday,400);
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'1' then raise exception 'Reliable goal missing'; end if;
 update waterking_private.leaderboard_daily_goals set goal_ml=null where user_id=first_user;
 if public.leaderboard_page('goals',0,null)->'mine'->>'score'<>'0' then raise exception 'Disabled goal counted'; end if;
 perform public.leaderboard_participation(false);
 result:=public.leaderboard_page('streak',0,null);
 if (result->>'total')::int<>40 or result->'mine'<>'null'::jsonb or (result->>'participating')::boolean then raise exception 'Opt-out'; end if;
 next_page:=public.leaderboard_page('streak',20,snap);
 if not (next_page->>'stale')::boolean or next_page->'rows'<>'[]'::jsonb then raise exception 'Stale privacy cursor'; end if;
 perform public.leaderboard_participation(true);
 if public.leaderboard_page('total',0,null)->'mine'->>'score'<>'500' then raise exception 'Opt-in recomputation'; end if;
 -- No other user's UUID, raw details, kind or email fields are projected.
 result:=public.leaderboard_page('total',0,null);
 if result::text like '%'||first_user::text||'%' or result::text like '%"user_id"%' or result::text like '%"at"%' or result::text like '%"email"%' or result::text like '%"kind"%' then raise exception 'Private projection'; end if;
 insert into auth.users(id,is_anonymous,created_at) values(gen_random_uuid(),true,now()-interval '31 days');
 if public.leaderboard_page('streak',0,null)->>'total'<>'41' then raise exception 'Expired guest included'; end if;
 begin perform public.leaderboard_page('unknown',0,null);raise exception 'Bad metric';exception when invalid_parameter_value then null;end;
 begin perform public.leaderboard_page('total',-1,null);raise exception 'Bad offset';exception when invalid_parameter_value then null;end;
 begin perform public.leaderboard_page('total',20,null);raise exception 'Missing cursor';exception when invalid_parameter_value then null;end;
 begin perform public.leaderboard_page('total',20,'malicious');raise exception 'Invalid cursor';exception when invalid_parameter_value then null;end;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if public.leaderboard_page('total',0,null)->'mine'<>'null'::jsonb then raise exception 'Anonymous mine'; end if;
 begin perform public.leaderboard_participation(false);raise exception 'Anon write';exception when insufficient_privilege then null;end;
 begin perform * from waterking_private.leaderboard_daily_goals;raise exception 'Anon raw goals';exception when insufficient_privilege then null;end;
 begin perform * from waterking_private.sync_entities;raise exception 'Anon raw records';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform * from waterking_private.leaderboard_preferences;raise exception 'Direct preferences';exception when insufficient_privilege then null;end;
 begin perform public.leaderboard_participation(false);raise exception 'Unauthenticated preference';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
