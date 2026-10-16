import { useEffect, useRef, useState } from "react";
import type { DataAccess } from "./DataGate";

export function SignOutSheet({ access, accountId, anonymous, close }: {
  access: DataAccess; accountId: string; anonymous: boolean; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current!.showModal();
    return () => { dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="signout-title" onCancel={event => {
    event.preventDefault(); if (!running.current) close();
  }}>
    <div className="sheet-handle" /><h2 id="signout-title">退出当前账号？</h2>
    <p className="sheet-description">退出后回到独立的本机记录。当前账号的记录和待同步改动仍单独保存在此浏览器，不会删除，也不会上传到其他账号。再次登录同一账号后才能继续使用它们。</p>
    <p className="sheet-description">未同步的改动还没有云端备份，建议取消并先导出。退出不会退出其他设备。</p>
    {anonymous && <p className="account-error">当前是未绑定游客，退出后可能无法找回原身份。建议先绑定邮箱或导出备份。</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    <button className="primary" disabled={busy} onClick={async () => {
      if (running.current) return;
      running.current = true; setBusy(true); setError("");
      try { await access.signOut(accountId); close(); }
      catch { setError("退出未完成，请检查网络后重试。账号数据未被删除。"); setBusy(false); running.current = false; }
    }}>{busy ? "正在退出…" : "确认退出"}</button>
    <button className="secondary" disabled={busy} autoFocus onClick={close}>取消，保留当前登录</button>
  </dialog>;
}
