import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const outDir = await mkdtemp(join(tmpdir(), 'water-king-email-'));
let server, browser;
try {
  await build({ base:'/water-king/', define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_browser_test'),
    'import.meta.env.VITE_CLOUD_SYNC_PREVIEW':JSON.stringify('false'),
    'import.meta.env.VITE_EMAIL_AUTH_PREVIEW':JSON.stringify('false'),
  }, build:{outDir,emptyOutDir:true},logLevel:'error' });
  server = await preview({base:'/water-king/',build:{outDir},preview:{host:'127.0.0.1',port:0}});
  const origin=`http://127.0.0.1:${server.httpServer.address().port}/water-king/`;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
  const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
  const errors=[]; context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  let user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()};
  const mutations=[]; const verifications=[]; let recoveries=0;
  const session=()=>{
    const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    return {access_token:`${b64({alg:'HS256'})}.${b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})}.c2lnbmF0dXJl`,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,user};
  };
  await context.route('https://*.supabase.co/**',async route=>{
    const req=route.request(), url=new URL(req.url());
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if(url.pathname.endsWith('/signup')) return ok(session());
    if(url.pathname.endsWith('/user')) {
      if(req.method()==='PUT') { const data=req.postDataJSON(); mutations.push(data); }
      return ok(user);
    }
    if(url.pathname.endsWith('/verify')) {
      const input=req.postDataJSON(); verifications.push(input);
      if(input.token==='000000') return route.fulfill({status:403,headers:{'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'X-Supabase-Api-Version'},contentType:'application/json',body:JSON.stringify({code:'otp_expired',msg:'Invalid OTP'})});
      user={...user,...(input.type==='recovery'?{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}:{}),is_anonymous:false,email:'test@example.com',email_confirmed_at:new Date().toISOString()};
      return ok(session());
    }
    if(url.pathname.endsWith('/recover')) {recoveries++;return ok({});}
    if(url.pathname.endsWith('/token')) {
      if(req.postDataJSON().password==='wrong') return route.fulfill({status:400,headers:{'x-supabase-api-version':'2024-01-01','access-control-expose-headers':'X-Supabase-Api-Version'},contentType:'application/json',body:JSON.stringify({code:'invalid_credentials',msg:'Invalid login credentials'})});
      user={...user,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',is_anonymous:false,email:'test@example.com',email_confirmed_at:new Date().toISOString()};
      return ok(session());
    }
    if(url.pathname.includes('/profiles')) {
      const row={user_id:user.id,nickname:'测试水友',created_at:user.created_at};
      return ok(req.method()==='GET'&&!req.headers().accept?.includes('vnd.pgrst.object')?[row]:row);
    }
    throw Error(`Unexpected request ${req.method()} ${url.pathname}`);
  });
  const page=await context.newPage(); await page.goto(origin);
  await page.getByRole('button',{name:'嘬一口',exact:false}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2'))?.entries.length===1);
  const before=await page.evaluate(()=>localStorage.getItem('water-king.state.v2'));
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'游客登录',exact:true}).click();
  await page.getByText('用户 ID：aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'绑定邮箱',exact:true}).count(),0);
  await page.goto(origin+'?email-preview=1');
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'绑定邮箱',exact:true}).click();
  let sheet=page.getByRole('dialog');
  await sheet.getByLabel('邮箱',{exact:true}).fill('test@example.com');
  await sheet.getByRole('button',{name:'发送验证邮件'}).click();
  await sheet.getByLabel('邮箱验证码').waitFor({timeout:5000}).catch(async e=>{console.error(await sheet.innerText());throw e;});
  await sheet.getByLabel('邮箱验证码').fill('000000');
  await sheet.getByRole('button',{name:'验证邮箱',exact:true}).click();
  await sheet.getByRole('alert').waitFor({timeout:5000});
  assert.match(await sheet.getByRole('alert').innerText(),/验证码无效或已过期/);
  assert.equal(mutations.filter(x=>'password'in x).length,0);
  await sheet.getByLabel('邮箱验证码').fill('123456');
  await sheet.getByRole('button',{name:'验证邮箱',exact:true}).click();
  await sheet.getByLabel('新密码',{exact:true}).fill('new-test-password');
  await sheet.getByLabel('再次输入密码').fill('different');
  await sheet.getByRole('button',{name:'保存密码'}).click();
  await sheet.getByRole('alert').filter({hasText:'两次输入一致'}).waitFor();
  await sheet.getByLabel('再次输入密码').fill('new-test-password');
  await sheet.getByRole('button',{name:'保存密码'}).click();
  await sheet.getByText('操作已完成。原有记录保留。',{exact:true}).waitFor();
  await sheet.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(user.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.deepEqual(mutations.map(({email,password})=>email?{email}:{password}),[{email:'test@example.com'},{password:'new-test-password'}]);
  await page.getByRole('button',{name:'邮箱密码登录',exact:true}).click();
  await sheet.getByLabel('邮箱',{exact:true}).fill('test@example.com');
  await sheet.getByLabel('密码',{exact:true}).fill('wrong');
  await sheet.getByRole('button',{name:'登录并切换账号'}).click();
  await sheet.getByRole('alert').filter({hasText:'邮箱或密码不正确'}).waitFor();
  assert.equal(user.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await sheet.getByLabel('密码',{exact:true}).fill('correct-password');
  await sheet.getByRole('button',{name:'登录并切换账号'}).click();
  await sheet.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByText('用户 ID：bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('water-king.state.v2')),before);
  await page.evaluate(async original=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('water-king.sync.v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
    const tx=db.transaction('snapshots','readwrite');
    const state=JSON.parse(original);state.entries=[];
    tx.objectStore('snapshots').put({owner:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',state,revisions:{},sequence:0,cursor:'0'});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  },before);
  await page.getByRole('button',{name:'找回密码',exact:true}).click();
  await sheet.getByLabel('邮箱',{exact:true}).fill('test@example.com');
  await sheet.getByRole('button',{name:'发送验证邮件'}).click();
  await sheet.getByLabel('邮箱验证码').fill('654321');
  await sheet.getByRole('button',{name:'验证邮箱',exact:true}).click();
  await sheet.getByLabel('新密码',{exact:true}).fill('recovered-password');
  await sheet.getByLabel('再次输入密码').fill('recovered-password');
  await sheet.getByRole('button',{name:'保存密码'}).click();
  await sheet.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByText('私人记录',{exact:true}).waitFor();
  assert.equal(user.id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(recoveries,1);
  assert.equal(verifications.at(-1).type,'recovery');
  assert.equal(verifications[0].type,'email_change');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto(origin);
  await page.getByRole('button',{name:'我的',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'邮箱密码登录',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: 320px email binding retains ID; invalid OTP and password mismatch block updates; password login errors preserve identity; account switch retains local records; recovery survives account-view replacement and uses recovery OTP; no real Auth or email requests.');
} finally {
  await browser?.close();
  if(server){server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}
  await rm(outDir,{recursive:true,force:true});
}
