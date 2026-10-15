-- WK-03 protocol. Only the two invoker RPC wrappers are exposed via Data API.
-- Private definer helpers enforce auth.uid(), ownership and every write invariant;
-- clients have no table-write grants with which to bypass version/receipt checks.
create schema if not exists waterking_private;
revoke all on schema waterking_private from public, anon, authenticated;
grant usage on schema waterking_private to authenticated;

create table waterking_private.sync_heads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cursor bigint not null default 0 check (cursor >= 0)
);
create table waterking_private.sync_entities (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('record', 'settings', 'cup')),
  entity_id text not null check (length(entity_id) <= 256),
  revision bigint not null check (revision between 1 and 9007199254740991),
  cursor bigint not null check (cursor > 0),
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity, entity_id),
  unique (user_id, cursor)
);
create table waterking_private.sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  primary key (user_id, mutation_id)
);
alter table waterking_private.sync_heads enable row level security;
alter table waterking_private.sync_entities enable row level security;
alter table waterking_private.sync_receipts enable row level security;
create policy owner_only on waterking_private.sync_heads
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_only on waterking_private.sync_entities
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_only on waterking_private.sync_receipts
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on all tables in schema waterking_private from public, anon, authenticated;

create function waterking_private.apply_mutation(
  p_mutation_id uuid, p_entity text, p_entity_id text,
  p_expected_revision bigint, p_value jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  head bigint;
  previous waterking_private.sync_entities%rowtype;
  receipt waterking_private.sync_receipts%rowtype;
  payload jsonb;
  response jsonb;
  stamp timestamptz;
begin
  if uid is null or not exists (select 1 from auth.users where id = uid) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_entity is null or p_entity not in ('record','settings','cup')
    or p_entity_id is null or length(p_entity_id) > 256
    or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise exception 'Invalid mutation' using errcode = '22023';
  end if;
  -- Normalize JSON null to SQL NULL: deletion remains a durable tombstone.
  if p_value = 'null'::jsonb then p_value := null; end if;
  if p_value is not null then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Invalid entity value' using errcode = '22023';
    end if;
    if p_entity = 'record' then
      if (p_value - array['id','kind','amount','at','cupId']) <> '{}'::jsonb
        or jsonb_typeof(p_value->'id') is distinct from 'string'
        or p_value->>'id' is distinct from p_entity_id
        or p_value->>'kind' is null or p_value->>'kind' not in ('water','small')
        or jsonb_typeof(p_value->'amount') is distinct from 'number'
        or jsonb_typeof(p_value->'at') is distinct from 'string'
        or (p_value ? 'cupId' and (jsonb_typeof(p_value->'cupId') <> 'string' or length(p_value->>'cupId') > 256)) then
        raise exception 'Invalid record' using errcode = '22023';
      end if;
      if (p_value->>'amount')::numeric % 1 <> 0
        or (p_value->>'kind' = 'water' and (p_value->>'amount')::numeric not between 1 and 5000)
        or (p_value->>'kind' = 'small' and (p_value->>'amount')::numeric <> 1) then
        raise exception 'Invalid amount' using errcode = '22023';
      end if;
      stamp := (p_value->>'at')::timestamptz;
      if not isfinite(stamp) or stamp > now() then
        raise exception 'Invalid record time' using errcode = '22023';
      end if;
    elsif p_entity = 'settings' then
      if p_entity_id <> 'settings' or (p_value - 'goal') <> '{}'::jsonb or not (p_value ? 'goal') then
        raise exception 'Invalid settings' using errcode = '22023';
      end if;
      if p_value->'goal' <> 'null'::jsonb then
        if jsonb_typeof(p_value->'goal') <> 'number' then
          raise exception 'Invalid goal' using errcode = '22023';
        end if;
        if (p_value->>'goal')::numeric % 1 <> 0 or (p_value->>'goal')::numeric not between 100 and 10000 then
          raise exception 'Invalid goal' using errcode = '22023';
        end if;
      end if;
    else
      if (p_value - array['id','capacity','day']) <> '{}'::jsonb
        or jsonb_typeof(p_value->'id') is distinct from 'string'
        or length(p_value->>'id') > 256
        or jsonb_typeof(p_value->'day') is distinct from 'string'
        or length(p_value->>'day') > 64
        or jsonb_typeof(p_value->'capacity') is distinct from 'number' then
        raise exception 'Invalid cup' using errcode = '22023';
      end if;
      if (p_value->>'capacity')::numeric % 1 <> 0 or (p_value->>'capacity')::numeric not between 1 and 5000 then
        raise exception 'Invalid cup capacity' using errcode = '22023';
      end if;
    end if;
  elsif p_entity <> 'record' then
    raise exception 'Only records can be deleted' using errcode = '22023';
  end if;
  payload := jsonb_build_object('entity',p_entity,'entityId',p_entity_id,'expectedRevision',p_expected_revision,'value',p_value);
  insert into waterking_private.sync_heads(user_id) values(uid) on conflict do nothing;
  -- Per-user row lock serializes commits, unlike a sequence whose values may
  -- commit out of order and let an incremental client skip a late transaction.
  select cursor into head from waterking_private.sync_heads where user_id = uid for update;
  select * into receipt from waterking_private.sync_receipts where user_id = uid and mutation_id = p_mutation_id;
  if found then
    if receipt.request <> payload then
      raise exception 'Mutation ID reused with different payload' using errcode = '22023';
    end if;
    return receipt.response;
  end if;
  select * into previous from waterking_private.sync_entities
    where user_id = uid and entity = p_entity and entity_id = p_entity_id;
  if coalesce(previous.revision,0) <> p_expected_revision then
    return jsonb_build_object('status','conflict','mutationId',p_mutation_id,
      'current',case when previous.revision is null then null else
        jsonb_build_object('entity',p_entity,'entityId',p_entity_id,
          'revision',previous.revision,'cursor',previous.cursor::text,'value',previous.value) end);
  end if;
  head := head + 1;
  insert into waterking_private.sync_entities(user_id,entity,entity_id,revision,cursor,value)
    values(uid,p_entity,p_entity_id,p_expected_revision+1,head,p_value)
    on conflict (user_id,entity,entity_id) do update
      set revision=excluded.revision,cursor=excluded.cursor,value=excluded.value,updated_at=now();
  update waterking_private.sync_heads set cursor=head where user_id=uid;
  response := jsonb_build_object('status','applied','mutationId',p_mutation_id,
    'revision',p_expected_revision+1,'cursor',head::text);
  insert into waterking_private.sync_receipts values(uid,p_mutation_id,payload,response);
  return response;
end $$;

create function waterking_private.pull_changes(p_after text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); head bigint; changes jsonb; next_cursor bigint; after_cursor bigint;
begin
  if uid is null or not exists (select 1 from auth.users where id = uid) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_after is null or p_after !~ '^(0|[1-9][0-9]*)$' or length(p_after)>19
    or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  after_cursor := p_after::bigint;
  -- Hold the same head lock used by writers while creating one consistent page.
  select cursor into head from waterking_private.sync_heads where user_id=uid for share;
  head := coalesce(head,0);
  if after_cursor > head then raise exception 'Cursor ahead of account' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entity',e.entity,'entityId',e.entity_id,
    'revision',e.revision,'cursor',e.cursor::text,'value',e.value) order by e.cursor),'[]'::jsonb), max(e.cursor)
    into changes,next_cursor from (
      select * from waterking_private.sync_entities
      where user_id=uid and cursor>after_cursor order by cursor limit p_limit
    ) e;
  return jsonb_build_object('changes',changes,'cursor',coalesce(next_cursor,head)::text,
    'hasMore',coalesce(next_cursor,head)<head);
end $$;

revoke all on function waterking_private.apply_mutation(uuid,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function waterking_private.pull_changes(text,integer) from public,anon,authenticated;
grant execute on function waterking_private.apply_mutation(uuid,text,text,bigint,jsonb) to authenticated;
grant execute on function waterking_private.pull_changes(text,integer) to authenticated;

create function public.sync_apply(p_mutation_id uuid,p_entity text,p_entity_id text,p_expected_revision bigint,p_value jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select waterking_private.apply_mutation(p_mutation_id,p_entity,p_entity_id,p_expected_revision,p_value);
$$;
create function public.sync_pull(p_after text default '0',p_limit integer default 200)
returns jsonb language sql security invoker set search_path = '' as $$
  select waterking_private.pull_changes(p_after,p_limit);
$$;
revoke all on function public.sync_apply(uuid,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.sync_pull(text,integer) from public,anon,authenticated;
grant execute on function public.sync_apply(uuid,text,text,bigint,jsonb) to authenticated;
grant execute on function public.sync_pull(text,integer) to authenticated;
