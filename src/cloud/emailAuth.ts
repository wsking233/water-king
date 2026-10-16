import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "./models";

export type Client = Pick<SupabaseClient<Database>, "auth">;

async function currentUser(client: Client, expectedId: string) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user || data.user.id !== expectedId) throw Error("账号已变化，请关闭后重新操作。");
  return data.user;
}

export async function requestBinding(client: Client, expectedId: string, email: string, pin: (id: string) => Promise<Client>) {
  client = await pin(expectedId);
  const user = await currentUser(client, expectedId);
  if (!user.is_anonymous) throw Error("此账号已绑定，请重新打开账号设置。");
  const { error } = await client.auth.updateUser({ email: email.trim() });
  if (error) throw error;
}

export async function confirmBinding(client: Client, expectedId: string, email: string, token: string) {
  await currentUser(client, expectedId);
  const { data, error } = await client.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email_change" });
  if (error) throw error;
  if (!data.user || data.user.id !== expectedId || data.user.is_anonymous || !data.user.email_confirmed_at)
    throw Error("邮箱验证尚未完成，原有数据已保留，请重试。");
  return data.user;
}

export async function setAccountPassword(client: Client, expectedId: string, password: string, pin: (id: string) => Promise<Client>) {
  client = await pin(expectedId);
  const user = await currentUser(client, expectedId);
  if (user.is_anonymous || !user.email_confirmed_at) throw Error("请先完成邮箱验证，再设置密码。");
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  if (data.user?.id !== expectedId) throw Error("账号已变化，请重新打开。");
}

export async function loginWithPassword(client: Client, email: string, password: string): Promise<User> {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  if (!data.user || data.user.is_anonymous) throw Error("登录未完成，请重试。");
  return data.user;
}

export async function requestPasswordRecovery(client: Client, email: string) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

export async function confirmPasswordRecovery(client: Client, email: string, token: string): Promise<User> {
  const { data, error } = await client.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "recovery" });
  if (error) throw error;
  if (!data.user || data.user.is_anonymous || !data.user.email_confirmed_at) throw Error("验证未完成，请重试。");
  return data.user;
}

export function emailAuthMessage(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  if (["email_exists", "identity_already_exists", "user_already_exists"].includes(code))
    return "此邮箱已有关联账号。请使用密码登录；当前游客数据保留，不会自动合并。";
  if (code === "invalid_credentials") return "邮箱或密码不正确，请检查后重试。";
  if (["otp_expired", "otp_disabled"].includes(code)) return "验证码无效或已过期，请重新获取。";
  if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(code)) return "操作过于频繁，请稍后重试。";
  if (code === "weak_password") return "密码未满足账号服务的安全要求，请换一个更强的密码。";
  if (code === "email_not_confirmed") return "邮箱尚未验证，请先完成邮箱验证。";
  if (cause instanceof Error && /^(账号已变化|此账号已绑定|请先完成|邮箱验证尚未完成)/.test(cause.message)) return cause.message;
  return "操作未完成，请检查网络或稍后重试。已有记录不会被删除。";
}
