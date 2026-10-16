import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const notes=readFileSync('src/releases.ts','utf8');
if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||notes.match(/version: "([^"]+)"/)?.[1]!==pkg.version)throw Error('正式版本必须为 x.y.z，且更新说明包含当前版本。');
if(process.env.CI){
  const changed=execFileSync('git',['diff','--name-only','HEAD^','HEAD'],{encoding:'utf8'}).trim().split('\n');
  if(changed.some(p=>p.startsWith('src/')||p==='vite.config.js'||p.startsWith('public/'))){
    const previous=JSON.parse(execFileSync('git',['show','HEAD^:package.json'],{encoding:'utf8'}));
    const a=pkg.version.split('.').map(Number),b=previous.version.split('.').map(Number);
    const greater=a[0]>b[0]||(a[0]===b[0]&&(a[1]>b[1]||(a[1]===b[1]&&a[2]>b[2])));
    if(!greater)throw Error('用户可见代码更新必须递增正式版本号。');
  }
}
console.log(`PASS release v${pkg.version}`);
