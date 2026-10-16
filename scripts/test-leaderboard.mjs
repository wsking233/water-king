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
 for(const name of ['schema.sql','sync-schema.sql','lifecycle-upgrade.sql','leaderboard-record-facts.sql','leaderboard.sql','leaderboard-preference.sql']) await db.exec(await sql(name));
 for(let round=1;round<=3;round++) {
  await db.exec(await sql('leaderboard.test.sql'));
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,0);
  console.log(`PASS leaderboard production SQL replay ${round}/3`);
 }
 // Install against existing legacy settings, then roll back the entire rehearsal.
 await db.exec(`begin;
 insert into auth.users(id,is_anonymous) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false),('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 select public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":1500}');
 select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 select public.sync_apply(gen_random_uuid(),'settings','settings',0,'{"goal":null}');`);
 await db.exec(await sql('goal-history.sql'));
 await db.exec(`do $$ declare d date:=(now() at time zone 'Asia/Shanghai')::date;begin
 if (select known from waterking_private.goal_on_day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d)) then raise exception 'Partial cutover day backfilled';end if;
 if (select goal_ml from waterking_private.goal_on_day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d+1))<>1500 then raise exception 'Legacy baseline lost';end if;
 if not (select known from waterking_private.goal_on_day('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',d+1)) or (select goal_ml from waterking_private.goal_on_day('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',d+1)) is not null then raise exception 'Disabled baseline lost';end if;
 if (select known from waterking_private.goal_on_day('cccccccc-cccc-4ccc-8ccc-cccccccccccc',d+1)) then raise exception 'Missing baseline became default';end if;
 end $$;rollback;`);
 console.log('PASS atomic rollout rehearsal: existing goal/disabled/missing, next full Beijing day');
 await db.exec('begin;'+await sql('goal-history.sql')+'commit;');
 for(let round=1;round<=3;round++) {
  await db.exec(await sql('goal-history-production.test.sql'));
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,0);
  console.log(`PASS goal history production SQL replay ${round}/3`);
 }
} finally {await db.close();}
