import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../src/cloud/models.ts";
import { enterGuest } from "../src/cloud/identity.ts";

function client(auth: object) { return { auth } as SupabaseClient<Database>; }
const user = { id: "test-user" } as User;
test("restored identity is reused without creating another guest", async () => {
  let created = 0;
  const c = client({
    getSession: async () => ({ data: { session: { user } }, error: null }),
    signInAnonymously: async () => { created++; throw Error("unexpected"); },
  });
  assert.equal(await enterGuest(c), user);
  assert.equal(created, 0);
});
test("concurrent guest creation shares one request, with no automatic retry after failure", async () => {
  let created = 0;
  let reject!: (error: Error) => void;
  const c = client({
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: () => {
      created++;
      return new Promise((_resolve, fail) => { reject = fail; });
    },
  });
  const a = enterGuest(c);
  const b = enterGuest(c);
  assert.equal(a, b);
  // Let getSession complete before simulating an uncertain network response.
  await new Promise((resolve) => setTimeout(resolve, 0));
  reject(Error("network"));
  await assert.rejects(a, /network/);
  await assert.rejects(b, /network/);
  assert.equal(created, 1);
});
test("session recovery failure never falls through to anonymous registration", async () => {
  let created = 0;
  const c = client({
    getSession: async () => ({ data: { session: null }, error: Error("storage unavailable") }),
    signInAnonymously: async () => { created++; },
  });
  await assert.rejects(enterGuest(c), /storage unavailable/);
  assert.equal(created, 0);
});
