import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Isolated PostgreSQL WASM instance. No project URL, tokens or remote data.
const db = new PGlite();
const sql = name => readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      is_anonymous boolean not null default false,
      created_at timestamptz default now(),
      last_sign_in_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  await db.exec(await sql('schema.sql'));
  await db.exec(await sql('sync-schema.sql'));
  await db.exec(await sql('lifecycle-upgrade.sql'));
  for (const test of ['profile-rls.test.sql','sync-protocol.test.sql','lifecycle.test.sql']) {
    await db.exec(await sql(test));
    console.log(`PASS isolated PostgreSQL: ${test}`);
  }
  // PostgREST table GET executes inside a READ ONLY transaction, unlike RPC POST.
  const ids=await db.query('select gen_random_uuid()::text as active,gen_random_uuid()::text as expired');
  const {active,expired}=ids.rows[0];
  await db.query(`insert into auth.users(id,is_anonymous,created_at) values
    ($1,true,now()),($2,true,now()-interval '744 hours')`,[active,expired]);
  await db.query(`insert into public.profiles(user_id,nickname) values ($1,'read-only active'),($2,'read-only expired')`,[active,expired]);
  await db.exec(`begin read only;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${active}',true);
    do $$ begin
      if (select count(*) from public.profiles)<>1 then raise exception 'Read-only GET isolation failed'; end if;
    end $$;
    select set_config('request.jwt.claim.sub','${expired}',true);
    do $$ begin
      begin perform * from public.profiles; raise exception 'Read-only expired GET allowed';
      exception when sqlstate 'PT401' then null; end;
    end $$;
    rollback;`);
  await db.query('delete from auth.users where id in ($1,$2)',[active,expired]);
  console.log('PASS isolated PostgreSQL: read-only profile GET and expiry rejection.');
  const users = await db.query('select count(*)::int as count from auth.users');
  if (users.rows[0].count !== 0) throw Error('Lifecycle test fixtures survived rollback');
  console.log('PASS: all SQL fixtures rolled back; no remote database accessed.');
} finally { await db.close(); }
