import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./models";
import { cloudConfig } from "./config";

let client: SupabaseClient<Database> | null | undefined;
export function getCloudClient() {
  if (client !== undefined) return client;
  const config = cloudConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  client = config ? createClient<Database>(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) : null;
  return client;
}
