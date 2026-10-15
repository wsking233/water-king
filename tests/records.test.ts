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
