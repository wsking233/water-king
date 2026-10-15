import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { DataSession } from "../src/dataSession.ts";
import { SyncRepository } from "../src/syncRepository.ts";
import { KEY, STORE_KEY, newCup } from "../src/records.ts";

test("local async saves retain original format, detect stale pages and never overwrite corrupt data on read", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string,value: string) => { values.set(key,value); },
  } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, "localStorage", prior); else Reflect.deleteProperty(globalThis,"localStorage"); });
  values.set(KEY,"[]");
  const session = new DataSession("local", null, () => true);
  const first = await session.read();
  const saved = await session.save({ ...first.state, goal: null }, first.version);
  assert.equal(JSON.parse(values.get(STORE_KEY)!).goal, null);
  assert.equal(values.get(KEY), "[]");
  await assert.rejects(session.save({ ...first.state, goal: 1800 }, first.version), /其他页面/);
  assert.equal((await session.read()).version, saved.version);
  values.set(STORE_KEY, "broken");
  const broken = await session.read();
  assert.notEqual(broken.error, "");
  assert.equal(values.get(STORE_KEY), "broken");
  await session.save({ entries: [], cup: newCup() }, broken.version);
  assert.equal((await session.read()).error, "");
  values.set("water-king.data-owner.v1","account-a");
  const switched = await session.read();
  await assert.rejects(session.save(switched.state, switched.version), /数据归属已变化/);
  session.invalidate();
  await assert.rejects(session.save(saved.state, saved.version), /账号已变化/);
});
test("account session cannot write after identity changes; its queue and snapshot remain isolated", async () => {
  const r = await SyncRepository.open(new IDBFactory());
  await r.save("a", { entries: [], cup: newCup() });
  let active = true;
  const session = new DataSession("a",r,()=>active);
  const initial = await session.read();
  active = false;
  const queue = await r.pending("a");
  await assert.rejects(session.save({ ...initial.state,goal:null },initial.version), /账号已变化/);
  assert.deepEqual(await r.pending("a"),queue);
  assert.equal(await r.load("b"),null);
  r.close();
});
