import test from "node:test";
import assert from "node:assert/strict";
import { LocalRecordRepository } from "../src/repository.ts";
import { KEY, STORE_KEY, newCup, updateProgress } from "../src/records.ts";
import { backupText, parseBackup } from "../src/dataTools.ts";

function fixture() {
  const values = new Map<string, string>();
  let fail = false;
  const repository = new LocalRecordRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw Error("quota");
      values.set(key, value);
    },
  });
  return { values, repository, fail: () => { fail = true; } };
}
const entry = { id: "legacy", kind: "water" as const, amount: 50, at: "2026-10-15T12:00:00Z" };

test("legacy migration preserves IDs and source until successful first commit", () => {
  const f = fixture();
  const source = JSON.stringify([entry]);
  f.values.set(KEY, source);
  const state = f.repository.load();
  assert.deepEqual(state.entries, [entry]);
  assert.equal(f.values.has(STORE_KEY), false);
  f.repository.save(state);
  assert.deepEqual(f.repository.load(), state);
  assert.equal(f.values.get(KEY), source);
});

test("failed migration writes retain legacy data and no v2 success state", () => {
  const f = fixture();
  f.values.set(KEY, JSON.stringify([entry]));
  const state = f.repository.load();
  f.fail();
  assert.throws(() => f.repository.save(state), /quota/);
  assert.equal(f.values.has(STORE_KEY), false);
  assert.deepEqual(f.repository.load().entries, [entry]);
});

test("failed commit preserves records, cup and settings together", () => {
  const f = fixture();
  const before = { entries: [], cup: newCup(), goal: 2000 };
  f.repository.save(before);
  f.fail();
  assert.throws(() => f.repository.save({ ...updateProgress(before, 10), goal: null }));
  assert.deepEqual(f.repository.load(), before);
});

test("corrupt v2 cannot silently fall back to legacy; invalid writes retain original", () => {
  const f = fixture();
  f.values.set(KEY, JSON.stringify([entry]));
  f.values.set(STORE_KEY, "broken");
  assert.throws(() => f.repository.load());
  assert.throws(() => f.repository.save({ entries: [], cup: newCup(), goal: -1 }));
  assert.equal(f.values.get(STORE_KEY), "broken");
});

test("v2 reload and backup keep cross-day cup water, disabled goal and stable IDs", () => {
  const f = fixture();
  const state = updateProgress({ entries: [], cup: newCup(), goal: null }, 10);
  f.repository.save(state);
  const restored = parseBackup(backupText(f.repository.load()));
  assert.deepEqual(restored, state);
  assert.deepEqual(f.repository.loadSettings(), { cup: state.cup, goal: null });
});

test("valid v2 does not depend on obsolete legacy reads", () => {
  const state = { entries: [entry], cup: newCup() };
  const repository = new LocalRecordRepository({
    getItem: (key) => {
      if (key === KEY) throw Error("legacy unavailable");
      return JSON.stringify(state);
    },
    setItem: () => {},
  });
  assert.deepEqual(repository.load(), state);
});
