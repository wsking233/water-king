/** Only recognize the server's explicit lifecycle error, never a network failure. */
export function guestExpiryMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value=error as { code?: unknown; message?: unknown };
  return value.code === "PT401" && value.message === "guest_expired"
    ? "原游客已过期，不能恢复云端身份。本机记录和待同步改动已保留，请先导出备份。"
    : null;
}

export function shouldRestoreIdentity(previous: string | null,next: string | null,event: string) {
  return next === null || next !== previous || event === "INITIAL_SESSION";
}
