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
    id: "3",
    kind: "large",
    amount: 1,
    at: new Date(2026, 9, 15, 13).toISOString(),
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
    large: 1,
  }));
test("removing a record restores totals", () =>
  assert.deepEqual(totals(entries.filter((e) => e.id !== "1")), {
    water: 500,
    small: 1,
    large: 1,
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
