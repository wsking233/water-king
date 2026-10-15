import { KEY, STORE_KEY, readStore, type Store } from "./records.ts";

export interface StoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RecordRepository {
  read(): Store;
  save(state: Store): Store;
}

/** Keep the existing single-write transaction until the queued IndexedDB stage. */
export function createLocalRepository(storage: StoreStorage): RecordRepository {
  return {
    read() {
      return readStore(storage.getItem(STORE_KEY), storage.getItem(KEY));
    },
    save(state) {
      // Validate before the only write: a failure must preserve the old snapshot.
      const serialized = JSON.stringify(state);
      const validated = readStore(serialized, null);
      storage.setItem(STORE_KEY, serialized);
      return validated;
    },
  };
}
