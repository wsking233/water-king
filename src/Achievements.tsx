import { useCallback, useEffect, useRef, useState } from "react";
import { Award, CalendarDays, Flag, Footprints, RefreshCw, ShieldCheck, X } from "lucide-react";
import { abortable } from "./cloud/request";
import { getCloudClient } from "./cloud/client";
import { achievementCacheKey, parseAchievements, readAchievementCache, type AchievementPage } from "./achievementData";

export function Achievements({ owner, pending, syncMessage, close }: { owner: string; pending: number | null; syncMessage: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState<string | null>(owner === "local" ? null : owner);
  const [identityReady, setIdentityReady] = useState(false);
  const [page, setPage] = useState<AchievementPage | null>(null), [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const request = useRef<AbortController | null>(null);
  const activeAccount = useRef(accountId); activeAccount.current = accountId;
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = AbortSignal.timeout(15000), signal = AbortSignal.any([controller.signal, timeout]);
    if (!accountId) return;
    setBusy(true); setError("");
    try {
      if (!navigator.onLine) throw Error("网络已断开，当前改动需同步后再确认成就。");
      const client = getCloudClient(); if (!client) throw Error("成就服务暂未配置。");
      const { data: auth, error: failure } = await abortable(client.auth.getSession(), signal);
      if (failure) throw failure;
      if (auth.session?.user.id !== accountId) throw Error("账号已变化，请重新打开成就页。");
      const result = await client.rpc("achievement_page", {}).setHeader("Authorization", `Bearer ${auth.session.access_token}`)
        .abortSignal(signal);
      if (result.error) throw result.error;
      const next = parseAchievements(result.data);
      if (controller.signal.aborted || activeAccount.current !== accountId) return;
      setPage(next); setCached(false);
      try { localStorage.setItem(achievementCacheKey(accountId), JSON.stringify({ owner: accountId, page: next })); } catch { /* Cache quota cannot turn a confirmed read into a failure. */ }
    } catch (cause) {
      if (!controller.signal.aborted) { setCached(true); setError(timeout.aborted ? "连接超时，请检查网络后重试。" : cause instanceof Error ? cause.message : "成就暂时无法确认，请联网后重试。"); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, [accountId]);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.current!.showModal();
    return () => { request.current?.abort(); dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    let client;
    try { client = getCloudClient(); } catch { setIdentityReady(true); return; }
    let alive = true, changed = false;
    const identity = new AbortController(), signal = AbortSignal.any([identity.signal, AbortSignal.timeout(10000)]);
    if (!client) { setIdentityReady(true); return; }
    void abortable(client.auth.getSession(), signal).then(({ data }) => { if (alive && !changed) { setAccountId(data.session?.user.id ?? null); setIdentityReady(true); } }).catch(() => { if (alive && !changed) { setIdentityReady(true); setError("账号暂时无法确认，请重新打开成就页。"); } });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      changed = true; identity.abort();
      const next = session?.user.id ?? null;
      if (activeAccount.current !== next) {
        request.current?.abort(); setPage(null); setError("");
        if (activeAccount.current) { try { localStorage.removeItem(achievementCacheKey(activeAccount.current)); } catch {} }
      }
      setAccountId(next); setIdentityReady(true);
    });
    return () => { alive = false; identity.abort(); data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!identityReady) return;
    request.current?.abort(); setPage(null); setError(""); setBusy(false);
    if (!accountId) return;
    let previous: AchievementPage | null = null;
    try { previous = readAchievementCache(localStorage, accountId); } catch {}
    if (previous) { setPage(previous); setCached(true); }
    void loadRef.current();
    return () => request.current?.abort();
  }, [accountId, identityReady]);
  useEffect(() => {
    const online = () => { setOffline(false); void loadRef.current(); };
    const disconnected = () => { setOffline(true); setCached(true); };
    const visible = () => { if (document.visibilityState === "visible" && navigator.onLine) void loadRef.current(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online); window.addEventListener("offline", disconnected);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", online); window.removeEventListener("offline", disconnected); };
  }, []);
  // A completed sync or resolved conflict should update conditions while this sheet stays open.
  const syncVersion = useRef(`${pending}:${syncMessage}`);
  useEffect(() => {
    const next = `${pending}:${syncMessage}`;
    if (syncVersion.current === next) return;
    syncVersion.current = next;
    if (identityReady && accountId && navigator.onLine) void loadRef.current();
  }, [pending, syncMessage, identityReady, accountId]);
  return <dialog ref={dialog} className="sheet achievements-sheet" aria-labelledby="achievements-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="sheet-handle" />
    <div className="sheet-heading"><h2 id="achievements-title">我的成就</h2><button className="icon-button" aria-label="关闭成就" onClick={close}><X /></button></div>
    <p className="sheet-description achievement-intro"><ShieldCheck size={16} />仅自己可见。按当前有效记录计算，删改后可能不再达成；不发积分或奖励。</p>
    {!accountId && error && <p role="alert" className="account-error">{error}</p>}
    {!identityReady ? <p role="status">正在确认账号…</p> : !accountId ? <section className="achievement-empty"><Award size={40} /><h3>让日常记录，成为小小里程碑</h3><p>首版成就由云端确认，游客与邮箱账号同等参与。接入云同步后，已有有效记录也会参与统计。</p><button className="primary" onClick={() => { close(); window.scrollTo({ top: 0 }); }}>返回我的，接入云同步</button></section> : <>
      <section className="achievement-summary" aria-label="当前成就概况"><Award size={32} /><span><strong>{page ? `${page.achievedCount} / ${page.items.length}` : "— / 9"}</strong><small>{!page ? "等待云端确认" : cached || offline ? "上次确认时达成" : "当前达成"}</small></span><button disabled={busy || offline} onClick={() => void load()} aria-label="刷新成就"><RefreshCw size={19} className={busy ? "refresh-spinning" : ""} /></button></section>
      {owner === accountId && (pending !== 0 || syncMessage !== "记录已同步") && <p className="achievement-notice">仅统计已被云端接收的记录。{pending ? `还有 ${pending} 项改动待同步。` : "本机与云端状态以同步结果为准。"}</p>}
      {page && <p className="achievement-time">{cached || offline ? "缓存，尚未重新确认" : "服务器确认"} · 北京时间 {new Date(page.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>}
      {page?.incompleteGoalHistory && <p className="achievement-notice">历史目标覆盖不完整，只统计可靠的目标日期；不以当前目标追溯旧记录。</p>}
      {error && <p role="alert" className="account-error">{error}<button className="secondary" disabled={busy || offline} onClick={() => void load()}>重试确认</button></p>}
      {!page && busy && <p role="status" className="achievement-empty">正在整理你的云端记录…</p>}
      {page && <ul className="achievement-grid">{page.items.map(item => {
        const Icon = item.id.startsWith("goal") ? Flag : item.id.startsWith("streak") ? Footprints : item.id === "first_record" ? Award : CalendarDays;
        return <li className="achievement-card" data-achieved={item.achieved} key={item.id} aria-label={`${item.title}，${item.achieved ? "已达成" : "未达成"}`}><div className="achievement-symbol"><Icon size={25} /></div><h3>{item.title}</h3><p>{item.description}</p><progress aria-label={`${item.title}进度`} max={item.target} value={item.progress} /><span className="achievement-progress">{item.progress} / {item.target} {item.unit}</span><strong className="achievement-state">{item.achieved ? cached || offline ? "上次已达成" : "已达成" : "继续慢慢积累"}</strong></li>;
      })}</ul>}
      <p className="achievement-note">有效记录日包括饮水或嘘嘘，每天只算一次；连续类按历史最长连续天数。统一使用北京日期。目标只是个人提醒，不必勉强完成。</p>
    </>}
    <button className="secondary" onClick={close}>关闭</button>
  </dialog>;
}
