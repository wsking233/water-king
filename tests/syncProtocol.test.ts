import test from "node:test";
import assert from "node:assert/strict";
import { parsePage, parseReply, validCursor } from "../src/syncProtocol.ts";

test("cursors retain bigint precision and reject overflow, regression and non-progressing pages", () => {
  assert.equal(validCursor("9007199254740993"), true);
  assert.equal(validCursor("9223372036854775808"), false);
  assert.equal(validCursor("01"), false);
  assert.equal(validCursor(3), false);
  assert.throws(() => parsePage({ cursor: "1", hasMore: false, changes: [] }, "2"));
  assert.throws(() => parsePage({ cursor: "2", hasMore: true, changes: [] }, "2"));
  assert.throws(() => parsePage({ cursor: "3", hasMore: false, changes: [
    { entity: "record", entityId: "r", revision: 1, cursor: "2", value: null },
  ] }, "0"));
});
test("missing-entity conflicts are valid, mismatched receipts and malformed changes are not", () => {
  assert.deepEqual(parseReply({ status: "conflict", mutationId: "m", current: null }, "m", 1), {
    status: "conflict", mutationId: "m", current: null,
  });
  assert.throws(() => parseReply({ status: "applied", mutationId: "m", revision: 9, cursor: "1" }, "m", 0));
  assert.throws(() => parsePage({ cursor: "1", hasMore: false, changes: [
    { entity: "record", entityId: "r", revision: 1, cursor: "1", value: {
      id: "other", kind: "water", amount: 10, at: "2026-01-01T00:00:00Z",
    } },
  ] }, "0"));
});
