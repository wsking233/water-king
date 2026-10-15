import test from "node:test";
import assert from "node:assert/strict";
import {
  backupText,
  parseBackup,
  upsertRecord,
  weekSummary,
} from "../src/dataTools.ts";
import {
  newCup,
  updateProgress,
  cupProgress,
  type Store,
} from "../src/records.ts";
const now = new Date(2026, 9, 15, 14, 30);
function state(): Store {
  return { entries: [], cup: newCup(250, now), goal: 1800 };
}
test("backup roundtrip retains entries, active cup and goal", () => {
  const base = state();
  const s = { ...updateProgress(base, 30, now), goal: base.goal };
  assert.deepEqual(parseBackup(backupText(s, now)), s);
});
test("backup rejects invalid and incompatible content", () => {
  for (const raw of [
    "broken",
    "{}",
    JSON.stringify({
      format: "water-king-backup",
      version: 99,
      state: state(),
    }),
    JSON.stringify({
      format: "water-king-backup",
      version: 1,
      state: { ...state(), entries: [{ id: "broken" }] },
    }),
  ])
    assert.throws(() => parseBackup(raw));
  assert.throws(() => parseBackup(" ".repeat(5 * 1024 * 1024 + 1)));
});
test("backfill and edits preserve local day totals and prevent future records", () => {
  const s = state();
  const at = new Date(2026, 9, 14, 20).toISOString();
  const entries = upsertRecord(s, { kind: "water", amount: 300, at }, now);
  assert.equal(entries[0].cupId, undefined);
  const next = upsertRecord(
    { ...s, entries },
    { id: entries[0].id, kind: "water", amount: 150, at },
    now,
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].amount, 150);
  assert.throws(() =>
    upsertRecord(
      s,
      { kind: "water", amount: 20, at: new Date(2026, 9, 16).toISOString() },
      now,
    ),
  );
  assert.throws(() =>
    upsertRecord(s, { id: "missing", kind: "water", amount: 20, at }, now),
  );
});
test("editing an active-cup entry updates progress without overflow; changing day retains cup association", () => {
  const s = updateProgress(state(), 100, now);
  const entry = s.entries[0];
  const next = upsertRecord(s, { ...entry, amount: 80 }, now);
  assert.equal(cupProgress({ ...s, entries: next }, now), 80);
  assert.throws(() => upsertRecord(s, { ...entry, amount: 251 }, now));
  const moved = upsertRecord(
    s,
    { ...entry, at: new Date(2026, 9, 14, 14).toISOString() },
    now,
  );
  assert.equal(moved[0].cupId, s.cup.id);
  assert.equal(cupProgress({ ...s, entries: moved }, now), 100);
});
test("week summary includes empty dates, excludes outside dates, crosses month boundary", () => {
  const end = new Date(2026, 10, 3, 12);
  const base = state();
  const entries = upsertRecord(
    base,
    { kind: "water", amount: 100, at: new Date(2026, 9, 31, 12).toISOString() },
    end,
  );
  const week = weekSummary(entries, end);
  assert.equal(week.length, 7);
  assert.equal(week[0].date.getDate(), 28);
  assert.equal(week[6].date.getDate(), 3);
  assert.equal(
    week.reduce((n, d) => n + d.water, 0),
    100,
  );
  assert.equal(week.filter((d) => d.hasRecords).length, 1);
});
