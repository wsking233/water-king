-- Read only the current user's setting; avoid calculating the all-site leaderboard in My page.
create function waterking_private.leaderboard_preference() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare uid uuid;
begin
 uid:=waterking_private.require_active_user(false);
 return coalesce((select participating from waterking_private.leaderboard_preferences where user_id=uid),true);
end $$;
revoke all on function waterking_private.leaderboard_preference() from public,anon,authenticated;
grant execute on function waterking_private.leaderboard_preference() to authenticated;
create function public.leaderboard_preference() returns boolean language sql stable security invoker set search_path='' as $$
 select waterking_private.leaderboard_preference();
$$;
revoke all on function public.leaderboard_preference() from public,anon,authenticated;
grant execute on function public.leaderboard_preference() to authenticated;
