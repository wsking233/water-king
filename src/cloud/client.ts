import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./models";
import { emailPreviewEnabled } from "./preview";
import { cloudConfig } from "./config";
export const emailAuthEnabled = emailPreviewEnabled(import.meta.env.VITE_EMAIL_AUTH_PREVIEW, window.location.search);
export const cloudSyncEnabled = import.meta.env.VITE_CLOUD_SYNC_PREVIEW === "true";

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

/** Keep account mutations pinned even if another tab switches the persisted session. */
export async function pinnedAccountClient(expectedId: string) {
  const shared = getCloudClient();
  const config = cloudConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!shared || !config) throw Error("账号服务暂未配置。");
  const { data, error } = await shared.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== expectedId) throw Error("账号已变化，请关闭后重新操作。");
  const isolated = createClient<Database>(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await isolated.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  if (result.error) throw result.error;
  if (result.data.user?.id !== expectedId) throw Error("账号已变化，请关闭后重新操作。");
  return isolated;
}
