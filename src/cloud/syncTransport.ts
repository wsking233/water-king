import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./models.ts";
import type { SyncTransport } from "../syncWorker.ts";

export function createSyncTransport(client: SupabaseClient<Database>): SyncTransport {
  async function token(owner: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session || data.session.user.id !== owner) throw Error("同步账号已变化");
    signal.throwIfAborted();
    // Pin the checked token to the request: an account change between getSession
    // and fetch must never upload the previous account's queue as the new user.
    return data.session.access_token;
  }
  return {
    async apply(owner, mutation, signal) {
      if (mutation.owner !== owner) throw Error("队列账号不匹配");
      const jwt = await token(owner, signal);
      const { data, error } = await client.rpc("sync_apply", {
        p_mutation_id: mutation.mutationId, p_entity: mutation.entity,
        p_entity_id: mutation.entityId, p_expected_revision: mutation.expectedRevision,
        p_value: mutation.value as Json,
      }).setHeader("Authorization", `Bearer ${jwt}`)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      if (error) throw error;
      return data;
    },
    async pull(owner, after, signal) {
      const jwt = await token(owner, signal);
      const { data, error } = await client.rpc("sync_pull", { p_after: after, p_limit: 200 })
        .setHeader("Authorization", `Bearer ${jwt}`)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      if (error) throw error;
      return data;
    },
  };
}
