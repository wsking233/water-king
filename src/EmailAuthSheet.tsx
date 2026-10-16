import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./cloud/models";
import { confirmBinding, confirmPasswordRecovery, emailAuthMessage, loginWithPassword, requestBinding, requestPasswordRecovery, setAccountPassword } from "./cloud/emailAuth";
import { pinnedAccountClient } from "./cloud/client";
import { guestExpiryMessage } from "./cloud/lifecycle";

export type EmailAction = "bind" | "login" | "password" | "recover";
export function EmailAuthSheet({ client, action, accountId, close }: {
  client: SupabaseClient<Database>; action: EmailAction; accountId: string | null; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"email" | "code" | "password" | "done">(action === "password" ? "password" : "email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState("");
  const target = useRef(accountId);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current!.showModal();
    return () => { mounted.current = false; dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const title = { bind: "绑定邮箱", login: "邮箱密码登录", password: "设置或修改密码", recover: "找回密码" }[action];
  async function submit() {
    if (running.current) return;
    if ((step === "password" || action === "login") && (!password || (action !== "login" && password !== repeat))) {
      setError("请输入密码，并确保两次输入一致。"); return;
    }
    running.current = true; setBusy(true); setError("");
    try {
      if (step === "password") {
        if (!target.current) throw Error("账号已变化，请重新打开。");
        await setAccountPassword(client, target.current, password, pinnedAccountClient);
        if (mounted.current) { setPassword(""); setRepeat(""); setStep("done"); }
      } else if (action === "login") {
        await loginWithPassword(client, email, password);
        if (mounted.current) { setPassword(""); setStep("done"); }
      } else if (step === "email") {
        if (action === "bind") {
          if (!target.current) throw Error("账号已变化，请重新打开。");
          await requestBinding(client, target.current, email, pinnedAccountClient);
        } else await requestPasswordRecovery(client, email);
        if (mounted.current) setStep("code");
      } else {
        const user = action === "bind"
          ? await confirmBinding(client, target.current!, email, code)
          : await confirmPasswordRecovery(client, email, code);
        target.current = user.id;
        if (mounted.current) { setCode(""); setStep("password"); }
      }
    } catch (cause) {
      if (mounted.current) setError(guestExpiryMessage(cause) ?? emailAuthMessage(cause));
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="sheet" aria-labelledby="email-auth-title" onCancel={event => {
    event.preventDefault(); if (!running.current) close();
  }}>
    <div className="sheet-handle" /><h2 id="email-auth-title">{title}</h2>
    {step === "done" ? <p role="status">{action === "login" ? "已登录。账号数据单独保存，请查看同步状态。" : "操作已完成。原有记录保留。"}</p> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {action === "bind" && <p className="sheet-description">在当前游客账号上验证邮箱，保留原用户 ID 和记录。邮箱验证后再设置密码，方便换设备登录。</p>}
      {(action === "login" || action === "recover") && <p className="sheet-description">登录或验证成功后将切换到目标账号。当前账号的本机记录和待同步队列会单独保留，不会自动上传或合并。未绑定游客请先导出备份，退出后可能无法找回。</p>}
      {step === "email" && <label>邮箱<input type="email" required autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>}
      {step === "code" && <>
        <p className="sheet-description">若邮箱可用于此操作，将收到验证邮件。请输入邮件中的验证码；不要转发给他人。</p>
        <label>邮箱验证码<input required inputMode="numeric" autoComplete="one-time-code" value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></label>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setCode(""); setStep("email"); setError(""); }}>重新获取或修改邮箱</button>
      </>}
      {(step === "password" || action === "login") && <>
        <label>{action === "login" ? "密码" : "新密码"}<input type="password" required autoComplete={action === "login" ? "current-password" : "new-password"} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        {action !== "login" && <label>再次输入密码<input type="password" required autoComplete="new-password" value={repeat} disabled={busy} onChange={e => setRepeat(e.target.value)} /></label>}
      </>}
      {error && <p role="alert" className="account-error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "正在处理…" : step === "password" ? "保存密码" : action === "login" ? "登录并切换账号" : step === "code" ? "验证邮箱" : "发送验证邮件"}</button>
    </form>}
    <button className="secondary" disabled={busy} autoFocus onClick={close}>{step === "done" ? "完成" : "关闭"}</button>
  </dialog>;
}


type EmailRequest = { client: SupabaseClient<Database>; action: EmailAction; accountId: string | null };
const EmailAuthContext = createContext<(request: EmailRequest) => void>(() => {});
/** Lives outside the account-keyed app, so recovery survives the identity switch. */
export function EmailAuthProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EmailRequest | null>(null);
  return <EmailAuthContext.Provider value={setRequest}>
    {children}
    {request && <EmailAuthSheet {...request} close={() => setRequest(null)} />}
  </EmailAuthContext.Provider>;
}
export const useEmailAuth = () => useContext(EmailAuthContext);
