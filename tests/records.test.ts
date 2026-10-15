import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEntries,
  todayEntries,
  totals,
  validAmount,
  type Entry,
} from "../src/records.ts";
const entries: Entry[] = [
  {
    id: "1",
    kind: "water",
    amount: 250,
    at: new Date(2026, 9, 15, 0, 1).toISOString(),
  },
  {
    id: "2",
    kind: "small",
    amount: 1,
    at: new Date(2026, 9, 15, 12).toISOString(),
  },
  {
    id: "4",
    kind: "water",
    amount: 500,
    at: new Date(2026, 9, 14, 23, 59).toISOString(),
  },
];
test("today excludes yesterday across a local midnight", () =>
  assert.deepEqual(totals(todayEntries(entries, new Date(2026, 9, 15, 14))), {
    water: 250,
    small: 1,
  }));
test("removing a record restores totals", () =>
  assert.deepEqual(totals(entries.filter((e) => e.id !== "1")), {
    water: 500,
    small: 1,
  }));
test("storage roundtrip and empty first visit", () => {
  assert.deepEqual(parseEntries(JSON.stringify(entries)), entries);
  assert.deepEqual(parseEntries(null), []);
});
test("invalid storage is rejected rather than silently replaced", () => {
  for (const raw of [
    "bad",
    "{}",
    "null",
    JSON.stringify([{ ...entries[0], at: "invalid" }]),
    JSON.stringify([{ ...entries[0], amount: -1 }]),
    JSON.stringify([entries[0], entries[0]]),
  ])
    assert.throws(() => parseEntries(raw));
});
test("water amounts must be positive bounded integers", () => {
  for (const v of [0, -1, 0.5, 5001, NaN, Infinity])
    assert.equal(validAmount(v), false);
  for (const v of [1, 250, 5000]) assert.equal(validAmount(v), true);
});

import {
  newCup,
  cupProgress,
  updateProgress,
  readStore,
  type Store,
} from "../src/records.ts";
const now = new Date(2026, 9, 15, 14);
function empty(): Store {
  return { entries: [], cup: newCup(250, now) };
}
test("progress tracks absolute amounts without double counting", () => {
  let s = updateProgress(empty(), 100, now);
  s = updateProgress(s, 100, now);
  s = updateProgress(s, 150, now);
  assert.equal(totals(s.entries).water, 150);
  assert.equal(cupProgress(s, now), 150);
  s = updateProgress(s, 40, now);
  assert.equal(totals(s.entries).water, 40);
  assert.equal(cupProgress(s, now), 40);
  s = updateProgress(s, 0, now);
  assert.equal(s.entries.length, 0);
});
test("refill preserves totals and subsequent progress is independent", () => {
  let s = updateProgress(empty(), 250, now);
  s = { ...s, cup: newCup(250, now) };
  assert.equal(cupProgress(s, now), 0);
  s = updateProgress(s, 10, now);
  assert.equal(totals(s.entries).water, 260);
  assert.equal(cupProgress(s, now), 10);
});
test("progress boundaries, sip remainder, and state restoration", () => {
  let s = updateProgress(empty(), 245, now);
  s = updateProgress(
    s,
    Math.min(s.cup.capacity, cupProgress(s, now) + 10),
    now,
  );
  assert.equal(cupProgress(s, now), 250);
  assert.deepEqual(readStore(JSON.stringify(s), null), s);
  for (const n of [-1, 251, 0.5, NaN])
    assert.throws(() => updateProgress(s, n, now));
});
test("next day begins fresh while retaining previous records", () => {
  const nextDay = new Date(2026, 9, 16, 0, 1);
  let s = updateProgress(empty(), 100, now);
  assert.equal(cupProgress(s, nextDay), 0);
  s = updateProgress(s, 10, nextDay);
  assert.equal(totals(s.entries).water, 110);
  assert.equal(totals(todayEntries(s.entries, nextDay)).water, 10);
});
test("legacy bowel records are removed without losing water or urine", () => {
  const old = [
    ...entries,
    { id: "legacy", kind: "large", amount: 1, at: now.toISOString() },
  ];
  assert.deepEqual(readStore(null, JSON.stringify(old)).entries, entries);
});
test("deleting cup records updates progress and old cups stay independent", () => {
  let s = updateProgress(empty(), 100, now);
  s = updateProgress(s, 150, now);
  s = { ...s, entries: s.entries.slice(1) };
  assert.equal(cupProgress(s, now), 100);
});

import { groupRecords } from "../src/records.ts";
test("group cups before truncation and keep interleaved urine separate", () => {
  const a = {
    id: "a",
    kind: "water" as const,
    amount: 10,
    at: new Date(2026, 9, 15, 14).toISOString(),
    cupId: "cup-a",
  };
  const b = {
    ...a,
    id: "b",
    amount: 20,
    at: new Date(2026, 9, 15, 15).toISOString(),
  };
  const urine = {
    id: "u",
    kind: "small" as const,
    amount: 1,
    at: new Date(2026, 9, 15, 14, 30).toISOString(),
  };
  const groups = groupRecords([a, urine, b]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].amount, 30);
  assert.deepEqual(
    groups[0].members.map((e) => e.id),
    ["b", "a"],
  );
  assert.equal(a.amount, 10);
  assert.equal(groups[1].kind, "small");
});
test("grouping does not merge different cups, legacy entries, or different dates", () => {
  const a = {
    id: "a",
    kind: "water" as const,
    amount: 10,
    at: new Date(2026, 9, 15, 14).toISOString(),
    cupId: "cup-a",
  };
  const input = [
    a,
    { ...a, id: "b", cupId: "cup-b" },
    { ...a, id: "c", cupId: undefined },
    { ...a, id: "d", cupId: undefined },
    { ...a, id: "e", at: new Date(2026, 9, 16, 14).toISOString() },
  ];
  assert.equal(groupRecords(input).length, 5);
  assert.equal(groupRecords([]).length, 0);
});

import { validGoal } from "../src/records.ts";
import { heldProgress } from "../src/cupMotion.ts";
test("hold ignores taps, decreases gradually and caps at capacity", () => {
  assert.equal(heldProgress(10, 250, 200), 10);
  assert.equal(heldProgress(0, 250, 900), 25);
  assert.equal(heldProgress(245, 250, 1500), 250);
  assert.equal(heldProgress(0, 1, 5850), 1);
  assert.equal(heldProgress(250, 250, 10000), 250);
});
test("goal is optional in existing storage and persisted in new storage", () => {
  const s = empty();
  assert.deepEqual(readStore(JSON.stringify(s), null), s);
  for (const goal of [null, 1500, 2400])
    assert.deepEqual(readStore(JSON.stringify({ ...s, goal }), null), {
      ...s,
      goal,
    });
  for (const goal of [0, -1, 10001, 1.5, "2000"])
    assert.throws(() => readStore(JSON.stringify({ ...s, goal }), null));
  assert.equal(validGoal(2000), true);
  assert.equal(validGoal(0), false);
});
