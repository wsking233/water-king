import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const appVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const outDir = await mkdtemp(join(tmpdir(), 'water-king-browser-'));
const defines = {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.co'),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_browser_test'),
  'import.meta.env.VITE_CLOUD_SYNC_PREVIEW': JSON.stringify('true'),
};
async function buildApp(version, enabled = true) {
  await build({ base: '/water-king/', define: { ...defines,
    'import.meta.env.VITE_CLOUD_SYNC_PREVIEW': JSON.stringify(enabled ? '' : 'false'), __APP_BUILD__: JSON.stringify(version) },
    build: { outDir, emptyOutDir: true }, logLevel: 'error' });
}
await buildApp('browser-first');
const server = await preview({ base: '/water-king/', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}/water-king/`;
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
  app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString() };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,aud:'authenticated',role:'authenticated',is_anonymous:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.signature`;
const session = { access_token: token, token_type:'bearer',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user };
let head = 2;
const rows = new Map([
  ['record:cloud-existing', {entity:'record',entityId:'cloud-existing',revision:1,cursor:'1',value:{id:'cloud-existing',kind:'water',amount:50,at:new Date().toISOString(),cupId:'remote-cup'}}],
  ['settings:settings', {entity:'settings',entityId:'settings',revision:1,cursor:'2',value:{goal:1200}}],
]);
const receipts = new Map();
let writes = 0;
let pulls = 0;
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/chromium',args:['--no-sandbox'],headless:true});
const context = await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
const errors = [];
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
const handleRequest = async route => {
  const req = route.request();
  const url = new URL(req.url());
  const json = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if (url.pathname === '/auth/v1/signup') return json(session);
  if (url.pathname === '/auth/v1/user') return json(user);
  if (url.pathname === '/auth/v1/token') return route.abort('internetdisconnected');
  if (url.pathname.endsWith('/leaderboard_page')) return json({rows:[],mine:null,total:0,participating:true,snapshot:'a'.repeat(32),stale:false,hasMore:false,updatedAt:new Date().toISOString(),day:'2026-10-16',goalHistoryAvailable:false});
  if (url.pathname.endsWith('/account_status')) return json({is_anonymous:true,expires_at:new Date(Date.now()+720*3600000).toISOString()});
  if (url.pathname.includes('/rest/v1/profiles')) {
    const profile = {user_id:id,nickname:'测试水友',created_at:user.created_at};
    return json(req.method() === 'GET' && !req.headers().accept?.includes('vnd.pgrst.object') ? [profile] : profile);
  }
  if (url.pathname.endsWith('/sync_pull')) {
    pulls++;
    const body = req.postDataJSON();
    const changes = [...rows.values()].filter(row=>BigInt(row.cursor)>BigInt(body.p_after)).sort((a,b)=>Number(BigInt(a.cursor)-BigInt(b.cursor)));
    return json({changes,cursor:String(head),hasMore:false});
  }
  if (url.pathname.endsWith('/sync_apply')) {
    const body = req.postDataJSON(); writes++;
    if (receipts.has(body.p_mutation_id)) return json(receipts.get(body.p_mutation_id));
    const key = `${body.p_entity}:${body.p_entity_id}`;
    const old = rows.get(key);
    if ((old?.revision ?? 0) !== body.p_expected_revision) return json({status:'conflict',mutationId:body.p_mutation_id,current:old ?? null});
    const revision = body.p_expected_revision+1;
    rows.set(key,{entity:body.p_entity,entityId:body.p_entity_id,revision,cursor:String(++head),value:body.p_value});
    const response = {status:'applied',mutationId:body.p_mutation_id,revision,cursor:String(head)};
    receipts.set(body.p_mutation_id,response);
    return json(response);
  }
  throw Error(`Unexpected request ${req.method()} ${url.pathname}`);
};
await context.route('https://*.supabase.co/**', handleRequest);
async function snapshot(page) {
  return page.evaluate(async owner => {
    const db = await new Promise((resolve,reject)=>{const q=indexedDB.open('water-king.sync.v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
    const tx=db.transaction(['snapshots','outbox'],'readonly');
    const state=await new Promise(resolve=>{const q=tx.objectStore('snapshots').get(owner);q.onsuccess=()=>resolve(q.result)});
    const queued=await new Promise(resolve=>{const q=tx.objectStore('outbox').index('owner').getAll(owner);q.onsuccess=()=>resolve(q.result)});
    db.close(); return {state,queued};
  }, id);
}
try {
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('button',{name:'嘬一口',exact:false}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2'))?.entries.length===1);
  // A first import larger than one 200-mutation pass must finish without repeated clicks.
  await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem('water-king.state.v2'));
    for(let i=0;i<205;i++)state.entries.push({id:`bulk-${i}`,kind:'water',amount:10,at:new Date(Date.now()-60000-i*1000).toISOString()});
    localStorage.setItem('water-king.state.v2',JSON.stringify(state));
  });
  await page.reload();
  const original = await page.evaluate(()=>localStorage.getItem('water-king.state.v2'));
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'游客登录',exact:true}).click();
  await page.getByRole('button',{name:'设置云同步',exact:true}).waitFor();
  assert.equal(writes,0);
  const other = await context.newPage(); await other.goto(origin);
  await page.getByRole('button',{name:'设置云同步',exact:true}).click();
  await page.getByRole('heading',{name:'接入私人云同步'}).waitFor();
  await page.getByRole('button',{name:'暂不接入',exact:true}).click();
  assert.equal(writes,0);
  await page.getByRole('button',{name:'设置云同步',exact:true}).click();
  await page.getByRole('button',{name:'确认接入同步',exact:true}).click();
  await page.getByText('私人记录',{exact:true}).waitFor();
  await other.getByText('私人记录',{exact:true}).waitFor();
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByText('记录已同步',{exact:true}).waitFor();
  const first = await snapshot(page);
  assert.equal(first.state.state.entries.length,207);
  assert.equal(first.state.state.goal,1200);
  assert.equal(first.state.state.cup.id,JSON.parse(original).cup.id);
  assert.equal(first.queued.length,0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('water-king.state.v2')),original);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await other.close();
  if(process.env.SCREENSHOT_PATH) await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  // Both explicit conflict choices must finish without discarding unrelated data.
  for(const choice of ['local','remote']) {
    const settings=rows.get('settings:settings');
    rows.set('settings:settings',{...settings,revision:settings.revision+1,cursor:String(++head),value:{goal:1500}});
    await page.getByRole('button',{name:'每日饮水目标',exact:false}).click();
    const desired=choice==='local'?2000:2500;
    await page.getByRole('dialog').getByRole('button',{name:`${desired} ml`,exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'保存目标',exact:true}).click();
    await page.getByRole('button',{name:'处理同步冲突',exact:true}).click();
    const conflict=page.getByRole('dialog');
    await conflict.getByText(`每日目标 ${desired} ml`,{exact:true}).waitFor();
    await conflict.getByText('每日目标 1500 ml',{exact:true}).waitFor();
    await conflict.getByRole('button',{name:choice==='local'?'保留本机内容':'使用云端内容',exact:true}).click();
    await page.getByText('记录已同步',{exact:true}).waitFor();
    assert.equal((await snapshot(page)).state.state.goal,choice==='local'?2000:1500);
    assert.equal(rows.get('settings:settings').value.goal,choice==='local'?2000:1500);
    assert.equal((await snapshot(page)).queued.length,0);
  }
  // A cloud-side deletion is pulled as a tombstone and must not be recreated locally.
  const remote=rows.get('record:cloud-existing');
  rows.set('record:cloud-existing',{...remote,revision:remote.revision+1,cursor:String(++head),value:null});
  await page.getByRole('button',{name:'立即同步',exact:true}).click();
  await page.getByText('记录已同步',{exact:true}).waitFor();
  assert.equal((await snapshot(page)).state.state.entries.some(e=>e.id==='cloud-existing'),false);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByText('私人记录',{exact:true}).waitFor();
  await page.getByRole('button',{name:'嘬一口',exact:false}).click();
  await page.waitForTimeout(800);
  const offline = await snapshot(page);
  assert.equal(offline.state.state.entries.length,207);
  assert.equal(offline.queued.length,1);
  assert.equal(offline.state.state.cup.id,first.state.state.cup.id);
  await context.setOffline(false);
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByText('记录已同步',{exact:true}).waitFor();
  assert.equal((await snapshot(page)).queued.length,0);
  assert.equal([...rows.values()].filter(row=>row.entity==='record'&&row.value!==null).length,207);
  await buildApp('browser-update');
  await Promise.all([
    page.waitForURL(url=>url.searchParams.has('_refresh')),
    page.getByRole('button',{name:/刷新应用/}).click(),
  ]);
  await page.getByText('私人记录',{exact:true}).waitFor();
  assert.equal((await snapshot(page)).state.state.entries.length,207);
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:`水王 v${appVersion}`,exact:false}).click();
  await page.getByText('版本诊断信息',{exact:true}).click();
  await page.getByText(/browser-update/).waitFor();
  await page.getByRole('button',{name:'检查更新',exact:true}).click();
  await page.getByRole('status').filter({hasText:`当前已是最新版本 v${appVersion}`}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  const freshAuth = await page.evaluate(()=>localStorage.getItem('sb-test-auth-token'));
  await context.setOffline(true);
  const expired = { ...session, expires_at: Math.floor(Date.now()/1000)-3600,
    access_token: `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,exp:Math.floor(Date.now()/1000)-3600,role:'authenticated'})}.signature` };
  await page.evaluate(expired=>localStorage.setItem('sb-test-auth-token',JSON.stringify(expired)),expired);
  await page.reload();
  await page.getByText('私人记录',{exact:true}).waitFor({timeout:5000});
  await page.getByRole('button',{name:'嘬一口',exact:false}).click();
  assert.equal((await snapshot(page)).queued.length,1);
  await page.evaluate(fresh=>localStorage.setItem('sb-test-auth-token',fresh),freshAuth);
  await context.setOffline(false);
  await page.reload();
  await page.getByText('私人记录',{exact:true}).waitFor();
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByText('记录已同步',{exact:true}).waitFor();
  const retained = (await snapshot(page)).state;
  const auth = await page.evaluate(()=>localStorage.getItem('sb-test-auth-token'));
  await context.close();
  await buildApp('production-closed', false);
  const closedContext = await browser.newContext({viewport:{width:320,height:740}});
  closedContext.on('page', p=>p.on('pageerror',e=>errors.push(e.message)));
  await closedContext.route('https://*.supabase.co/**',handleRequest);
  const closed = await closedContext.newPage();
  await closed.goto(origin);
  await closed.getByRole('button',{name:'嘬一口',exact:false}).waitFor();
  await closed.evaluate(async ({auth,retained})=>{
    localStorage.setItem('sb-test-auth-token',auth);
    const db=await new Promise(resolve=>{const q=indexedDB.open('water-king.sync.v1');q.onsuccess=()=>resolve(q.result)});
    const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(retained);
    await new Promise(resolve=>{tx.oncomplete=resolve});db.close();
  },{auth,retained});
  const before = {writes,pulls};
  await closed.reload();
  await closed.getByText('私人记录',{exact:true}).waitFor();
  await closed.getByRole('button',{name:'嘬一口',exact:false}).click();
  await closed.getByRole('button',{name:'我的',exact:true}).click();
  await closed.getByText('云同步正在准备中。当前仍可在本机记录和导出备份。',{exact:true}).waitFor();
  assert.equal(await closed.getByRole('button',{name:'立即同步',exact:true}).count(),0);
  assert.equal((await snapshot(closed)).queued.length,1);
  assert.deepEqual({writes,pulls},before);
  await closedContext.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: explicit consent, cancel without upload, initial merge with more than 200 mutations auto-continued, both conflict choices, release version and update check, cloud deletion tombstones, cloud goal, independent cup, original data preserved, second-tab switch, offline reload and queued recording, reconnect upload, active update preserves data, expired Auth does not block offline records, explicit test-only disabled build retains records without RPC, 320px layout.');
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await new Promise(resolve=>server.httpServer.close(resolve));
  await rm(outDir,{recursive:true,force:true});
}
