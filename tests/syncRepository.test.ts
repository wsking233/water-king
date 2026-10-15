import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { SyncRepository } from "../src/syncRepository.ts";
import { newCup, updateProgress } from "../src/records.ts";

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
