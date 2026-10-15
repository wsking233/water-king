import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { SyncRepository } from "../src/syncRepository.ts";
import { SyncWorker, type SyncTransport } from "../src/syncWorker.ts";
import { newCup, updateProgress } from "../src/records.ts";

async function fixture() {
  const r = await SyncRepository.open(new IDBFactory());
  const state = updateProgress({ entries: [], cup: newCup() }, 10);
  await r.save("a", state);
  return { r, state };
}
function transport(overrides: Partial<SyncTransport> = {}): SyncTransport {
  return {
    apply: async (_owner, m) => ({ status: "applied", mutationId: m.mutationId, revision: m.expectedRevision + 1, cursor: String(m.sequence) }),
    pull: async () => ({ changes: [], cursor: "3", hasMore: false }),
    ...overrides,
  };
}
test("interrupted sends keep stable mutation IDs; retry only removes exact server receipts", async () => {
  const { r } = await fixture();
  const before = await r.pending("a");
  let broken = true;
  const seen: string[] = [];
  const t = transport({ apply: async (_owner, m) => {
    seen.push(m.mutationId);
    if (broken) throw Error("response lost");
    return { status: "applied", mutationId: m.mutationId, revision: m.expectedRevision+1, cursor: String(m.sequence) };
  } });
  const worker = new SyncWorker(r, t, () => "a");
  await assert.rejects(worker.run("a"), /response lost/);
  assert.deepEqual(await r.pending("a"), before);
  broken = false;
  assert.equal((await worker.run("a")).status, "synced");
  assert.equal(seen[0], seen[1]);
  assert.equal((await r.pending("a")).length, 0);
  assert.equal((await r.load("a"))?.cursor, "3");
  r.close();
});
test("conflict stops upload and pull without dropping the offline record or any pending mutation", async () => {
  const { r, state } = await fixture();
  const queue = await r.pending("a");
  let pulls = 0;
  const worker = new SyncWorker(r, transport({
    apply: async (_owner,m) => ({ status: "conflict", mutationId: m.mutationId, current: {
      entity: m.entity, entityId: m.entityId, revision: 2, cursor: "9", value: null,
    } }),
    pull: async () => { pulls++; throw Error("unexpected"); },
  }), () => "a");
  assert.equal((await worker.run("a")).status, "conflict");
  assert.deepEqual(await r.pending("a"), queue);
  assert.deepEqual((await r.load("a"))?.state, state);
  assert.equal(pulls, 0);
  r.close();
});
test("account change while awaiting a response cannot acknowledge or pull for the new account", async () => {
  const { r } = await fixture();
  const before = await r.pending("a");
  let owner = "a";
  const worker = new SyncWorker(r, transport({ apply: async (_owner,m) => {
    owner = "b";
    return { status: "applied", mutationId: m.mutationId, revision: 1, cursor: "1" };
  } }), () => owner);
  assert.equal((await worker.run("a")).status, "stopped");
  assert.deepEqual(await r.pending("a"), before);
  assert.equal(await r.load("b"), null);
  r.close();
});
test("concurrent runs coalesce; cancellation retains the queue for safe replay", async () => {
  const { r } = await fixture();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const worker = new SyncWorker(r, transport({ apply: async (_owner,m) => {
    await waiting;
    return { status: "applied", mutationId: m.mutationId, revision: 1, cursor: "1" };
  } }), () => "a");
  const a = worker.run("a");
  assert.equal(worker.run("a"), a);
  worker.cancel(); release();
  assert.equal((await a).status, "stopped");
  assert.equal((await r.pending("a")).length, 3);
  r.close();
});
test("malformed acknowledgment never clears the queue and unconfirmed accounts never upload", async () => {
  const { r } = await fixture();
  const worker = new SyncWorker(r, transport({ apply: async () => ({ status: "applied", mutationId: "other", revision: 1, cursor: "1" }) }), () => "a");
  await assert.rejects(worker.run("a"), /不匹配/);
  assert.equal((await r.pending("a")).length, 3);
  await assert.rejects(worker.run("local"));
  const other = new SyncWorker(r, transport(), () => "b");
  await assert.rejects(other.run("b"), /尚未确认/);
  r.close();
});

test("multi-page pull resumes after its committed cursor and does not claim sync during a local edit", async () => {
  const { r, state } = await fixture();
  let broken = true;
  const cursors: string[] = [];
  const worker = new SyncWorker(r, transport({ pull: async (_owner,after) => {
    cursors.push(after);
    if (after === "0") return { cursor: "4", hasMore: true, changes: [
      { entity: "record", entityId: "remote", revision: 1, cursor: "4", value: {
        id: "remote", kind: "water", amount: 50, at: "2026-01-01T00:00:00Z",
      } },
    ] };
    if (broken) throw Error("pull interrupted");
    const current = (await r.load("a"))!.state;
    await r.save("a", { ...current, entries: [{ ...state.entries[0], amount: 20 }, ...current.entries.filter(e=>e.id!==state.entries[0].id)] });
    return { cursor: "5", hasMore: false, changes: [
      { entity: "record", entityId: state.entries[0].id, revision: 2, cursor: "5", value: null },
    ] };
  } }), () => "a");
  await assert.rejects(worker.run("a"), /pull interrupted/);
  assert.equal((await r.load("a"))?.cursor, "4");
  broken = false;
  assert.equal((await worker.run("a")).status, "pending");
  assert.deepEqual(cursors, ["0","4","4"]);
  assert.equal((await r.pending("a")).length, 1);
  assert.equal((await r.load("a"))?.state.entries.find(e=>e.id===state.entries[0].id)?.amount, 20);
  r.close();
});

test("separate tab workers serialize a shared account queue rather than racing its pull cursor", async () => {
  const { r } = await fixture();
  let active = 0, maximum = 0, sends = 0;
  const t = transport({ apply: async (_owner,m) => {
    active++; maximum=Math.max(maximum,active); sends++;
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;
    return { status:"applied",mutationId:m.mutationId,revision:m.expectedRevision+1,cursor:String(m.sequence) };
  } });
  const a = new SyncWorker(r,t,()=>"a");
  const b = new SyncWorker(r,t,()=>"a");
  const results = await Promise.all([a.run("a"),b.run("a")]);
  assert.deepEqual(results.map(result=>result.status),["synced","synced"]);
  assert.equal(maximum,1);
  assert.equal(sends,3);
  r.close();
});
