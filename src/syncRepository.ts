import { readStore, type Store } from "./records.ts";
import { parseChange, parsePage, validCursor, type ChangePage, type RemoteChange } from "./syncProtocol.ts";

export function stateVersion(state: Store) {
  return JSON.stringify({ entries: state.entries.map(recordValue),
    cup: { id: state.cup.id, capacity: state.cup.capacity, day: state.cup.day }, goal: state.goal === undefined ? 2000 : state.goal });
}
function recordValue(record: Store["entries"][number]) {
  return { id: record.id, kind: record.kind, amount: record.amount, at: record.at,
    ...(record.cupId === undefined ? {} : { cupId: record.cupId }) };
}

export type GoalEvidence = { ticket: string; eventId: string };
export type Mutation = {
  owner: string;
  sequence: number;
  mutationId: string;
  entity: "record" | "settings" | "cup";
  entityId: string;
  expectedRevision: number;
  value: unknown | null;
  goalEvidence?: GoalEvidence;
};
type Snapshot = {
  owner: string;
  state: Store;
  revisions: Record<string, number>;
  sequence: number;
  cursor: string | null;
};
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error("本地事务已取消"));
    tx.onerror = () => {}; // onabort reports the final transaction outcome.
  });
}
function entities(state: Store, deviceId: string) {
  const values = new Map<string, { entity: Mutation["entity"]; entityId: string; value: unknown }>();
  for (const record of state.entries)
    values.set(`record:${record.id}`, { entity: "record", entityId: record.id, value: recordValue(record) });
  values.set("settings:settings", {
    entity: "settings", entityId: "settings", value: { goal: state.goal === undefined ? 2000 : state.goal },
  });
  values.set(`cup:${deviceId}`, { entity: "cup", entityId: deviceId,
    value: { id: state.cup.id, capacity: state.cup.capacity, day: state.cup.day } });
  return values;
}

/** Async storage foundation. No network requests or automatic account migration. */
export class SyncRepository {
  private readonly db: IDBDatabase;
  readonly deviceId: string;
  private constructor(db: IDBDatabase, deviceId: string) {
    this.db = db;
    this.deviceId = deviceId;
  }

  static async open(factory: IDBFactory = indexedDB, name = "water-king.sync.v1") {
    const opening = factory.open(name, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("snapshots", { keyPath: "owner" });
      db.createObjectStore("outbox", { keyPath: ["owner", "sequence"] }).createIndex("owner", "owner");
      db.createObjectStore("metadata");
    };
    const db = await request(opening);
    db.onversionchange = () => db.close();
    const tx = db.transaction("metadata", "readwrite");
    const done = completion(tx);
    const metadata = tx.objectStore("metadata");
    const deviceId = await request(metadata.get("deviceId")) as string | undefined;
    const id = deviceId ?? crypto.randomUUID();
    if (!deviceId) metadata.put(id, "deviceId");
    await done;
    return new SyncRepository(db, id);
  }

  close() { this.db.close(); }

  /** Device-local view preference, never an authentication credential. */
  async lastOwner(): Promise<string | null> {
    const tx = this.db.transaction("metadata", "readonly");
    const done = completion(tx);
    const owner = await request(tx.objectStore("metadata").get("activeOwner"));
    await done;
    return typeof owner === "string" && owner !== "local" ? owner : null;
  }
  async rememberOwner(owner: string) {
    const tx = this.db.transaction("metadata", "readwrite");
    const done = completion(tx);
    tx.objectStore("metadata").put(owner,"activeOwner");
    await done;
  }

  async load(owner: string): Promise<{ state: Store; cursor: string | null } | null> {
    const tx = this.db.transaction("snapshots", "readonly");
    const done = completion(tx);
    const snapshot = await request(tx.objectStore("snapshots").get(owner)) as Snapshot | undefined;
    await done;
    return snapshot ? { state: snapshot.state, cursor: snapshot.cursor } : null;
  }

  /** Caller must have shown import scope and obtained consent before first account save. */
  async save(owner: string, state: Store, expectedVersion?: string, goalEvidence?: GoalEvidence): Promise<void> {
    if (!owner) throw Error("缺少数据归属");
    const validated = readStore(JSON.stringify(state), null);
    const tx = this.db.transaction(["snapshots", "outbox"], "readwrite");
    const done = completion(tx);
    try {
      const snapshots = tx.objectStore("snapshots");
      const previous = await request(snapshots.get(owner)) as Snapshot | undefined;
      if (expectedVersion !== undefined && (!previous || stateVersion(previous.state) !== expectedVersion))
        throw Error("记录已在其他页面更新，请重试");
      const before = previous ? entities(previous.state, this.deviceId) : new Map();
      const after = entities(validated, this.deviceId);
      const revisions = { ...previous?.revisions };
      let sequence = previous?.sequence ?? 0;
      const queue = tx.objectStore("outbox");
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const oldValue = before.get(key);
        const next = after.get(key);
        if (JSON.stringify(oldValue?.value) === JSON.stringify(next?.value) && !(goalEvidence && next?.entity === "settings")) continue;
        const entity = next ?? oldValue!;
        // Local-only namespace never creates an upload queue.
        if (owner !== "local") {
          const revision = revisions[key] ?? 0;
          const mutation: Mutation = {
            owner, sequence: ++sequence, mutationId: crypto.randomUUID(),
            entity: entity.entity, entityId: entity.entityId,
            expectedRevision: revision, value: next?.value ?? null,
            ...(entity.entity === "settings" && goalEvidence ? { goalEvidence } : {}),
          };
          queue.add(mutation);
          revisions[key] = revision + 1;
        }
      }
      snapshots.put({ owner, state: validated, revisions, sequence, cursor: previous?.cursor ?? null } satisfies Snapshot);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  /** One-time, consented bootstrap; no partial account snapshot survives a failure. */
  async initializeAccount(owner: string, base: Store, changes: RemoteChange[], cursor: string, imported: Store | null) {
    if (!owner || owner === "local" || !validCursor(cursor)) throw Error("首次同步参数异常");
    const records = new Map<string, Store["entries"][number]>();
    const revisions: Record<string, number> = {};
    const deleted = new Set<string>();
    let cup = base.cup;
    let goal = base.goal;
    let hasGoal = false;
    // The caller supplies validated pages in cursor order, including later edits.
    for (const change of changes) {
      const key = `${change.entity}:${change.entityId}`;
      if (change.entity === "record") {
        if (change.value === null) { records.delete(change.entityId); deleted.add(change.entityId); }
        else { records.set(change.entityId, change.value as Store["entries"][number]); deleted.delete(change.entityId); }
      } else if (change.entity === "settings") { goal = (change.value as { goal: number | null }).goal; hasGoal = true; }
      else if (change.entityId === this.deviceId) cup = change.value as Store["cup"];
      else continue;
      revisions[key] = change.revision;
    }
    const remote: Store = { entries: [...records.values()], cup, ...(goal !== undefined ? { goal } : {}) };
    if (imported) {
      for (const entry of imported.entries) {
        if (deleted.has(entry.id)) continue;
        const existing = records.get(entry.id);
        if (existing && JSON.stringify(recordValue(existing)) !== JSON.stringify(recordValue(entry)))
          throw Error("本机与云端有相同 ID 的不同记录，未覆盖任何数据。请先导出备份。");
        records.set(entry.id, entry);
      }
      cup = imported.cup;
      if (!hasGoal) goal = imported.goal;
    }
    const state = readStore(JSON.stringify({ entries: [...records.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)), cup, goal }), null);
    const tx = this.db.transaction(["snapshots", "outbox", "metadata"], "readwrite");
    const done = completion(tx);
    try {
      const snapshots = tx.objectStore("snapshots");
      if (await request(snapshots.get(owner))) throw Error("此账号已在其他页面接入，请重新打开");
      const before = entities(remote, this.deviceId);
      // Absent settings/cup are new entities even if their default values match.
      if (!hasGoal) before.delete("settings:settings");
      if (!revisions[`cup:${this.deviceId}`]) before.delete(`cup:${this.deviceId}`);
      const after = entities(state, this.deviceId);
      let sequence = 0;
      for (const [key, next] of after) {
        if (JSON.stringify(before.get(key)?.value) === JSON.stringify(next.value)) continue;
        const expectedRevision = revisions[key] ?? 0;
        tx.objectStore("outbox").add({ owner, sequence: ++sequence, mutationId: crypto.randomUUID(),
          entity: next.entity, entityId: next.entityId, expectedRevision, value: next.value } satisfies Mutation);
        revisions[key] = expectedRevision + 1;
      }
      snapshots.put({ owner, state, revisions, sequence, cursor } satisfies Snapshot);
      tx.objectStore("metadata").put(owner,"activeOwner");
    } catch (error) { tx.abort(); await done.catch(()=>{}); throw error; }
    await done;
  }

  async pending(owner: string): Promise<Mutation[]> {
    const tx = this.db.transaction("outbox", "readonly");
    const done = completion(tx);
    const result = await request(tx.objectStore("outbox").index("owner").getAll(owner));
    await done;
    return result as Mutation[];
  }

  /** Apply a whole page and its cursor atomically. Never overwrite queued edits. */
  async applyPage(owner: string, input: ChangePage, expectedCursor: string | null): Promise<void> {
    const page = parsePage(input, expectedCursor ?? "0");
    const tx = this.db.transaction(["snapshots", "outbox"], "readwrite");
    const done = completion(tx);
    try {
      const snapshots = tx.objectStore("snapshots");
      const snapshot = await request(snapshots.get(owner)) as Snapshot | undefined;
      if (!snapshot || snapshot.cursor !== expectedCursor) throw Error("本地同步状态已变化，请重试");
      const pending = await request(tx.objectStore("outbox").index("owner").getAll(owner)) as Mutation[];
      const dirty = new Set(pending.map((m) => `${m.entity}:${m.entityId}`));
      const entries = new Map(snapshot.state.entries.map((e) => [e.id, e]));
      let cup = snapshot.state.cup;
      let goal = snapshot.state.goal;
      const revisions = { ...snapshot.revisions };
      for (const change of page.changes) {
        const key = `${change.entity}:${change.entityId}`;
        if (dirty.has(key) || (revisions[key] ?? 0) >= change.revision) continue;
        if (change.entity === "record") {
          if (change.value === null) entries.delete(change.entityId);
          else entries.set(change.entityId, change.value as Store["entries"][number]);
        } else if (change.entity === "settings") {
          goal = (change.value as { goal: number | null }).goal;
        } else {
          // Another device's cup never changes this device's water level.
          if (change.entityId !== this.deviceId) continue;
          cup = change.value as Store["cup"];
        }
        revisions[key] = change.revision;
      }
      const state = readStore(JSON.stringify({
        entries: [...entries.values()].sort((a,b) => Date.parse(b.at)-Date.parse(a.at)), cup, goal,
      }), null);
      snapshots.put({ ...snapshot, state, revisions, cursor: page.cursor } satisfies Snapshot);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  async lastSyncedAt(owner: string): Promise<string | null> {
    const tx = this.db.transaction("metadata", "readonly");
    const done = completion(tx);
    const value = await request(tx.objectStore("metadata").get(`synced:${owner}`));
    await done;
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  }

  async markSynced(owner: string): Promise<string | null> {
    const tx = this.db.transaction(["outbox", "metadata"], "readwrite");
    const done = completion(tx);
    const count = await request(tx.objectStore("outbox").index("owner").count(owner));
    const stamp = count ? null : new Date().toISOString();
    if (stamp) tx.objectStore("metadata").put(stamp, `synced:${owner}`);
    await done; return stamp;
  }

  /** Resolve exactly the reviewed entity; coalesce its queued edits into one CAS. */
  async resolveConflict(owner: string, mutationId: string, remoteInput: RemoteChange | null,
    choice: "local" | "remote", expectedVersion: string) {
    const remote = remoteInput === null ? null : parseChange(remoteInput);
    const tx = this.db.transaction(["snapshots", "outbox"], "readwrite");
    const done = completion(tx);
    try {
      const snapshots = tx.objectStore("snapshots"), queue = tx.objectStore("outbox");
      const snapshot = await request(snapshots.get(owner)) as Snapshot | undefined;
      const pending = await request(queue.index("owner").getAll(owner)) as Mutation[];
      const first = pending[0];
      if (!snapshot || stateVersion(snapshot.state) !== expectedVersion || first?.mutationId !== mutationId)
        throw Error("记录或队列已变化，请重新查看冲突内容。");
      if (remote && (remote.entity !== first.entity || remote.entityId !== first.entityId)) throw Error("冲突归属不匹配");
      if (first.entity === "cup" && first.entityId !== this.deviceId) throw Error("不能修改另一设备的杯子");
      if (choice === "remote" && !remote && first.entity !== "record") throw Error("云端没有此设置，请保留本机内容。");
      const key = `${first.entity}:${first.entityId}`;
      const revisions = { ...snapshot.revisions };
      const revision = remote?.revision ?? 0;
      let state = snapshot.state;
      for (const item of pending)
        if (item.entity === first.entity && item.entityId === first.entityId) queue.delete([owner, item.sequence]);
      if (choice === "local") {
        const local = entities(state, this.deviceId).get(key)?.value ?? null;
        const { goalEvidence: _oldEvidence, ...unproven } = first;
        queue.add({ ...unproven, mutationId: crypto.randomUUID(), expectedRevision: revision, value: local });
        revisions[key] = revision + 1;
      } else {
        const value = remote?.value ?? null;
        if (first.entity === "record") {
          const entries = state.entries.filter(item => item.id !== first.entityId);
          if (value !== null) entries.push(value as Store["entries"][number]);
          state = { ...state, entries: entries.sort((a,b) => Date.parse(b.at)-Date.parse(a.at)) };
        } else if (first.entity === "settings") state = { ...state, goal: (value as {goal:number|null}).goal };
        else state = { ...state, cup: value as Store["cup"] };
        revisions[key] = revision;
      }
      state = readStore(JSON.stringify(state), null);
      snapshots.put({ ...snapshot, state, revisions });
    } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
    await done;
  }

  /** Only a server acknowledgment of the exact mutation can remove it. */
  async acknowledge(owner: string, sequence: number, mutationId: string, revision: number) {
    const tx = this.db.transaction("outbox", "readwrite");
    const done = completion(tx);
    const queue = tx.objectStore("outbox");
    const mutation = await request(queue.get([owner, sequence])) as Mutation | undefined;
    if (mutation?.mutationId === mutationId && revision === mutation.expectedRevision + 1)
      queue.delete([owner, sequence]);
    await done;
  }
}
