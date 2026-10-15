import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getCloudClient } from "./cloud/client";
import { defaultNickname, enterGuest, loadProfile } from "./cloud/identity";

export function AccountPanel() {
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
    if (!online) return () => { active = false; };
    loadProfile(client, user).then((profile) => {
      if (active && currentId.current === id) {
        setNickname(profile.nickname);
        setDraft(profile.nickname);
        setError("");
      }
    }).catch(() => {
      if (active && currentId.current === id)
        setError("昵称暂时无法读取，可联网后重试。身份和本机记录不受影响。");
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
    } catch {
      if (currentId.current === id) setError("昵称未保存，请联网后重试。");
    } finally { setBusy(false); }
  }

  return <section className="account-card" aria-labelledby="account-heading">
    <h2 id="account-heading">我的账号</h2>
    {!ready ? <p role="status">正在恢复身份…</p> : !setup.client ?
      <p>账号服务暂未配置，仍可继续本机记录。</p> : user ? <>
        <p><strong>{nickname || defaultNickname(user.id)}</strong> · {user.is_anonymous ? "游客" : "已登录"}</p>
        <p className="account-id">用户 ID：{user.id}</p>
        <label htmlFor="account-nickname">昵称</label>
        <div className="account-edit">
          <input id="account-nickname" value={draft} maxLength={40}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy || !online || !nickname} autoComplete="nickname" />
          <button onClick={saveNickname} disabled={busy || !online || !nickname || draft.trim() === nickname}>保存</button>
        </div>
        {user.is_anonymous && <p>游客身份保存在当前浏览器。清除网站数据或更换设备后，无法找回未绑定账号。</p>}
      </> : <>
        <p>无需填写邮箱或密码，可选择创建游客身份。</p>
        <button className="primary" disabled={busy || !online} onClick={createGuest}>
          {busy ? "正在登录…" : online ? "游客登录" : "联网后可游客登录"}
        </button>
      </>}
    <p>当前仅接入账号与昵称。饮水、嘘嘘、杯子和目标仍保存在本机，尚未上传。云同步、绑定与游客 30 天清理仍在开发。</p>
    {error && <>
      <p className="account-error" role="alert">{error}</p>
      {user && <button disabled={!online || busy} onClick={() => setProfileRetry((n) => n + 1)}>重新读取昵称</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
