import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite(); // In-memory WASM PostgreSQL only: no URL, credentials, connector or network.
const sql = name => readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
const protocol = async()=> (await db.query(`select n.nspname,p.proname,pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','waterking_private') and p.proname not like 'draft_%'
  order by n.nspname,p.proname`)).rows;
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean not null default false,created_at timestamptz default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of ['schema.sql','sync-schema.sql','lifecycle-upgrade.sql'])await db.exec(await sql(file));
  const before=await protocol();
  await db.exec(await sql('design/goal-history.prototype.sql'));
  for(let round=1;round<=3;round++) {
    await db.exec(await sql('design/goal-history.test.sql'));
    const counts=(await db.query(`select
      (select count(*)::int from auth.users) as users,
      (select count(*)::int from waterking_private.goal_history_baselines_draft) as baselines,
      (select count(*)::int from waterking_private.goal_history_events_draft) as events,
      (select count(*)::int from waterking_private.sync_receipts) as receipts`)).rows[0];
    assert.deepEqual(counts,{users:0,baselines:0,events:0,receipts:0});
    console.log(`PASS goal history replay ${round}/3: fixtures fully rolled back`);
  }
  for(const file of ['profile-rls.test.sql','sync-protocol.test.sql','lifecycle.test.sql']) {
    await db.exec(await sql(file));console.log(`PASS unchanged existing contract: ${file}`);
  }
  assert.deepEqual(await protocol(),before);
  const security=(await db.query(`select bool_and(c.relrowsecurity) as rls
    from pg_class c where c.oid in ('waterking_private.goal_history_baselines_draft'::regclass,'waterking_private.goal_history_events_draft'::regclass)`)).rows[0];
  assert.equal(security.rls,true);
  console.log('PASS: existing functions unchanged; draft RLS enabled; no production database accessed or migration applied.');
} finally { await db.close(); }
