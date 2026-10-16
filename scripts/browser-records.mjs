import {chromium} from 'playwright-core';
import {build,preview} from 'vite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const outDir=await mkdtemp(join(tmpdir(),'wk-records-'));
await build({base:'/water-king/',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(''),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('')},build:{outDir,emptyOutDir:true},logLevel:'error'});
const server=await preview({base:'/water-king/',build:{outDir},preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:320,height:740},isMobile:true,hasTouch:true,timezoneId:'America/New_York'});
const origin=`http://127.0.0.1:${server.httpServer.address().port}/water-king/`;
try{
 const page=await context.newPage();await page.goto(origin);
 await page.getByRole('button',{name:/嘬一口/}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2'))?.entries.length===1);
 const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('water-king.state.v2')));
 const dates=await page.evaluate(()=>{const d=new Date(),pad=n=>String(n).padStart(2,'0');const str=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;const today=str(d);d.setDate(d.getDate()-1);return{today,yesterday:str(d),localTime:`${str(d)}T12:10`};});
 await page.getByRole('button',{name:'记录',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'后一天',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'嘘嘘',exact:true}).click();
 await page.getByRole('button',{name:'查看当天全部记录'}).click();
 await page.getByRole('button',{name:/查看喝水 10毫升记录/}).click();
 await page.getByRole('button',{name:'编辑 10 ml 饮水明细'}).click();
 await page.getByRole('spinbutton',{name:'补记饮水量'}).fill('5');
 await page.getByRole('button',{name:'保存修改',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2')).entries[0].amount===5);
 const modified=await page.evaluate(()=>JSON.parse(localStorage.getItem('water-king.state.v2')));
 assert.equal(modified.entries[0].at,initial.entries[0].at);assert.equal(modified.entries[0].cupId,initial.entries[0].cupId);
 await page.getByRole('button',{name:'补记',exact:true}).click();
 await page.getByRole('textbox',{name:'记录时间'}).fill(dates.localTime);
 await page.getByRole('spinbutton',{name:'补记饮水量'}).fill('200');
 await page.getByRole('button',{name:'保存补记',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2')).entries.length===2);
 await page.getByRole('textbox',{name:'选择记录日期'}).fill(dates.yesterday);
 await page.getByRole('region',{name:'当日汇总'}).getByText('200',{exact:false}).waitFor();
 await page.getByRole('button',{name:'回到今天',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'选择记录日期'}).inputValue(),dates.today);
 await page.getByRole('button',{name:/查看喝水 5毫升记录/}).click();
 await page.getByRole('button',{name:'删除整杯记录',exact:true}).click();
 await page.getByText(/将删除这杯的 1 条记录/).waitFor();
 await page.getByRole('button',{name:'保留这杯记录',exact:true}).click();
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('water-king.state.v2')))).entries.length,2);
 await page.getByRole('button',{name:'删除整杯记录',exact:true}).click();
 await page.getByRole('button',{name:'确认删除整杯',exact:true}).click();
 await page.getByRole('button',{name:'撤销删除',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2')).entries.length===2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'回顾',exact:true}).click();
 assert.equal(await page.locator('.week-day').count(),7);
 // A render failure uses the recovery screen, then reloads without modifying any stored records.
 const before=await page.evaluate(()=>localStorage.getItem('water-king.state.v2'));
 const recovery=await context.newPage();await recovery.addInitScript(()=>{
  if(!sessionStorage.getItem('wk-test-render-failed')){sessionStorage.setItem('wk-test-render-failed','yes');Number.prototype.toLocaleString=function(){throw Error('planned render failure');};}
 });
 await recovery.goto(origin);await recovery.getByRole('heading',{name:'页面暂时无法显示'}).waitFor();
 assert.equal(await recovery.evaluate(()=>localStorage.getItem('water-king.state.v2')),before);
 await recovery.getByRole('button',{name:'重新打开当前版本',exact:true}).click();await recovery.getByRole('button',{name:/嘬一口/}).waitFor();
 assert.equal(await recovery.evaluate(()=>localStorage.getItem('water-king.state.v2')),before);
 // Large imported days and cup groups render in bounded batches without changing the source.
 await page.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('water-king.state.v2')),at=new Date().toISOString();
  for(let n=0;n<120;n++)state.entries.push({id:crypto.randomUUID(),kind:'water',amount:10,at,cupId:'historic-test-cup'});
  for(let n=0;n<200;n++)state.entries.push({id:crypto.randomUUID(),kind:'small',amount:1,at});
  localStorage.setItem('water-king.state.v2',JSON.stringify(state));
 });
 await page.reload();await page.getByRole('button',{name:'记录',exact:true}).click();
 assert.equal(await page.locator('.record-list .record').count(),50);
 await page.getByRole('button',{name:'再看 50 项记录'}).click();assert.equal(await page.locator('.record-list .record').count(),100);
 await page.getByRole('button',{name:/查看喝水 1200毫升记录/}).click();
 assert.equal(await page.locator('.cup-detail-row').count(),50);
 await page.getByRole('button',{name:'再看 50 条明细'}).click();assert.equal(await page.locator('.cup-detail-row').count(),100);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('water-king.state.v2')))).entries.length,322);
 await page.getByRole('button',{name:'关闭弹层'}).click();
 // Readable-but-corrupt local data stays untouched until a validated backup is explicitly confirmed.
 const damaged=await context.newPage();await damaged.goto(origin);
 await damaged.evaluate(()=>localStorage.setItem('water-king.state.v2','{broken'));
 await damaged.reload();await damaged.getByText(/本地记录暂时无法读取/).waitFor();
 await damaged.getByRole('button',{name:'我的',exact:true}).click();
 assert.equal(await damaged.getByRole('button',{name:/从备份恢复/}).isEnabled(),true);
 await damaged.getByLabel('选择备份文件').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'water-king-backup',version:1,exportedAt:new Date().toISOString(),state:JSON.parse(before)}))});
 await damaged.getByRole('button',{name:'确认替换并恢复',exact:true}).waitFor();
 assert.equal(await damaged.evaluate(()=>localStorage.getItem('water-king.state.v2')),'{broken');
 await damaged.getByRole('button',{name:'确认替换并恢复',exact:true}).click();
 await damaged.waitForFunction(()=>JSON.parse(localStorage.getItem('water-king.state.v2')).entries.length===2);
 await damaged.getByRole('button',{name:'今天',exact:true}).click();assert.equal(await damaged.getByRole('button',{name:/嘬一口/}).isEnabled(),true);
 if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH});
 console.log('PASS local records UX: filter empty state, timestamp precision, backfill/local calendar, today navigation, totals, inline delete/cancel/undo, week review, bounded large lists, crash recovery and explicit damaged-data backup repair');
}finally{await browser.close();await server.close();await rm(outDir,{recursive:true,force:true});}
