import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { SyncRepository, stateVersion } from "../src/syncRepository.ts";
import { newCup, type Store } from "../src/records.ts";
import type { RemoteChange } from "../src/syncProtocol.ts";

const at = "2026-01-01T00:00:00Z";
test("consented import deduplicates stable IDs regardless of JSON key order, retains tombstones and cloud goal", async () => {
  const r = await SyncRepository.open(new IDBFactory());
  const cup = newCup();
  const source: Store = { entries: [
    { id: "shared", kind: "water", amount: 10, at, cupId: cup.id },
    { id: "new", kind: "water", amount: 15, at, cupId: cup.id },
    { id: "deleted", kind: "small", amount: 1, at },
  ], cup, goal: 1800 };
  const original = structuredClone(source);
  const changes: RemoteChange[] = [
    { entity: "record", entityId: "shared", revision: 3, cursor: "1", value: { at, amount: 10, cupId: cup.id, kind: "water", id: "shared" } },
    { entity: "record", entityId: "deleted", revision: 2, cursor: "2", value: null },
    { entity: "settings", entityId: "settings", revision: 2, cursor: "3", value: { goal: null } },
    { entity: "cup", entityId: "other-device", revision: 1, cursor: "4", value: newCup(500) },
  ];
  await r.initializeAccount("a", { entries: [], cup: newCup() }, changes, "4", source);
  const saved = (await r.load("a"))!;
  assert.deepEqual(saved.state.entries.map(e=>e.id).sort(), ["new", "shared"]);
  assert.deepEqual(saved.state.cup, cup);
  assert.equal(saved.state.goal, null);
  const pending = await r.pending("a");
  assert.equal(pending.length, 2);
  assert.equal(pending.find(m=>m.entity === "record")?.entityId, "new");
  assert.equal(pending.find(m=>m.entity === "cup")?.entityId, r.deviceId);
  assert.deepEqual(source, original);
  assert.equal(await r.lastOwner(),"a");
  await assert.rejects(r.initializeAccount("a", source, [], "0", source));
  assert.deepEqual(await r.load("a"), saved);
  r.close();
});
test("different content under the same record ID aborts bootstrap without queue or account snapshot", async () => {
  const r = await SyncRepository.open(new IDBFactory());
  const source: Store = { entries: [{ id: "shared", kind: "water", amount: 10, at }], cup: newCup() };
  await assert.rejects(r.initializeAccount("a", { entries: [], cup: newCup() }, [{
    entity: "record", entityId: "shared", revision: 1, cursor: "1", value: { ...source.entries[0], amount: 20 },
  }], "1", source), /不同记录/);
  assert.equal(await r.load("a"), null);
  assert.deepEqual(await r.pending("a"), []);
  r.close();
});
test("cloud-only recovery uses this installation's cup, preserves revision and never uploads old local records", async () => {
  const r = await SyncRepository.open(new IDBFactory());
  const cup = newCup(300);
  await r.initializeAccount("a", { entries: [], cup: newCup() }, [
    { entity: "cup", entityId: r.deviceId, revision: 4, cursor: "1", value: cup },
    { entity: "settings", entityId: "settings", revision: 5, cursor: "2", value: { goal: 1500 } },
  ], "2", null);
  assert.deepEqual((await r.load("a"))?.state, { entries: [], cup, goal: 1500 });
  assert.deepEqual(await r.pending("a"), []);
  r.close();
});
test("two writers based on the same account view cannot silently overwrite each other", async () => {
  const r = await SyncRepository.open(new IDBFactory());
  const state: Store = { entries: [], cup: newCup() };
  await r.save("a", state);
  const before = stateVersion(state);
  const results = await Promise.allSettled([
    r.save("a", { ...state, goal: 1800 }, before),
    r.save("a", { ...state, goal: 2200 }, before),
  ]);
  assert.equal(results.filter(result=>result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result=>result.status === "rejected").length, 1);
  assert.equal((await r.pending("a")).filter(m=>m.entity === "settings").length, 2);
  r.close();
});

test("failed bootstrap transaction preserves the prior queue and never leaves a half-imported snapshot", async () => {
  const factory = new IDBFactory();
  const r = await SyncRepository.open(factory);
  const opened = factory.open("water-king.sync.v1");
  const db = await new Promise<IDBDatabase>(resolve=>{opened.onsuccess=()=>resolve(opened.result);});
  const tx = db.transaction("outbox","readwrite");
  tx.objectStore("outbox").add({ owner:"a",sequence:1,mutationId:"existing",entity:"record",entityId:"existing",expectedRevision:0,value:null });
  await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve();});
  const before = await r.pending("a");
  await assert.rejects(r.initializeAccount("a",{entries:[],cup:newCup()},[],"0",null));
  assert.equal(await r.load("a"),null);
  assert.equal(await r.lastOwner(),null);
  assert.deepEqual(await r.pending("a"),before);
  db.close(); r.close();
});
