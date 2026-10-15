export function cloudConfig(url: string | undefined, key: string | undefined) {
  if (!url?.trim() && !key?.trim()) return null;
  if (!url || !key?.startsWith("sb_publishable_"))
    throw Error("Supabase 配置不完整：需要 Project URL 和 Publishable Key。");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw Error("Supabase Project URL 必须是 HTTPS 项目根地址。");
  return { url: parsed.origin, key };
}
