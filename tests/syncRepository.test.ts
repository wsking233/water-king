import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { SyncRepository } from "../src/syncRepository.ts";
import { newCup, updateProgress } from "../src/records.ts";
import type { ChangePage } from "../src/syncProtocol.ts";

async function fixture() {
  const factory = new IDBFactory();
  return { factory, repository: await SyncRepository.open(factory) };
}

test("IndexedDB persists state, stable device and queued mutations across reopen", async () => {
  const { factory, repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup(), goal: null }, 10);
  await r.save("user-a", state);
  const queued = await r.pending("user-a");
  assert.equal(queued.length, 3);
  const deviceId = r.deviceId;
  r.close();
  const reopened = await SyncRepository.open(factory);
  assert.equal(reopened.deviceId, deviceId);
  assert.deepEqual((await reopened.load("user-a"))?.state, state);
  assert.deepEqual(await reopened.pending("user-a"), queued);
  reopened.close();
});

test("offline edit and delete preserve revision chain, tombstone and retry identity", async () => {
  const { repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup() }, 10);
  await r.save("a", state);
  await r.save("a", { ...state, entries: [{ ...state.entries[0], amount: 20 }] });
  await r.save("a", { ...state, entries: [] });
  const records = (await r.pending("a")).filter((m) => m.entity === "record");
  assert.deepEqual(records.map((m) => m.expectedRevision), [0, 1, 2]);
  assert.equal(records[2].value, null);
  assert.equal(new Set(records.map((m) => m.mutationId)).size, 3);
  assert.deepEqual((await r.pending("a")).filter((m) => m.entity === "record"), records);
  r.close();
});

test("local and account namespaces do not mix records or queues; cup targets this device", async () => {
  const { repository: r } = await fixture();
  const a = updateProgress({ entries: [], cup: newCup() }, 10);
  const b = { entries: [], cup: newCup(500) };
  await r.save("local", a);
  assert.deepEqual(await r.pending("local"), []);
  assert.equal(await r.load("a"), null);
  await r.save("a", a);
  await r.save("b", b);
  assert.deepEqual((await r.load("a"))?.state, a);
  assert.deepEqual((await r.load("b"))?.state, b);
  assert.equal((await r.pending("b")).some((m) => m.entity === "record"), false);
  assert.equal((await r.pending("a")).find((m) => m.entity === "cup")?.entityId, r.deviceId);
  r.close();
});

test("repeated save does not enqueue duplicates; invalid save leaves snapshot and queue intact", async () => {
  const { repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup() }, 10);
  await r.save("a", state);
  const queue = await r.pending("a");
  await r.save("a", state);
  assert.deepEqual(await r.pending("a"), queue);
  await assert.rejects(r.save("a", { ...state, goal: -1 }));
  assert.deepEqual((await r.load("a"))?.state, state);
  assert.deepEqual(await r.pending("a"), queue);
  r.close();
});

test("acknowledgment must match owner, mutation ID and server revision", async () => {
  const { repository: r } = await fixture();
  await r.save("a", { entries: [], cup: newCup() });
  const before = await r.pending("a");
  const m = before[0];
  await r.acknowledge("b", m.sequence, m.mutationId, 1);
  await r.acknowledge("a", m.sequence, "wrong", 1);
  await r.acknowledge("a", m.sequence, m.mutationId, 99);
  assert.deepEqual(await r.pending("a"), before);
  await r.acknowledge("a", m.sequence, m.mutationId, 1);
  assert.equal((await r.pending("a")).length, before.length - 1);
  await r.acknowledge("a", m.sequence, m.mutationId, 1);
  assert.equal((await r.pending("a")).length, before.length - 1);
  r.close();
});

test("an IndexedDB transaction failure rolls back state and every newly queued mutation", async () => {
  const { factory, repository: r } = await fixture();
  const before = { entries: [], cup: newCup() };
  await r.save("a", before);
  const queued = await r.pending("a");
  // Simulate a storage constraint failure after save has read the snapshot.
  const opened = factory.open("water-king.sync.v1", 1);
  const db = await new Promise<IDBDatabase>((resolve) => { opened.onsuccess = () => resolve(opened.result); });
  const tx = db.transaction("outbox", "readwrite");
  tx.objectStore("outbox").add({ ...queued[0], sequence: 3 });
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  const queueBefore = await r.pending("a");
  await assert.rejects(r.save("a", updateProgress(before, 10)));
  assert.deepEqual((await r.load("a"))?.state, before);
  assert.deepEqual(await r.pending("a"), queueBefore);
  db.close();
  r.close();
});

async function clean(r: SyncRepository, owner: string) {
  for (const m of await r.pending(owner))
    await r.acknowledge(owner, m.sequence, m.mutationId, m.expectedRevision + 1);
}
test("pull merges independent records and tombstones without copying another device's cup", async () => {
  const { repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup(), goal: 2000 }, 10);
  await r.save("a", state);
  await clean(r, "a");
  const remote = { id: "other", kind: "water" as const, amount: 25, at: "2026-01-01T00:00:00Z", cupId: "other-cup" };
  await r.applyPage("a", { cursor: "4", hasMore: false, changes: [
    { entity: "record", entityId: state.entries[0].id, revision: 2, cursor: "1", value: null },
    { entity: "record", entityId: remote.id, revision: 1, cursor: "2", value: remote },
    { entity: "settings", entityId: "settings", revision: 2, cursor: "3", value: { goal: null } },
    { entity: "cup", entityId: "other-device", revision: 1, cursor: "4", value: newCup(500) },
  ] }, null);
  const loaded = await r.load("a");
  assert.deepEqual(loaded?.state.entries, [remote]);
  assert.deepEqual(loaded?.state.cup, state.cup);
  assert.equal(loaded?.state.goal, null);
  assert.equal(loaded?.cursor, "4");
  await r.save("a", { ...loaded!.state, entries: [] });
  assert.equal((await r.pending("a"))[0].expectedRevision, 1);
  r.close();
});
test("a pull arriving during local editing preserves the edit and its durable queue", async () => {
  const { repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup() }, 10);
  await r.save("a", state);
  await clean(r, "a");
  const edited = { ...state, entries: [{ ...state.entries[0], amount: 20 }] };
  await r.save("a", edited);
  const queue = await r.pending("a");
  await r.applyPage("a", { cursor: "2", hasMore: false, changes: [
    { entity: "record", entityId: state.entries[0].id, revision: 2, cursor: "2", value: null },
  ] }, null);
  assert.deepEqual((await r.load("a"))?.state.entries, edited.entries);
  assert.deepEqual(await r.pending("a"), queue);
  r.close();
});
test("bad pages, stale cursors and impossible cup water roll back data and cursor together", async () => {
  const { repository: r } = await fixture();
  const state = updateProgress({ entries: [], cup: newCup() }, 10);
  await r.save("a", state);
  await clean(r, "a");
  const impossible: ChangePage = { cursor: "1", hasMore: false, changes: [
    { entity: "record", entityId: state.entries[0].id, revision: 2, cursor: "1", value: { ...state.entries[0], amount: 500 } },
  ] };
  await assert.rejects(r.applyPage("a", impossible, null));
  assert.deepEqual((await r.load("a"))?.state, state);
  assert.equal((await r.load("a"))?.cursor, null);
  await r.applyPage("a", { cursor: "0", hasMore: false, changes: [] }, null);
  await assert.rejects(r.applyPage("a", { cursor: "0", hasMore: false, changes: [] }, null));
  assert.equal((await r.load("a"))?.cursor, "0");
  await assert.rejects(r.applyPage("a", { cursor: "0", hasMore: true, changes: [] }, "0"));
  r.close();
});

test("goal date evidence persists with the exact mutation; same-value confirmation queues; conflict choice discards old evidence", async () => {
  const { factory, repository: r } = await fixture();
  const state = { entries: [], cup: newCup(), goal: 1500 };
  await r.save('user-a',state);
  for (const m of await r.pending('user-a')) await r.acknowledge('user-a',m.sequence,m.mutationId,m.expectedRevision+1);
  const evidence = { ticket:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',eventId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  await r.save('user-a',state,undefined,evidence);
  const [mutation] = await r.pending('user-a');
  assert.equal((await r.pending('user-a')).length,1);
  assert.equal(mutation.entity,'settings');
  assert.deepEqual(mutation.goalEvidence,evidence);
  r.close();
  const reopened = await SyncRepository.open(factory);
  assert.deepEqual((await reopened.pending('user-a'))[0],mutation);
  const { stateVersion } = await import('../src/syncRepository.ts');
  await reopened.resolveConflict('user-a',mutation.mutationId,{entity:'settings',entityId:'settings',revision:5,cursor:'5',value:{goal:2000}},'local',stateVersion(state));
  const [resolved] = await reopened.pending('user-a');
  assert.equal(resolved.goalEvidence,undefined);
  assert.equal(resolved.expectedRevision,5);
  assert.notEqual(resolved.mutationId,mutation.mutationId);
  reopened.close();
});
