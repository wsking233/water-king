import { LocalRecordRepository } from "./repository.ts";
import { KEY, STORE_KEY, newCup, type Store } from "./records.ts";
import { stateVersion, type GoalEvidence, type SyncRepository } from "./syncRepository.ts";

export type DataSnapshot = { state: Store; version: string; error: string };
export async function localWriteLock<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return await navigator.locks.request("water-king.local-write", run);
  return await run();
}
function localVersion() {
  const raw = localStorage.getItem(STORE_KEY);
  return JSON.stringify([raw, raw === null ? localStorage.getItem(KEY) : null, localStorage.getItem("water-king.data-owner.v1")]);
}

export class DataSession {
  readonly owner: string;
  private readonly repository: SyncRepository | null;
  private readonly authorized: () => boolean;
  private valid = true;
  private localOwner: string | null | undefined;
  private readonly local = new LocalRecordRepository({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  });
  constructor(owner: string, repository: SyncRepository | null, authorized: () => boolean) {
    this.owner = owner; this.repository = repository; this.authorized = authorized;
  }
  invalidate() { this.valid = false; }
  async read(): Promise<DataSnapshot> {
    if (this.owner === "local") {
      let version = "unreadable";
      try {
        if (this.localOwner === undefined) this.localOwner = localStorage.getItem("water-king.data-owner.v1");
        version = localVersion();
        return { state: this.local.load(), version, error: "" };
      } catch {
        return { state: { entries: [], cup: newCup() }, version,
          error: "本地记录暂时无法读取，原数据未被覆盖。可前往「我的」清空后重新开始。" };
      }
    }
    const loaded = await this.repository!.load(this.owner);
    if (!loaded) throw Error("账号本机记录暂时无法读取");
    return { state: loaded.state, version: stateVersion(loaded.state), error: "" };
  }
  async save(state: Store, expectedVersion: string, goalEvidence?: GoalEvidence): Promise<DataSnapshot> {
    const assertActive = () => { if (!this.valid || !this.authorized()) throw Error("数据账号已变化，请重新打开页面"); };
    assertActive();
    if (this.owner === "local") return localWriteLock(async () => {
      assertActive();
      if (localStorage.getItem("water-king.data-owner.v1") !== this.localOwner)
        throw Error("数据归属已变化，请重新打开页面");
      if (localVersion() !== expectedVersion) throw Error("记录已在其他页面更新，请重试");
      const saved = this.local.save(state);
      return { state: saved, version: localVersion(), error: "" };
    });
    await this.repository!.save(this.owner, state, expectedVersion, goalEvidence);
    return { state, version: stateVersion(state), error: "" };
  }
}
