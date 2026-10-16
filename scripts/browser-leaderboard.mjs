import { chromium } from 'playwright-core';
import { build,preview } from 'vite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const outDir=await mkdtemp(join(tmpdir(),'wk-leaderboard-'));
await build({base:'/water-king/',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://test.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_browser_test')},build:{outDir,emptyOutDir:true},logLevel:'error'});
const server=await preview({base:'/water-king/',build:{outDir},preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
let total=41,fail=false,stale=false,participating=true,authenticated=false;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user={id,aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,aud:'authenticated',role:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.c2lnbmF0dXJl`;
const session={access_token:token,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const rows=Array.from({length:41},(_,i)=>({nickname:i===0?'很长很长的昵称测试abcdefghijklmnopqrstuvwxyz':'水友 '+i,rank:i<2?1:3,score:i<2?500:0,empty:i>1,incomplete:false}));
await context.route('https://test.supabase.co/**',async route=>{
 const req=route.request();const url=new URL(req.url());
 const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 if(url.pathname==='/auth/v1/signup'){authenticated=true;return json(session);}
 if(url.pathname==='/auth/v1/user')return json(user);
 if(url.pathname.includes('/profiles')) return json({user_id:id,nickname:'测试水友',created_at:user.created_at});
 if(url.pathname.endsWith('account_status'))return json({is_anonymous:true,expires_at:new Date(Date.now()+720*3600000).toISOString()});
 if(url.pathname.endsWith('leaderboard_preference'))return json(participating);
 if(url.pathname.endsWith('leaderboard_participation')){participating=req.postDataJSON().p_enabled;return json(participating);}
 if(url.pathname.endsWith('leaderboard_page')) {
  if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'unavailable'})});
  const p=req.postDataJSON();return json({rows:stale&&p.p_offset?[]:rows.slice(p.p_offset,Math.min(p.p_offset+20,total)),mine:authenticated&&participating?rows[30]:null,total,participating:authenticated?participating:null,snapshot:'a'.repeat(32),stale:stale&&p.p_offset>0,hasMore:p.p_offset+20<total,updatedAt:new Date().toISOString(),day:'2026-10-17',goalHistoryAvailable:false});
 }
 return route.fulfill({status:400,contentType:'application/json',body:'{}'});
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/water-king/`);
 await page.getByRole('button',{name:'排行',exact:true}).click();
 await page.getByRole('heading',{name:'水友排行榜'}).waitFor();
 await page.locator('.leaderboard-list li').nth(19).waitFor();
 assert.equal(await page.locator('.leaderboard-list li').count(),20);
 await page.getByRole('button',{name:'再看 20 位水友'}).click();await page.locator('.leaderboard-list li').nth(39).waitFor();
 await page.getByRole('button',{name:'再看 20 位水友'}).click();await page.locator('.leaderboard-list li').nth(40).waitFor();
 assert.equal(await page.getByRole('button',{name:'再看 20 位水友'}).count(),0);
 await page.getByRole('button',{name:'刷新排行榜'}).click();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="刷新排行榜"]')?.disabled);
 assert.equal(await page.locator('.leaderboard-list li').count(),41);
 await page.getByRole('tab',{name:'连续记录',exact:true}).focus();await page.keyboard.press('End');
 assert.equal(await page.getByRole('tab',{name:'累计饮水',exact:true}).getAttribute('aria-selected'),'true');
 await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'连续记录',exact:true}).getAttribute('aria-selected'),'true');
 for(const name of ['累计记录','目标完成','今日饮水','累计饮水','连续记录']) {
  await page.getByRole('tab',{name,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.leaderboard-list li').length===20);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 stale=true;await page.getByRole('button',{name:'再看 20 位水友'}).click();await page.getByText('榜单已变化，请刷新后继续浏览。').waitFor();stale=false;
 total=0;await page.getByRole('button',{name:'重试加载'}).click();await page.getByRole('heading',{name:'还没有参与的水友'}).waitFor();
 total=19;await page.getByRole('button',{name:'刷新排行榜'}).click();await page.locator('.leaderboard-list li').nth(18).waitFor();
 assert.equal(await page.locator('.leaderboard-list li').count(),19);
 fail=true;await page.getByRole('button',{name:'刷新排行榜'}).click();await page.getByText('当前显示本页缓存，成绩可能已变化。').waitFor();fail=false;
 await context.setOffline(true);await page.getByText('缓存时间', {exact:false}).waitFor();
 await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('.leaderboard-cache'));
 await page.getByRole('button',{name:'我的',exact:true}).click();await page.getByRole('heading',{name:'排行榜隐私'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 total=41;
 await page.getByRole('button',{name:'游客登录',exact:true}).click();
 const privacy=page.getByRole('switch',{name:/公开参与排行榜/});
 await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true');
 await privacy.click();await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false');
 assert.equal(participating,false);
 await page.getByRole('button',{name:'排行',exact:true}).click();
 await page.getByText('未参与 · 可在「我的」开启').waitFor();
 await page.getByRole('button',{name:'我的',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false');
 await page.getByRole('switch',{name:/公开参与排行榜/}).click();
 await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true');
 assert.equal(participating,true);
 await page.getByRole('button',{name:'排行',exact:true}).click();
 await page.getByText('第 3 名 · 0 天 · 暂无记录').waitFor();
 if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS mobile leaderboard: five metrics, 19/20/41 rows, stale cursor, empty, retry, offline, long nickname, privacy entry, 320px');
}finally{await context.close();await browser.close();await server.close();await rm(outDir,{recursive:true,force:true});}
