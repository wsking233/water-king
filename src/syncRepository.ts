import { readStore, type Store } from "./records.ts";

export type Mutation = {
  owner: string;
  sequence: number;
  mutationId: string;
  entity: "record" | "settings" | "cup";
  entityId: string;
  expectedRevision: number;
  value: unknown | null;
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
    values.set(`record:${record.id}`, { entity: "record", entityId: record.id, value: record });
  values.set("settings:settings", {
    entity: "settings", entityId: "settings", value: { goal: state.goal === undefined ? 2000 : state.goal },
  });
  values.set(`cup:${deviceId}`, { entity: "cup", entityId: deviceId, value: state.cup });
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

  async load(owner: string): Promise<{ state: Store; cursor: string | null } | null> {
    const tx = this.db.transaction("snapshots", "readonly");
    const done = completion(tx);
    const snapshot = await request(tx.objectStore("snapshots").get(owner)) as Snapshot | undefined;
    await done;
    return snapshot ? { state: snapshot.state, cursor: snapshot.cursor } : null;
  }

  /** Caller must have shown import scope and obtained consent before first account save. */
  async save(owner: string, state: Store): Promise<void> {
    if (!owner) throw Error("缺少数据归属");
    const validated = readStore(JSON.stringify(state), null);
    const tx = this.db.transaction(["snapshots", "outbox"], "readwrite");
    const done = completion(tx);
    try {
      const snapshots = tx.objectStore("snapshots");
      const previous = await request(snapshots.get(owner)) as Snapshot | undefined;
      const before = previous ? entities(previous.state, this.deviceId) : new Map();
      const after = entities(validated, this.deviceId);
      const revisions = { ...previous?.revisions };
      let sequence = previous?.sequence ?? 0;
      const queue = tx.objectStore("outbox");
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const oldValue = before.get(key);
        const next = after.get(key);
        if (JSON.stringify(oldValue?.value) === JSON.stringify(next?.value)) continue;
        const entity = next ?? oldValue!;
        // Local-only namespace never creates an upload queue.
        if (owner !== "local") {
          const revision = revisions[key] ?? 0;
          const mutation: Mutation = {
            owner, sequence: ++sequence, mutationId: crypto.randomUUID(),
            entity: entity.entity, entityId: entity.entityId,
            expectedRevision: revision, value: next?.value ?? null,
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

  async pending(owner: string): Promise<Mutation[]> {
    const tx = this.db.transaction("outbox", "readonly");
    const done = completion(tx);
    const result = await request(tx.objectStore("outbox").index("owner").getAll(owner));
    await done;
    return result as Mutation[];
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
