// Browser + real PostgreSQL SQL integration, using isolated PGlite and synthetic identities.
import { PGlite } from '@electric-sql/pglite';
import { chromium } from 'playwright-core';
import { build,preview } from 'vite';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const db=new PGlite();const sql=f=>readFile(new URL(`../supabase/${f}`,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,is_anonymous boolean not null default false,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of ['schema.sql','sync-schema.sql','lifecycle-upgrade.sql','leaderboard-record-facts.sql','leaderboard.sql','leaderboard-preference.sql'])await db.exec(await sql(file));
await db.exec('begin;'+await sql('goal-history.sql')+'commit;');
await db.exec(await sql('achievement-facts.sql'));await db.exec(await sql('achievements.sql'));
const outDir=await mkdtemp(join(tmpdir(),'wk-goal-history-'));
await build({base:'/water-king/',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://test.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_browser_test')},build:{outDir,emptyOutDir:true},logLevel:'error'});
const server=await preview({base:'/water-king/',build:{outDir},preview:{host:'127.0.0.1',port:0}});
const origin=`http://127.0.0.1:${server.httpServer.address().port}/water-king/`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const errors=[];let chain=Promise.resolve();let failAchievements=false;let checkedLocalAchievements=false;
async function contextFor(id){
 await db.query('insert into auth.users(id,is_anonymous) values($1,true) on conflict do nothing',[id]);
 await db.query('insert into public.profiles(user_id,nickname) values($1,$2) on conflict do nothing',[id,id===ids[0]?'水友甲':'水友乙']);
 const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
 const user={id,aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()};
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,aud:'authenticated',role:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.c2lnbmF0dXJl`;
 const session={access_token:token,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
 await context.route('https://test.supabase.co/**',route=>{
  const work=async()=>{
   const req=route.request(),url=new URL(req.url());
   const json=v=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v)});
   if(url.pathname==='/auth/v1/signup')return json(session);
   if(url.pathname==='/auth/v1/user')return json(user);
   if(url.pathname.includes('/profiles'))return json((await db.query('select * from public.profiles where user_id=$1',[id])).rows[0]);
   if(url.pathname.endsWith('/achievement_page')&&failAchievements)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'temporary failure'})});
   const p=req.postDataJSON()??{};
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
   let query,args=[];
   if(url.pathname.endsWith('/achievement_page'))query='select public.achievement_page() as result';
   else if(url.pathname.endsWith('/account_status'))query='select public.account_status() as result';
   else if(url.pathname.endsWith('/goal_ticket'))query='select public.goal_ticket() as result';
   else if(url.pathname.endsWith('/sync_goal_apply')){query='select public.sync_goal_apply($1,$2,$3::jsonb,$4,$5) as result';args=[p.p_mutation_id,p.p_expected_revision,JSON.stringify(p.p_value),p.p_ticket,p.p_event_id];}
   else if(url.pathname.endsWith('/sync_apply')){query='select public.sync_apply($1,$2,$3,$4,$5::jsonb) as result';args=[p.p_mutation_id,p.p_entity,p.p_entity_id,p.p_expected_revision,JSON.stringify(p.p_value)];}
   else if(url.pathname.endsWith('/sync_pull')){query='select public.sync_pull($1,$2) as result';args=[p.p_after,p.p_limit];}
   else if(url.pathname.endsWith('/leaderboard_page')){query='select public.leaderboard_page($1,$2,$3) as result';args=[p.p_metric,p.p_offset,p.p_snapshot];}
   else if(url.pathname.endsWith('/leaderboard_preference'))query='select public.leaderboard_preference() as result';
   else if(url.pathname.endsWith('/leaderboard_participation')){query='select public.leaderboard_participation($1) as result';args=[p.p_enabled];}
   else throw Error(`Unexpected endpoint ${url.pathname}`);
   return json((await db.query(query,args)).rows[0].result);
  };
  const result=chain.then(work);chain=result.catch(e=>{errors.push(e.message);});return result;
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {context,page};
}
async function connect(page,water=0){
 await page.goto(origin);
 if(water){await page.getByRole('button',{name:'嘬一口',exact:false}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2'))?.entries.length===1);await page.evaluate(w=>{const state=JSON.parse(localStorage.getItem('water-king.state.v2'));state.entries[0].amount=w;state.goal=100;localStorage.setItem('water-king.state.v2',JSON.stringify(state));},water);await page.reload();}
 await page.getByRole('button',{name:'我的',exact:true}).click();
 if(!checkedLocalAchievements){
  await page.getByRole('button',{name:/我的成就/}).click();
  await page.getByRole('button',{name:'返回我的，接入云同步'}).waitFor();
  assert.equal(await page.locator('.achievement-card').count(),0);
  await page.getByRole('button',{name:'返回我的，接入云同步'}).click();checkedLocalAchievements=true;
 }
 await page.getByRole('button',{name:'游客登录',exact:true}).click();
 await page.getByRole('button',{name:'设置云同步',exact:true}).click();await page.getByRole('button',{name:'确认接入同步',exact:true}).click();
 await page.getByText('私人记录',{exact:true}).waitFor();await page.getByRole('button',{name:'我的',exact:true}).click();await page.getByText('记录已同步',{exact:true}).waitFor();
}
async function goal(page,value,online=true){
 await page.getByRole('button',{name:'我的',exact:true}).click();await page.getByRole('button',{name:/每日饮水目标/}).click();
 if(online)await page.getByText(/服务器北京日期/).waitFor();else await page.getByText(/当前没有日期凭证/).waitFor();
 await page.getByRole('spinbutton',{name:'每日饮水目标'}).fill(String(value));await page.getByRole('button',{name:'保存目标',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 if(online)await page.getByText('记录已同步',{exact:true}).waitFor();
}
async function myGoalScore(page,expected){
 await page.getByRole('button',{name:'排行',exact:true}).click();await page.getByRole('tab',{name:'目标完成',exact:true}).click();
 await page.locator('.leaderboard-mine').getByText(new RegExp(`· ${expected} 天`)).waitFor();
}
try{
 const a=await contextFor(ids[0]);await connect(a.page,250);await myGoalScore(a.page,0);
 await goal(a.page,100);await myGoalScore(a.page,1); // Same-value save explicitly confirms history.
 const b=await contextFor(ids[1]);await connect(b.page,200);await goal(b.page,100);await myGoalScore(b.page,1);
 const second=await contextFor(ids[0]);await connect(second.page);await myGoalScore(second.page,1);
 await goal(second.page,300);await myGoalScore(second.page,0);await myGoalScore(b.page,1);
 await a.page.getByRole('button',{name:'我的',exact:true}).click();await a.page.getByRole('button',{name:'立即同步',exact:true}).click();await a.page.getByRole('button',{name:/每日饮水目标.*300/}).waitFor();
 await a.context.setOffline(true);await goal(a.page,500,false);
 await a.context.setOffline(false);await a.page.getByText('记录已同步',{exact:true}).waitFor();
 await myGoalScore(a.page,0);await goal(a.page,100);await myGoalScore(a.page,1);
 await a.page.getByRole('button',{name:'我的',exact:true}).click();
 await a.page.getByRole('switch',{name:/公开参与排行榜/}).click();
 await a.page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false');
 await a.page.getByRole('button',{name:'排行',exact:true}).click();await a.page.getByText('未参与 · 可在「我的」开启').waitFor();
 assert.equal(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Actual achievement SQL, not a mock badge response: state retracts when its last record is deleted.
 await a.page.getByRole('button',{name:'我的',exact:true}).click();
 await a.page.getByRole('button',{name:/我的成就/}).click();
 await a.page.locator('.achievement-card').nth(8).waitFor();
 assert.equal(await a.page.locator('.achievement-card[data-achieved=true]').count(),1);
 failAchievements=true;await a.page.getByRole('button',{name:'刷新成就',exact:true}).click();
 await a.page.locator('.achievements-sheet [role=alert]').waitFor();
 assert.equal(await a.page.locator('.achievement-card[data-achieved=true]').count(),1);
 failAchievements=false;await a.page.getByRole('button',{name:'重试确认',exact:true}).click();
 await a.page.getByText(/服务器确认 · 北京时间/).waitFor();
 await a.context.setOffline(true);
 await a.page.getByRole('button',{name:'关闭成就',exact:true}).click();
 await a.page.getByRole('button',{name:/我的成就/}).click();
 await a.page.getByText(/缓存，尚未重新确认/).waitFor();
 assert.equal(await a.page.locator('.achievement-card[data-achieved=true]').count(),1);
 await a.context.setOffline(false);
 await a.page.getByText(/服务器确认 · 北京时间/).waitFor();
 const deletion=chain.then(async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[0]]);
  const record=(await db.query("select entity_id,revision from waterking_private.sync_entities where user_id=$1 and entity='record' and value is not null limit 1",[ids[0]])).rows[0];
  await db.query("select public.sync_apply(gen_random_uuid(),'record',$1,$2,null)",[record.entity_id,record.revision]);
 });chain=deletion;await deletion;
 await a.page.getByRole('button',{name:'刷新成就',exact:true}).click();
 await a.page.waitForFunction(()=>document.querySelectorAll('.achievement-card[data-achieved=true]').length===0);
 assert.equal(await a.page.evaluate(()=>document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth),true);
 if(process.env.SCREENSHOT_PATH){await a.page.locator('dialog').evaluate(d=>{d.scrollTop=0;});await a.page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:false});}
 await a.page.getByRole('button',{name:'关闭成就',exact:true}).click();
 await b.page.getByRole('button',{name:'我的',exact:true}).click();
 await b.page.getByRole('button',{name:/我的成就/}).click();
 await b.page.waitForFunction(()=>document.querySelectorAll('.achievement-card[data-achieved=true]').length===1);
 assert.deepEqual(errors,[]);
 console.log('PASS browser + production SQL: two users, two devices, same-value goal confirmation, real goal score, online edit, offline unknown, later recovery and privacy exit; private achievements, offline cache, cross-account isolation and retraction');
}finally{await browser.close();await chain;await db.close();await server.close();await rm(outDir,{recursive:true,force:true});}
