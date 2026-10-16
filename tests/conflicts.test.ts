import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { SyncRepository, stateVersion } from "../src/syncRepository.ts";
import { newCup, type Store } from "../src/records.ts";
import type { RemoteChange } from "../src/syncProtocol.ts";
async function fixture() {
  const r=await SyncRepository.open(new IDBFactory());
  const state: Store={entries:[{id:"record-a",kind:"water",amount:10,at:"2026-01-01T00:00:00Z"}],cup:newCup()};
  await r.save("a",state);
  return {r,state};
}
const remote: RemoteChange={entity:"record",entityId:"record-a",revision:7,cursor:"9",value:{id:"record-a",kind:"water",amount:50,at:"2026-01-01T00:00:00Z"}};
test("keep-local coalesces the reviewed entity's edits, pins remote revision and keeps unrelated work",async()=>{
  const {r,state}=await fixture();
  state.entries[0].amount=20;await r.save("a",state);
  state.entries[0].amount=30;await r.save("a",state);
  const before=await r.pending("a");
  await r.resolveConflict("a",before[0].mutationId,remote,"local",stateVersion(state));
  const after=await r.pending("a"), records=after.filter(m=>m.entity==="record");
  assert.equal(records.length,1);assert.equal(records[0].expectedRevision,7);
  assert.notEqual(records[0].mutationId,before[0].mutationId);
  assert.equal((records[0].value as {amount:number}).amount,30);
  assert.deepEqual(after.filter(m=>m.entity!=="record"),before.filter(m=>m.entity!=="record"));
  assert.deepEqual((await r.load("a"))!.state,state);
  state.entries[0].amount=40;await r.save("a",state);
  assert.equal((await r.pending("a")).at(-1)!.expectedRevision,8);r.close();
});
test("choosing a cloud deletion removes only the reviewed record and its queued versions",async()=>{
  const {r,state}=await fixture(); const before=await r.pending("a");
  await r.resolveConflict("a",before[0].mutationId,{...remote,value:null},"remote",stateVersion(state));
  assert.equal((await r.load("a"))!.state.entries.length,0);
  assert.deepEqual((await r.pending("a")),before.filter(m=>m.entity!=="record"));r.close();
});
test("changing data while reviewing or resolving the wrong queue head leaves all data untouched",async()=>{
  const {r,state}=await fixture(); const first=(await r.pending("a"))[0]; const old=stateVersion(state);
  state.entries[0].amount=20;await r.save("a",state);
  const queue=await r.pending("a");
  await assert.rejects(r.resolveConflict("a",first.mutationId,remote,"remote",old),/已变化/);
  await assert.rejects(r.resolveConflict("a","wrong",remote,"local",stateVersion(state)),/已变化/);
  await assert.rejects(r.resolveConflict("a",first.mutationId,{...remote,entityId:"other",value:{...remote.value as any,id:"other"}},"local",stateVersion(state)),/归属/);
  assert.deepEqual(await r.pending("a"),queue);assert.deepEqual((await r.load("a"))!.state,state);r.close();
});
test("using cloud contents establishes its revision for the next local edit without uploading a stale version",async()=>{
  const {r,state}=await fixture(), first=(await r.pending("a"))[0];
  await r.resolveConflict("a",first.mutationId,remote,"remote",stateVersion(state));
  const loaded=(await r.load("a"))!.state;assert.equal(loaded.entries[0].amount,50);
  loaded.entries[0].amount=60;await r.save("a",loaded);
  assert.equal((await r.pending("a")).at(-1)!.expectedRevision,7);r.close();
});
test("last successful sync is account-scoped and never written with pending uploads",async()=>{
  const {r}=await fixture();assert.equal(await r.markSynced("a"),null);
  assert.equal(await r.lastSyncedAt("a"),null);
  for(const m of await r.pending("a"))await r.acknowledge("a",m.sequence,m.mutationId,m.expectedRevision+1);
  const stamp=await r.markSynced("a");assert.ok(stamp);assert.equal(await r.lastSyncedAt("a"),stamp);
  assert.equal(await r.lastSyncedAt("b"),null);r.close();
});
