import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getCloudClient } from "./cloud/client";
import { defaultNickname, enterGuest, loadProfile } from "./cloud/identity";
import type { DataAccess } from "./DataGate";
import type { DataSnapshot } from "./dataSession";
import { totals } from "./records";
import { ConflictSheet } from "./ConflictSheet";
import { SignOutSheet } from "./SignOutSheet";
import { useEmailAuth, type EmailAction } from "./EmailAuthSheet";
import { guestExpiryMessage } from "./cloud/lifecycle";

function ConnectSheet({ preview, accountId, access, close }: { preview: DataSnapshot; accountId: string; access: DataAccess; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [importLocal, setImportLocal] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current!.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { controller.current?.abort(); dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="connect-title" onCancel={(event) => {
    event.preventDefault(); controller.current?.abort(); close();
  }}>
    <div className="sheet-handle" />
    <h2 id="connect-title">接入私人云同步</h2>
    <p className="sheet-description account-id">目标账号：{accountId}</p>
    <p className="sheet-description">本机有 {preview.state.entries.length} 条记录：约 {totals(preview.state.entries).water} ml 饮水、{totals(preview.state.entries).small} 次嘘嘘。当前杯容量 {preview.state.cup.capacity} ml。</p>
    <p className="sheet-description">饮水、嘘嘘和每日目标仅本人可访问。当前杯子按设备独立；原本机数据保留，不会因本次接入而删除。</p>
    <label className="sync-choice"><input type="radio" name="sync-import" checked={importLocal} disabled={working} onChange={() => setImportLocal(true)} />
      <span>合并本机记录<small>按记录 ID 去重；云端已删除的记录不恢复。保留本机杯子；云端已有每日目标时沿用云端目标。</small></span></label>
    <label className="sync-choice"><input type="radio" name="sync-import" checked={!importLocal} disabled={working} onChange={() => setImportLocal(false)} />
      <span>仅恢复云端记录<small>不上传原本机记录；此设备没有云端杯子时开始新杯。</small></span></label>
    <p className="sheet-description">如果相同 ID 存在不同内容，将暂停接入并保留两边数据。首次接入确认后才上传。未绑定游客连续 30 天未有效联网使用会过期，请保留备份。</p>
    {error && <p className="account-error" role="alert">{error}</p>}
    <button className="primary" disabled={working} onClick={async () => {
      setWorking(true); setError("");
      controller.current = new AbortController();
      try { await access.connect(preview, importLocal, accountId, controller.current.signal); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "接入未完成，请重试"); setWorking(false); }
    }}>{working ? "正在准备数据…" : "确认接入同步"}</button>
    <button className="secondary" autoFocus onClick={() => { controller.current?.abort(); close(); }}>暂不接入</button>
  </dialog>;
}

export function AccountPanel({ access }: { access: DataAccess }) {
  const [setup] = useState(() => {
    try { return { client: getCloudClient(), error: "" }; }
    catch { return { client: null, error: "账号服务配置有误，暂时无法连接。" }; }
  });
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState("");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(setup.error);
  const [message, setMessage] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [preview, setPreview] = useState<{ snapshot: DataSnapshot; accountId: string } | null>(null);
  const openEmailAuth = useEmailAuth();
  const showEmailAction = (action: EmailAction) => {
    if (setup.client) openEmailAuth({ client: setup.client, action, accountId: user?.id ?? null });
  };
  const [conflictPreview, setConflictPreview] = useState<DataSnapshot | null>(null);
  const [signOutTarget, setSignOutTarget] = useState<{ id: string; anonymous: boolean } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const currentId = useRef<string | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const client = setup.client;
    if (!client) { setReady(true); return; }
    let mounted = true;
    // Callback is synchronous: never await another Auth method under its lock.
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      currentId.current = session?.user.id ?? null;
      setUser(session?.user ?? null);
      setReady(true);
    });
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError("身份暂时无法恢复，请联网后重新打开。不会自动创建新游客。");
      else {
        currentId.current = data.session?.user.id ?? null;
        setUser(data.session?.user ?? null);
      }
      setReady(true);
    }).catch(() => {
      if (mounted) { setReady(true); setError("身份暂时无法读取，本机记录仍可使用。"); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [setup]);

  useEffect(() => {
    setNickname("");
    setDraft("");
    setMessage("");
    const client = setup.client;
    if (!client || !user) return;
    let active = true;
    const id = user.id;
    if (!online || document.hidden) return () => { active = false; };
    loadProfile(client, user).then((profile) => {
      if (active && currentId.current === id) {
        setNickname(profile.nickname);
        setDraft(profile.nickname);
        setError("");
      }
    }).catch((cause) => {
      if (active && currentId.current === id)
        setError(guestExpiryMessage(cause) ?? "昵称暂时无法读取，可联网后重试。身份和本机记录不受影响。");
    });
    return () => { active = false; };
  }, [setup, user?.id, online, profileRetry]);

  async function createGuest() {
    if (!setup.client || busy) return;
    setBusy(true); setError("");
    try {
      const next = await enterGuest(setup.client);
      currentId.current = next.id;
      setUser(next);
    } catch {
      setError("游客登录未完成，请检查网络后重试。若已启用验证码，请先配置验证入口。");
    } finally { setBusy(false); }
  }
  async function saveNickname() {
    if (!setup.client || !user || busy) return;
    const name = draft.trim();
    if (!name || name.length > 40) { setError("昵称请输入 1–40 个字符。"); return; }
    const id = user.id;
    setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: saveError } = await setup.client.from("profiles")
        .update({ nickname: name }).eq("user_id", id).select("nickname").single();
      if (saveError) throw saveError;
      if (currentId.current !== id) return;
      setNickname(data.nickname); setDraft(data.nickname); setMessage("昵称已保存，用户 ID 保持不变。");
    } catch (cause) {
      if (currentId.current === id) setError(guestExpiryMessage(cause) ?? "昵称未保存，请联网后重试。");
    } finally { setBusy(false); }
  }

  return <><section className="account-card" aria-labelledby="account-heading">
    <h2 id="account-heading">我的账号</h2>
    {!ready ? <p role="status">正在恢复身份…</p> : !setup.client ?
      <p>账号服务暂未配置，仍可继续本机记录。</p> : user ? <>
        <div className="account-identity"><span className="account-avatar">{Array.from(nickname || "水")[0]}</span><div><strong>{nickname || defaultNickname(user.id)}</strong><p>{user.is_anonymous ? "游客账号 · 可随时绑定邮箱" : user.email || "邮箱账号"}</p></div><span className="identity-badge">{user.is_anonymous ? "游客" : "已绑定"}</span></div>
        <details key={user.id} className="account-profile"><summary>账号资料与昵称</summary>
        <p className="account-id">用户 ID：{user.id}</p>
        <label htmlFor="account-nickname">昵称</label>
        <div className="account-edit">
          <input id="account-nickname" value={draft} maxLength={40}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy || !online || !nickname} autoComplete="nickname" />
          <button onClick={saveNickname} disabled={busy || !online || !nickname || draft.trim() === nickname}>保存</button>
        </div>
        </details>
        {user.is_anonymous && <p>游客身份保存在当前浏览器。清除网站数据或更换设备后，无法找回未绑定账号。</p>}
      </> : <>
        <p>无需填写邮箱或密码，可选择创建游客身份。</p>
        <button className="primary" disabled={busy || !online} onClick={createGuest}>
          {busy ? "正在登录…" : online ? "游客登录" : "联网后可游客登录"}
        </button>
      </>}
    {ready && setup.client && <div className="account-auth-actions">
      {user?.is_anonymous && <button disabled={!online || busy} onClick={() => showEmailAction("bind")}>绑定邮箱</button>}
      {user && !user.is_anonymous && <button disabled={!online || busy} onClick={() => showEmailAction("password")}>设置或修改密码</button>}
      <button disabled={!online || busy} onClick={() => showEmailAction("login")}>邮箱密码登录</button>
      <button disabled={!online || busy} onClick={() => showEmailAction("recover")}>找回密码</button>
      {user && <button disabled={!online || busy} onClick={() => setSignOutTarget({ id: user.id, anonymous: user.is_anonymous === true })}>退出登录</button>}
    </div>}
    {signOutTarget && <SignOutSheet access={access} accountId={signOutTarget.id} anonymous={signOutTarget.anonymous} close={() => setSignOutTarget(null)} />}
    {error && <><p className="account-error" role="alert">{error}</p>{user && <button disabled={!online || busy} onClick={() => setProfileRetry(n => n + 1)}>重新读取昵称</button>}</>}
    {message && <p role="status">{message}</p>}
    </section>
    <section className="account-card sync-card" aria-labelledby="sync-heading">
    <div className="sync-heading"><h2 id="sync-heading">云同步</h2><span className={`sync-badge sync-${access.sync.status}`}>{({local:"仅本机",pending:"待同步",syncing:"同步中",synced:"已同步",conflict:"需处理",expired:"已过期",error:"未完成"})[access.sync.status]}</span></div>
    <p role="status">{access.sync.message}</p>
    {access.session.owner !== "local" && <dl className="sync-facts"><div><dt>待同步改动</dt><dd>{access.details.pending === null ? "正在读取" : `${access.details.pending} 项`}</dd></div><div><dt>最近同步成功</dt><dd>{access.details.lastSyncedAt ? new Date(access.details.lastSyncedAt).toLocaleString("zh-CN", {hour12:false}) : "暂无成功记录"}</dd></div></dl>}
    {access.conflict?.mutation.owner === access.session.owner && access.sync.status === "conflict" && <button className="primary" onClick={async () => { try { const snapshot=await access.session.read(); if(snapshot.error)throw Error(snapshot.error);setConflictPreview(snapshot); } catch {setError("冲突内容暂时无法读取，请重试。");} }}>处理同步冲突</button>}
    {conflictPreview && access.conflict?.mutation.owner === access.session.owner && <ConflictSheet access={access} preview={conflictPreview} close={() => setConflictPreview(null)} />}
    {!access.syncEnabled && <p>云同步正在准备中。当前仍可在本机记录和导出备份。</p>}
    {access.syncEnabled && user && access.session.owner === "local" && <button className="primary" disabled={busy || !online} onClick={async () => {
      try {
        const snapshot = await access.session.read();
        if (snapshot.error) { setError(snapshot.error); return; }
        setPreview({ snapshot, accountId: user.id });
      } catch { setError("本机数据暂时无法读取，尚未上传。"); }
    }}>设置云同步</button>}
    {access.syncEnabled && user && access.session.owner === user.id && <>
      <button className="primary" disabled={!online || access.sync.status === "syncing" || access.sync.status === "conflict" || access.sync.status === "expired"}
        onClick={() => void access.synchronize()}> {access.sync.status === "syncing" ? "正在同步…" : "立即同步"}</button>
      <p>全部记录默认私有。断网时先保存到本机，联网后补传。发生冲突时暂停同步，保留本机改动。</p>
    </>}
    <details className="sync-help"><summary>同步与隐私说明</summary><p>游客也可同步，无需先绑定邮箱。记录和目标默认私有；杯子按设备独立。绑定邮箱后可在其他设备登录恢复。未绑定游客连续 30 天未有效联网使用会过期，请保留备份。</p></details>
    {preview && <ConnectSheet preview={preview.snapshot} accountId={preview.accountId} access={access} close={() => setPreview(null)} />}
  </section></>;
}
