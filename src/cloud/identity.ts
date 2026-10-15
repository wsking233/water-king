import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "./models";

export function defaultNickname(id: string) {
  return `水友 ${id.slice(0, 6)}`;
}

/** Serialize creation in this tab and across tabs; failed requests never auto-retry. */
let pending: Promise<User> | null = null;
export function enterGuest(client: SupabaseClient<Database>): Promise<User> {
  if (pending) return pending;
  const run = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) return data.session.user;
    const result = await client.auth.signInAnonymously();
    if (result.error) throw result.error;
    if (!result.data.user) throw Error("未取得游客身份，请稍后重试。");
    return result.data.user;
  };
  const work = async (): Promise<User> => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request("water-king.guest-create", run);
    return await run();
  };
  pending = work().finally(() => { pending = null; });
  return pending;
}

export async function loadProfile(client: SupabaseClient<Database>, user: User) {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  // Ignore a concurrent insert, then read the authoritative row instead of
  // overwriting a nickname saved by another tab.
  const insert = await client.from("profiles").upsert(
    { user_id: user.id, nickname: defaultNickname(user.id) },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (insert.error) throw insert.error;
  const result = await client.from("profiles").select("*").eq("user_id", user.id).single();
  if (result.error) throw result.error;
  return result.data;
}
