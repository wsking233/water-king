-- WK-06 core. No cleanup schedule is installed: cadence/backup retention remain pending.
create table waterking_private.guest_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null
);
alter table waterking_private.guest_activity enable row level security;
revoke all on waterking_private.guest_activity from public, anon, authenticated;
create index guest_activity_expiry on waterking_private.guest_activity(last_active_at,user_id);

-- Preserve known server-observed activity; never reset all users to migration time.
insert into waterking_private.guest_activity(user_id,last_active_at)
select u.id, coalesce(greatest(u.created_at,u.last_sign_in_at,
  (select max(p.created_at) from public.profiles p where p.user_id=u.id),
  (select max(e.updated_at) from waterking_private.sync_entities e where e.user_id=u.id)),
  '-infinity'::timestamptz)
from auth.users u;

create function waterking_private.guest_expired(p_anonymous boolean,p_last_active timestamptz,p_now timestamptz)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_anonymous is true and coalesce(p_last_active,'-infinity'::timestamptz) + interval '720 hours' <= p_now;
$$;
revoke all on function waterking_private.guest_expired(boolean,timestamptz,timestamptz) from public,anon,authenticated;

create function waterking_private.require_active_user(p_touch boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); actor auth.users%rowtype; last_active timestamptz; observed timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Shared lock order for synchronization, binding and cleanup: Auth user first.
  if p_touch is true then
    select * into actor from auth.users where id=uid for update;
  else
    -- PostgREST GET uses a read-only transaction: validation must not lock/write.
    select * into actor from auth.users where id=uid;
  end if;
  if not found then raise exception 'Authentication required' using errcode='42501'; end if;
  select a.last_active_at into last_active from waterking_private.guest_activity a where a.user_id=uid;
  last_active:=coalesce(last_active,actor.created_at,'-infinity'::timestamptz);
  observed:=clock_timestamp(); -- Evaluate AFTER any row-lock wait, not transaction start.
  if waterking_private.guest_expired(actor.is_anonymous,last_active,observed) then
    raise exception 'guest_expired' using errcode='PT401';
  end if;
  if p_touch is true and actor.is_anonymous is true then
    insert into waterking_private.guest_activity values(uid,observed)
      on conflict(user_id) do update set last_active_at=greatest(guest_activity.last_active_at,excluded.last_active_at);
  end if;
  return uid;
end $$;
revoke all on function waterking_private.require_active_user(boolean) from public,anon,authenticated;
grant execute on function waterking_private.require_active_user(boolean) to authenticated;

create function waterking_private.prevent_expired_guest_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare last_active timestamptz;
begin
  -- Auth already holds the row lock. is_anonymous is authoritative DB state,
  -- not user_metadata or the possibly stale anonymous claim from a JWT.
  if old.is_anonymous is true then
    select a.last_active_at into last_active from waterking_private.guest_activity a where a.user_id=old.id;
    if waterking_private.guest_expired(true,coalesce(last_active,old.created_at),clock_timestamp()) then
      raise exception 'guest_expired' using errcode='PT401';
    end if;
  end if;
  return new;
end $$;
revoke all on function waterking_private.prevent_expired_guest_update() from public,anon,authenticated;
create trigger waterking_guest_expiry_before_update before update on auth.users
  for each row execute function waterking_private.prevent_expired_guest_update();

create function waterking_private.account_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; anonymous boolean; deadline timestamptz;
begin
  uid:=waterking_private.require_active_user(true);
  select is_anonymous into anonymous from auth.users where id=uid;
  if anonymous then select last_active_at + interval '720 hours' into deadline
    from waterking_private.guest_activity where user_id=uid; end if;
  return jsonb_build_object('is_anonymous',anonymous,'expires_at',deadline);
end $$;
revoke all on function waterking_private.account_status() from public,anon,authenticated;
grant execute on function waterking_private.account_status() to authenticated;
create function public.account_status() returns jsonb language sql security invoker set search_path='' as $$
  select waterking_private.account_status();
$$;
revoke all on function public.account_status() from public,anon,authenticated;
grant execute on function public.account_status() to authenticated;

-- Expired credentials cannot read/update profiles even before physical cleanup.
alter policy profiles_select_own on public.profiles
  using ((select waterking_private.require_active_user(false))=user_id);
alter policy profiles_insert_own on public.profiles
  with check ((select waterking_private.require_active_user(true))=user_id);
alter policy profiles_update_own on public.profiles
  using ((select waterking_private.require_active_user(true))=user_id)
  with check ((select waterking_private.require_active_user(true))=user_id);

-- Trusted operator entry only. The optional user filter keeps integration tests
-- confined to fixture IDs; it cannot be invoked by public/anon/authenticated.
create function waterking_private.cleanup_expired_guests(p_limit integer default 100,p_only_user uuid default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare candidate record; count_removed integer:=0; anonymous boolean; last_active timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid cleanup limit' using errcode='22023'; end if;
  for candidate in
    select u.id from auth.users u left join waterking_private.guest_activity a on a.user_id=u.id
    where u.is_anonymous is true and (p_only_user is null or u.id=p_only_user)
      and coalesce(a.last_active_at,u.created_at,'-infinity'::timestamptz)+interval '720 hours'<=clock_timestamp()
    order by coalesce(a.last_active_at,u.created_at,'-infinity'::timestamptz),u.id
    for update of u skip locked limit p_limit
  loop
    -- Recheck after lock acquisition, including any completed binding/activity.
    select u.is_anonymous,coalesce(a.last_active_at,u.created_at) into anonymous,last_active
      from auth.users u left join waterking_private.guest_activity a on a.user_id=u.id where u.id=candidate.id;
    if waterking_private.guest_expired(anonymous,last_active,clock_timestamp()) then
      delete from auth.users where id=candidate.id;
      count_removed:=count_removed+1;
    end if;
  end loop;
  return count_removed;
end $$;
revoke all on function waterking_private.cleanup_expired_guests(integer,uuid) from public,anon,authenticated;
