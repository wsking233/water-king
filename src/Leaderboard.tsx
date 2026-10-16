import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Trophy, ShieldCheck } from "lucide-react";
import { abortable } from "./cloud/request";
import { parseLeaderboard, refreshedLeaderboard, type LeaderboardPage as Page } from "./leaderboardData";
import { getCloudClient } from "./cloud/client";

const metrics = [
  { id: "streak", label: "连续记录", unit: "天", description: "今天未记录时，从昨天向前计算连续记录日。" },
  { id: "days", label: "累计记录", unit: "天", description: "有饮水或嘘嘘的北京日期，每天只算一次。" },
  { id: "goals", label: "目标完成", unit: "天", description: "仅统计有可靠历史目标，且饮水达到当日目标的日期。" },
  { id: "today", label: "今日饮水", unit: "ml", description: "按北京时间今天统计，仅包含已同步的饮水记录。" },
  { id: "total", label: "累计饮水", unit: "ml", description: "所有已同步且未删除的饮水量，包含历史补记。" },
] as const;
type Metric = typeof metrics[number]["id"];
export function Leaderboard({ owner, openAccount }: { owner: string; openAccount: () => void }) {
  const [metric, setMetric] = useState<Metric>("streak");
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pageRef = useRef(page); pageRef.current = page;
  const [refreshNotice, setRefreshNotice] = useState("");
  const load = useCallback(async (more = false, background = false) => {
    if (background && controller.current) return;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const timeout = AbortSignal.timeout(15000), signal = AbortSignal.any([active.signal, timeout]);
    const request = ++generation.current, previous = pageRef.current;
    const offset = more ? previous?.rows.length ?? 0 : 0;
    setBusy(true); setError(""); setRefreshNotice("");
    try {
      if (!navigator.onLine) throw Error("网络已断开，联网后可刷新榜单。");
      const client = getCloudClient();
      if (!client) throw Error("排行榜服务暂未配置，请稍后重试。");
      const auth = await abortable(client.auth.getSession(), signal);
      if (auth.error) throw auth.error;
      let query = client.rpc("leaderboard_page", { p_metric: metric, p_offset: offset, p_snapshot: more ? previous?.snapshot ?? null : null });
      if (auth.data.session) query = query.setHeader("Authorization", `Bearer ${auth.data.session.access_token}`);
      const { data, error: failure } = await query.abortSignal(signal);
      if (failure) throw failure;
      if (request !== generation.current || active.signal.aborted) return;
      const next = parseLeaderboard(data, offset);
      if (next.stale) { setPage(null); throw Error("榜单已变化，请刷新后继续浏览。"); }
      if (!more && previous && previous.rows.length > 20 && previous.snapshot !== next.snapshot) setRefreshNotice("榜单已更新，已重新展示前 20 位水友。");
      setPage(more && previous ? { ...next, rows: [...previous.rows, ...next.rows] } : refreshedLeaderboard(previous, next));
    } catch (cause) {
      if (request === generation.current && !active.signal.aborted) setError(timeout.aborted ? "连接超时，请检查网络后重试。" : cause instanceof Error ? cause.message : "榜单暂时无法加载，请重试。");
    } finally {
      if (request === generation.current && !active.signal.aborted) setBusy(false);
      if (controller.current === active) controller.current = null;
    }
  }, [metric]);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    ++generation.current; pageRef.current = null; setPage(null); void loadRef.current();
    return () => { ++generation.current; controller.current?.abort(); };
  }, [metric, owner]);
  useEffect(() => {
    const online = () => { setOffline(false); void loadRef.current(); };
    const disconnected = () => { setOffline(true); };
    window.addEventListener("online", online); window.addEventListener("offline", disconnected);
    // A new server date or score must not depend on another user writing a record.
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void loadRef.current(false, true); }, 60000);
    const visible = () => { if (document.visibilityState === "visible") void loadRef.current(false, true); };
    document.addEventListener("visibilitychange", visible);
    const privacy = () => { setPage(null); void loadRef.current(); };
    window.addEventListener("waterking:leaderboard-privacy", privacy);
    return () => { clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("offline", disconnected); document.removeEventListener("visibilitychange", visible); window.removeEventListener("waterking:leaderboard-privacy", privacy); };
  }, []);
  useEffect(() => {
    let client;
    try { client = getCloudClient(); } catch { return; }
    if (!client) return;
    let initialized = false, actor: string | null = null;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (!initialized) { initialized = true; actor = next; return; }
      if (next === actor) return;
      actor = next; controller.current?.abort();
      ++generation.current; setPage(null);
      // Leave the Auth callback before querying to avoid Auth's session lock.
      queueMicrotask(() => void loadRef.current());
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const selected = metrics.find(item => item.id === metric)!;
  return <section className="leaderboard-page">
    <header className="page-heading"><p>一起记录，照顾自己</p><h1>水友排行榜</h1></header>
    <p className="leaderboard-disclosure"><ShieldCheck size={18} />云端账号默认参加，仅公开昵称和聚合成绩。原始记录、嘘嘘明细及邮箱保持私有，可在「我的 → 排行榜隐私」退出。</p>
    <div className="leaderboard-metrics" role="tablist" aria-label="排行榜指标">{metrics.map((item, index) => <button key={item.id} role="tab" tabIndex={metric === item.id ? 0 : -1} onKeyDown={event => {
      const next = event.key === "ArrowRight" ? (index + 1) % metrics.length : event.key === "ArrowLeft" ? (index - 1 + metrics.length) % metrics.length : event.key === "Home" ? 0 : event.key === "End" ? metrics.length - 1 : null;
      if (next === null) return; event.preventDefault(); setMetric(metrics[next].id); document.getElementById(`lb-${metrics[next].id}`)?.focus();
    }} id={`lb-${item.id}`} aria-controls="leaderboard-results" aria-selected={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div>
    <p className="leaderboard-description">{selected.description}</p>
    <p className="settings-note">只计算服务端已接收的数据；本机待同步改动暂不计入。不鼓励为了排名过量饮水。</p>
    <div className="leaderboard-toolbar"><span>{page ? `${page.total} 位水友 · 北京时间 ${page.day}` : "全站榜单 · 北京时间"}</span><button onClick={() => void load()} disabled={busy} aria-label="刷新排行榜"><RefreshCw size={18} className={busy ? "refresh-spinning" : ""} />刷新</button></div>
    {page && (offline || error) && <p className="leaderboard-cache" role="status">当前显示本页缓存，成绩可能已变化。</p>}
    {refreshNotice && <p className="leaderboard-time" role="status">{refreshNotice}</p>}
    {page && <p className="leaderboard-time">{offline || error ? "缓存时间" : "截至服务器最近同步"}：{new Date(page.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>}
    {metric === "goals" && <p className="leaderboard-cache">历史目标统计可能不完整。旧数据没有每日目标证据，不会用当前目标追溯计分。{page && !page.goalHistoryAvailable && "目前尚无可靠目标历史覆盖。在线保存目标后可开始建立覆盖。"}</p>}
    {metric === "goals" && page?.goalCoverageStart && <p className="settings-note">你的目标历史起日：{page.goalCoverageStart}。此前及无法确认的日期不计分。</p>}
    {owner === "local" && page?.participating == null ? <button className="leaderboard-mine" onClick={openAccount}><Trophy /><span><strong>我的名次</strong><small>接入云同步后参与，查看「我的」</small></span></button> : <section className="leaderboard-mine" aria-label="我的排名"><Trophy /><span><strong>我的名次</strong><small>{!page ? "等待加载" : page.mine ? `第 ${page.mine.rank} 名 · ${page.mine.score.toLocaleString()} ${selected.unit}${page.mine.empty ? " · 暂无记录" : ""}` : page.participating === false ? "未参与 · 可在「我的」开启" : "暂未取得排名"}</small></span></section>}
    {error && <div className="account-error" role="alert">{error}<button className="secondary" onClick={() => void load()} disabled={busy}>重试加载</button></div>}
    <div id="leaderboard-results" role="tabpanel" aria-labelledby={`lb-${metric}`} aria-busy={busy}>
      {!page && busy && <p className="leaderboard-empty" role="status">正在加载水友成绩…</p>}
      {page && page.total === 0 && <div className="leaderboard-empty"><Trophy size={32} /><h2>还没有参与的水友</h2><p>云端账号可在「我的」开启参与。</p></div>}
      {page && page.rows.length > 0 && <ol className="leaderboard-list" aria-label={selected.label}>{page.rows.map((row, index) => <li key={index}><span className={`leaderboard-rank ${row.rank <= 3 ? "leading" : ""}`} aria-label={`第 ${row.rank} 名`}>{row.rank}</span><span className="leaderboard-person"><strong>{row.nickname}</strong>{(row.empty || row.incomplete) && <small>{row.empty ? "暂无记录" : "历史目标不完整"}</small>}</span><span className="leaderboard-score">{row.score.toLocaleString()}<small>{selected.unit}</small></span></li>)}</ol>}
      {page?.hasMore && <button className="secondary leaderboard-more" disabled={busy || offline} onClick={() => void load(true)}>{busy ? "正在加载…" : "再看 20 位水友"}</button>}
    </div>
  </section>;
}

export function LeaderboardPrivacy({ owner }: { owner: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0), [online, setOnline] = useState(navigator.onLine);
  const [identityReady, setIdentityReady] = useState(false);
  const generation = useRef(0), action = useRef<AbortController | null>(null);
  const actor = useRef<string | null>(null);
  useEffect(() => {
    const connected = () => setOnline(true), disconnected = () => setOnline(false);
    const visible = () => { if (document.visibilityState === "visible" && navigator.onLine) setRetry(n => n + 1); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", connected); window.addEventListener("offline", disconnected);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected); };
  }, []);
  useEffect(() => {
    let client; try { client = getCloudClient(); } catch { setIdentityReady(true); setError("账号配置暂不可用。"); return; }
    if (!client) { setIdentityReady(true); return; }
    let alive = true, changed = false;
    void client.auth.getSession().then(({ data, error }) => { if (error) throw error; if (alive && !changed) { setAccountId(data.session?.user.id ?? null); setIdentityReady(true); } }).catch(() => { if (alive && !changed) { setIdentityReady(true); setError("无法读取账号，请重新打开页面。"); } });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      changed = true; const next = session?.user.id ?? null;
      if (actor.current !== next) { ++generation.current; action.current?.abort(); action.current = null; setBusy(false); setEnabled(null); }
      actor.current = next; setAccountId(next); setIdentityReady(true);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [owner]);
  useEffect(() => { setEnabled(null); return () => { ++generation.current; action.current?.abort(); }; }, [accountId]);
  useEffect(() => {
    const request = ++generation.current, controller = new AbortController();
    setError(""); setBusy(Boolean(action.current));
    if (!accountId) return;
    if (!online) { setError("请联网后确认或修改参与状态。"); return; }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    void (async () => {
      try {
        const client = getCloudClient(); if (!client) throw Error("账号服务暂未配置。");
        const session = await abortable(client.auth.getSession(), signal);
        if (session.error) throw session.error;
        if (session.data.session?.user.id !== accountId) throw Error("账号已变化，请重新打开页面。");
        const result = await client.rpc("leaderboard_preference", {}).setHeader("Authorization", `Bearer ${session.data.session.access_token}`).abortSignal(signal);
        if (result.error || typeof result.data !== "boolean") throw Error("无法确认参与状态，请联网后重试。");
        if (request === generation.current) setEnabled(result.data);
      } catch (cause) { if (request === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法确认参与状态，请重试。"); }
    })();
    return () => controller.abort();
  }, [accountId, retry, online]);
  async function toggle() {
    if (!accountId || enabled === null || busy || action.current || !online) return;
    const request = ++generation.current, controller = new AbortController(); action.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), next = !enabled;
    setBusy(true); setError("");
    try {
      const client = getCloudClient(); if (!client) throw Error("账号服务暂未配置。");
      const session = await abortable(client.auth.getSession(), signal);
      if (session.error) throw session.error;
      if (session.data.session?.user.id !== accountId) throw Error("账号已变化，请重新打开页面。");
      const result = await client.rpc("leaderboard_participation", { p_enabled: next }).setHeader("Authorization", `Bearer ${session.data.session.access_token}`).abortSignal(signal);
      if (result.error || result.data !== next) throw Error("更改结果尚未确认，请重试读取状态。");
      if (request === generation.current) { setEnabled(next); window.dispatchEvent(new Event("waterking:leaderboard-privacy")); }
    } catch (cause) { if (request === generation.current && !controller.signal.aborted) { setEnabled(null); setError(cause instanceof Error ? cause.message : "操作未完成，请重试读取状态。"); } }
    finally {
      if (action.current === controller) {
        action.current = null; setBusy(false);
        if (request !== generation.current && actor.current === accountId && !controller.signal.aborted) { setEnabled(null); setRetry(n => n + 1); }
      }
    }
  }
  return <><h2 className="settings-section-title">排行榜隐私</h2><section className="settings leaderboard-privacy"><p>云端账号默认参加，全站可见昵称和五项聚合成绩。不会公开原始记录、嘘嘘明细或邮箱。关闭后立即从服务器公开结果移除。</p>{!identityReady ? <p role="status">正在确认账号…</p> : !accountId ? <p>{error ? "账号状态尚未确认，请重试。" : "当前未登录云端账号，尚未参与排行榜。"}</p> : enabled === null ? <p role="status">{error ? "参与状态尚未确认，请重新读取。" : "正在读取参与状态…"}</p> : <button role="switch" aria-checked={enabled} disabled={busy || !online} onClick={() => void toggle()}><span><strong>公开参与排行榜</strong><small>{busy ? "正在保存…" : `${online ? "" : "离线 · 上次状态："}${enabled ? "已开启 · 点击退出" : "已关闭 · 点击参加"}`}</small></span><span className={`leaderboard-switch ${enabled ? "on" : ""}`} aria-hidden="true" /></button>}{error && <div className="account-error" role="alert">{error}<button disabled={!online || busy} onClick={() => setRetry(n => n + 1)}>重试读取状态</button></div>}</section></>;
}
