import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "local";
  }
}
function offlinePlugin() {
  let config;
  return {
    name: "water-king-offline",
    apply: "build",
    configResolved(value) {
      config = value;
    },
    closeBundle() {
      const root = resolve(config.root, config.build.outDir);
      writeFileSync(resolve(root, "version.json"), JSON.stringify({ version: appVersion, build: JSON.parse(config.define.__APP_BUILD__) }));
      const files = readdirSync(root, { recursive: true }).filter(
        (name) =>
          name === "index.html" ||
          name === "manifest.webmanifest" ||
          /^icon.*\.(svg|png)$/.test(name) ||
          (name.startsWith("assets/") && /\.(js|css)$/.test(name)),
      );
      const digest = createHash("sha256");
      for (const name of files.sort())
        digest.update(readFileSync(resolve(root, name)));
      const cache = `water-king-${digest.digest("hex").slice(0, 12)}`;
      writeFileSync(
        resolve(root, "sw.js"),
        `
const CACHE=${JSON.stringify(cache)};
const FILES=${JSON.stringify(files)};
const root=new URL(self.registration.scope);
const shell=new URL('index.html',root).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(name=>new Request(new URL(name,root).href,{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('water-king-')&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return;
 if(event.request.mode==='navigate') {event.respondWith((async()=>{const cached=await caches.open(CACHE).then(cache=>cache.match(shell,{ignoreVary:true}));return cached||fetch(event.request);})());return;}
 if(FILES.some(name=>url.pathname===new URL(name,root).pathname))event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;return fetch(event.request);})());
});
`,
      );
    },
  };
}
export default defineConfig(({ command }) => ({
  build: { rollupOptions: { output: { manualChunks: { supabase: ["@supabase/supabase-js"] } } } },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(command === "serve" ? "本地开发" : buildId()),
  },
  plugins: [offlinePlugin()],
}));
