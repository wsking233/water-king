import test from "node:test";
import assert from "node:assert/strict";
import { createLocalRepository } from "../src/repository.ts";
import { KEY, STORE_KEY, newCup, type Store } from "../src/records.ts";

function fixture() {
  const values = new Map<string, string>();
  let fail = false;
  const repository = createLocalRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (fail) throw Error("quota");
      values.set(key, value);
    },
  });
  return { values, repository, fail: () => { fail = true; } };
}
test("legacy records migrate without changing IDs or overwriting the legacy copy", () => {
  const { values, repository } = fixture();
  const entries = [{ id: "legacy-id", kind: "water", amount: 30, at: "2026-10-14T12:00:00Z" }];
  const original = JSON.stringify(entries);
  values.set(KEY, original);
  const state = repository.read();
  assert.deepEqual(state.entries, entries);
  assert.equal(values.has(STORE_KEY), false);
  repository.save(state);
  assert.deepEqual(repository.read(), state);
  assert.equal(values.get(KEY), original);
});
test("failed storage and invalid replacements preserve the previous complete snapshot", () => {
  const f = fixture();
  const state: Store = { entries: [], cup: newCup(), goal: null };
  f.repository.save(state);
  const original = f.values.get(STORE_KEY);
  assert.throws(() => f.repository.save({ ...state, goal: -1 }));
  assert.equal(f.values.get(STORE_KEY), original);
  f.fail();
  assert.throws(() => f.repository.save({ ...state, cup: newCup(500), goal: 1800 }));
  assert.equal(f.values.get(STORE_KEY), original);
  assert.deepEqual(f.repository.read(), state);
});
test("corrupt current data blocks reading instead of falling back and replacing it", () => {
  const { values, repository } = fixture();
  values.set(STORE_KEY, "broken");
  values.set(KEY, "[]");
  assert.throws(() => repository.read());
  assert.equal(values.get(STORE_KEY), "broken");
});
