import { KEY, STORE_KEY, readStore, type Store, type Cup } from "./records.ts";

/** Records and settings share one commit so a failed write cannot split cup and history. */
export interface RecordRepository {
  load(): Store;
  save(state: Store): Store;
}
export interface SettingsRepository {
  loadSettings(): { cup: Cup; goal?: number | null };
}
export type StateStorage = Pick<Storage, "getItem" | "setItem">;

export class LocalRecordRepository implements RecordRepository, SettingsRepository {
  private readonly storage: StateStorage;
  constructor(storage: StateStorage) { this.storage = storage; }

  load(): Store {
    // An invalid v2 store must never fall back to (and overwrite) older records.
    const raw = this.storage.getItem(STORE_KEY);
    return readStore(raw, raw === null ? this.storage.getItem(KEY) : null);
  }

  save(state: Store): Store {
    // Validate and detach before committing. setItem is the single atomic write;
    // no in-memory success state or legacy deletion precedes it.
    const validated = readStore(JSON.stringify(state), null);
    this.storage.setItem(STORE_KEY, JSON.stringify(validated));
    return validated;
  }

  loadSettings() {
    const { cup, goal } = this.load();
    return { cup, ...(goal === undefined ? {} : { goal }) };
  }
}

/** Access storage lazily so denied browser storage is handled by the caller. */
export const recordRepository: RecordRepository & SettingsRepository = {
  load: () => new LocalRecordRepository(window.localStorage).load(),
  save: (state) => new LocalRecordRepository(window.localStorage).save(state),
  loadSettings: () => new LocalRecordRepository(window.localStorage).loadSettings(),
};
