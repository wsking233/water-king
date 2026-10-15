import test from "node:test";
import assert from "node:assert/strict";
import { createClient, type Session } from "@supabase/supabase-js";
import { createSyncTransport } from "../src/cloud/syncTransport.ts";
import type { Database } from "../src/cloud/models.ts";
import type { Mutation } from "../src/syncRepository.ts";

const mutation: Mutation = {
  owner: "a", sequence: 1, mutationId: "mutation-a", entity: "record", entityId: "record-a",
  expectedRevision: 0, value: null,
};
test("RPC pins the checked identity's token even if the SDK's active session changes before fetch", async () => {
  const requests: { authorization: string | null; body: Record<string, unknown> }[] = [];
  const client = createClient<Database>("https://example.supabase.co", "sb_publishable_test", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (_url, options) => {
      requests.push({ authorization: new Headers(options?.headers).get("Authorization"), body: JSON.parse(String(options?.body)) });
      return new Response(JSON.stringify({ status: "applied", mutationId: "mutation-a", revision: 1, cursor: "1" }), {
        headers: { "Content-Type": "application/json" },
      });
    } },
  });
  let checks = 0;
  client.auth.getSession = async () => ({ error: null, data: { session: {
    user: { id: ++checks === 1 ? "a" : "b" }, access_token: checks === 1 ? "token-a" : "token-b",
  } as Session } });
  const t = createSyncTransport(client);
  await t.apply("a", mutation, new AbortController().signal);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, "Bearer token-a");
  assert.equal(requests[0].body.p_entity_id, mutation.entityId);
  assert.equal("owner" in requests[0].body, false);
  await assert.rejects(t.apply("a", mutation, new AbortController().signal), /账号已变化/);
  await assert.rejects(t.apply("b", mutation, new AbortController().signal), /队列账号不匹配/);
  assert.equal(requests.length, 1);
});
