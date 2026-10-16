import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const sql = name => readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,is_anonymous boolean not null default false,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const name of ['schema.sql','sync-schema.sql','lifecycle-upgrade.sql','leaderboard-record-facts.sql','leaderboard.sql']) await db.exec(await sql(name));
 for(let round=1;round<=3;round++) {
  await db.exec(await sql('leaderboard.test.sql'));
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,0);
  console.log(`PASS leaderboard production SQL replay ${round}/3`);
 }
} finally {await db.close();}
