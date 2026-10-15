-- Transactional integration test: no fixture identities or profiles survive.
begin;
select set_config('waterking.test_a', gen_random_uuid()::text, true);
select set_config('waterking.test_b', gen_random_uuid()::text, true);
insert into auth.users (id, is_anonymous) values
  (current_setting('waterking.test_a')::uuid, true),
  (current_setting('waterking.test_b')::uuid, true);
insert into public.profiles (user_id, nickname) values
  (current_setting('waterking.test_b')::uuid, 'fixture B');
select set_config('request.jwt.claim.sub', current_setting('waterking.test_a'), true);
set local role authenticated;
do $$
declare affected integer;
begin
  insert into public.profiles (user_id, nickname)
    values (auth.uid(), 'fixture A');
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'RLS leaked another profile';
  end if;
  update public.profiles set nickname = 'renamed' where user_id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own nickname update failed'; end if;
  update public.profiles set nickname = 'stolen'
    where user_id = current_setting('waterking.test_b')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-user update allowed'; end if;
  begin
    insert into public.profiles (user_id, nickname)
      values (current_setting('waterking.test_b')::uuid, 'impersonated');
    raise exception 'Cross-user insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set user_id = current_setting('waterking.test_b')::uuid;
    raise exception 'Ownership reassignment allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set nickname = '' where user_id = auth.uid();
    raise exception 'Invalid nickname allowed';
  exception when check_violation then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('waterking.test_b'), true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.profiles) <> 1
    or (select nickname from public.profiles) <> 'fixture B' then
    raise exception 'Second identity isolation failed';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.profiles;
    raise exception 'Unauthenticated access allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
