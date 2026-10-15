import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Droplet,
  Waves,
  Plus,
  ChevronRight,
  ChevronLeft,
  History,
  Trophy,
  X,
  Trash2,
  Check,
  GlassWater,
  UserRound,
  ShieldCheck,
  RefreshCw,
  Minus,
  ArrowUpRight,
} from "lucide-react";
import {
  KEY,
  STORE_KEY,
  readStore,
  newCup,
  cupProgress,
  updateProgress,
  type Store,
  type Cup,
  todayEntries,
  totals,
  validAmount,
  dayKey,
  groupRecords,
  type RecordGroup,
  type Entry,
  type Kind,
} from "./records";
import "./style.css";
import { appBuild } from "./build";
const labels = { water: "喝水", small: "嘘嘘" };
type Tab = "today" | "history" | "rank" | "me";
type Sheet = Kind | "clear" | Entry | RecordGroup | null;
function Icon({ kind }: { kind: Kind }) {
  return kind === "water" ? <Droplet /> : <Waves />;
}
function BottomSheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right)
            close();
        }
      }}
    >
      <div className="sheet-handle" />
      <div className="sheet-heading">
        <h2 id="sheet-title">{title}</h2>
        <button
          className="icon-button"
          autoFocus
          aria-label="关闭弹层"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [refreshing, setRefreshing] = useState(false);
  function refreshApp() {
    if (!navigator.onLine) {
      setError("当前处于离线状态，请联网后再刷新应用。记录仍保存在本机。");
      return;
    }
    setRefreshing(true);
    const url = new URL(window.location.href);
    url.searchParams.set("_refresh", String(Date.now()));
    window.location.replace(url.toString());
  }
  const [initial] = useState(() => {
    try {
      const state = readStore(
        localStorage.getItem(STORE_KEY),
        localStorage.getItem(KEY),
      );
      return { ...state, error: "" };
    } catch {
      return {
        entries: [] as Entry[],
        cup: newCup(),
        error:
          "本地记录暂时无法读取，原数据未被覆盖。可前往「我的」清空后重新开始。",
      };
    }
  });
  const [cup, setCup] = useState(initial.cup);
  const [draft, setDraft] = useState<number | null>(null);
  const [entries, setEntries] = useState(initial.entries),
    [blocked, setBlocked] = useState(Boolean(initial.error)),
    [error, setError] = useState(initial.error);
  const [tab, setTab] = useState<Tab>("today"),
    [sheet, setSheet] = useState<Sheet>(null),
    [amount, setAmount] = useState("250"),
    [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState<{ text: string; undo?: string } | null>(
    null,
  );
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key !== STORE_KEY && e.key !== null) return;
      try {
        const state = readStore(
          localStorage.getItem(STORE_KEY),
          localStorage.getItem(KEY),
        );
        setEntries(state.entries);
        setCup(state.cup);
        setDraft(null);
        setBlocked(false);
        setError("");
      } catch {
        setBlocked(true);
        setError("本地数据无法读取，请前往「我的」处理。");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Tab) {
    setTab(next);
    setSheet(null);
    setNotice(null);
    window.scrollTo({ top: 0 });
    if (next === "history") setSelectedDate(new Date());
  }
  function persist(
    next: Entry[],
    text: string,
    undo?: string,
    nextCup: Cup = cup,
  ) {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ entries: next, cup: nextCup }),
      );
      setCup(nextCup);
      setDraft(null);
      setEntries(next);
      setBlocked(false);
      setError("");
      setNotice({ text, undo });
      return true;
    } catch {
      setError("保存失败，本次操作未保存。请检查浏览器存储后重试。");
      return false;
    }
  }
  function add(kind: "small") {
    if (blocked) return;
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind,
      amount: 1,
      at: new Date().toISOString(),
    };
    if (persist([entry, ...entries], "已记录嘘嘘 1 次", entry.id))
      setSheet(null);
  }
  const state: Store = { entries, cup };
  const progress = cupProgress(state, now);
  const displayed = draft ?? progress;
  function commitProgress(value: number) {
    if (blocked) return;
    const date = new Date();
    setNow(date);
    const next = updateProgress(state, value, date);
    if (!persist(next.entries, `本杯已喝 ${value} ml`, undefined, next.cup))
      setDraft(null);
    else setNotice(null);
  }
  function saveCapacity() {
    if (!validAmount(Number(amount))) {
      setError("请输入 1–5000 ml 的整数容量。");
      return;
    }
    const nextCup =
      Number(amount) === cup.capacity ? cup : newCup(Number(amount));
    if (persist(entries, "杯子容量已保存", undefined, nextCup)) setSheet(null);
  }
  function open(next: Sheet) {
    if (next === "water") setAmount(String(cup.capacity));
    if (!blocked) setError("");
    setNotice(null);
    setSheet(next);
  }
  function remove(entry: Entry) {
    if (
      persist(
        entries.filter((e) => e.id !== entry.id),
        "记录已删除",
      )
    )
      setSheet(null);
  }
  function changeDay(offset: number) {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + offset);
      return next;
    });
  }
  const today = todayEntries(entries, now),
    stats = totals(today),
    percent = Math.min(100, Math.round((stats.water / 2000) * 100));
  const history = todayEntries(entries, selectedDate).filter(
    (e) => filter === "all" || e.kind === filter,
  );
  const days = new Set(entries.map((e) => dayKey(new Date(e.at)))).size;
  function recordList(list: RecordGroup[]) {
    return (
      <div className="record-list">
        {list.length ? (
          list.map((e) => (
            <button
              key={e.id}
              className="record"
              onClick={() => open(e)}
              aria-label={`查看${labels[e.kind]} ${e.amount}${e.kind === "water" ? "毫升" : "次"}记录`}
            >
              <span className={`record-icon ${e.kind}`}>
                <Icon kind={e.kind} />
              </span>
              <span className="record-name">
                <strong>
                  {e.kind === "water" && e.cupId ? "一杯水" : labels[e.kind]}
                </strong>
                <small>
                  {new Date(e.at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {e.kind === "water" && e.cupId
                    ? ` · ${e.members.length} 次饮水`
                    : ""}
                </small>
              </span>
              <span className="record-value">
                {e.amount}
                <small>{e.kind === "water" ? "ml" : "次"}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))
        ) : (
          <div className="empty">
            <GlassWater />
            <h3>
              {tab === "today"
                ? "第一口水，从现在开始"
                : "这一天还没有相关记录"}
            </h3>
            <p>
              {tab === "today"
                ? "拖动杯子进度，或点击「嘬一口」。"
                : "用上方日期切换，看看其他日子的记录。"}
            </p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="app">
      <header className="app-header">
        <span className="wordmark">
          <Waves size={24} />
          大水之王
        </span>
        <span className="device-badge">
          <span /> 本机记录
        </span>
      </header>
      <main>
        {error && !sheet && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {tab === "today" && (
          <>
            <section className="greeting home-greeting">
              <h1>今天</h1>
              <p>
                {now.toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </p>
            </section>
            <section className="daily-summary" aria-label="今日饮水统计">
              <div>
                <span>今日饮水</span>
                <strong className="total">
                  {stats.water.toLocaleString()}
                  <small> ml</small>
                </strong>
              </div>
              <div className="daily-goal">
                <span>参考 2,000 ml · {percent}%</span>
                <div className="daily-track">
                  <span style={{ width: `${percent}%` }} />
                </div>
              </div>
            </section>
            <section className="cup-tracker">
              <div className="section-heading">
                <h2>我的杯子</h2>
                <button onClick={() => open("water")} disabled={blocked}>
                  容量 {cup.capacity} ml <ChevronRight size={16} />
                </button>
              </div>
              <div className="cup-reading">
                <strong>
                  {displayed}
                  <small> / {cup.capacity} ml</small>
                </strong>
                <span>
                  {displayed === cup.capacity ? "这杯喝完啦" : "本杯已喝"}
                </span>
              </div>
              <input
                className="cup-slider"
                style={
                  {
                    "--fill": `${(displayed / cup.capacity) * 100}%`,
                  } as React.CSSProperties
                }
                type="range"
                aria-label="本杯已喝水量"
                aria-valuetext={`已喝 ${displayed} 毫升，共 ${cup.capacity} 毫升`}
                min="0"
                max={cup.capacity}
                step="1"
                value={displayed}
                disabled={blocked}
                onChange={(e) => setDraft(Number(e.target.value))}
                onPointerUp={(e) =>
                  commitProgress(Number(e.currentTarget.value))
                }
                onPointerCancel={() => setDraft(null)}
                onKeyUp={(e) => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(e.key)
                  )
                    commitProgress(Number(e.currentTarget.value));
                }}
                onBlur={(e) => {
                  if (draft !== null)
                    commitProgress(Number(e.currentTarget.value));
                }}
              />
              <div className="slider-labels">
                <span>还没喝</span>
                <span>喝完一杯</span>
              </div>
              <p>拖动后松手保存，往回拖可修正本杯记录。</p>
              <button
                className="refill"
                disabled={blocked}
                onClick={() =>
                  persist(
                    entries,
                    "已开始新的一杯",
                    undefined,
                    newCup(cup.capacity),
                  )
                }
              >
                <Plus size={18} />
                再接一杯<span>保留已喝水量，进度归零</span>
              </button>
            </section>
            <div className="body-stats">
              <button onClick={() => open("small")} disabled={blocked}>
                <span className="record-icon small">
                  <Waves />
                </span>
                <span>
                  <small>今日嘘嘘</small>
                  <strong>
                    {stats.small}
                    <em>次</em>
                  </strong>
                </span>
                <Plus size={18} />
              </button>
            </div>
            <section className="recent">
              <div className="section-heading">
                <h2>
                  今天的足迹 <span>{groupRecords(today).length}</span>
                </h2>
                <button onClick={() => navigate("history")}>
                  全部记录 <ArrowUpRight size={16} />
                </button>
              </div>
              {recordList(groupRecords(today).slice(0, 3))}
            </section>
            <p className="gentle-note">
              按身体需要饮水，参考目标不是医疗建议。
            </p>
          </>
        )}
        {tab === "history" && (
          <>
            <section className="page-heading">
              <p>一点一滴，都记得</p>
              <h1>记录</h1>
            </section>
            <div className="date-switch">
              <button
                className="icon-button"
                aria-label="前一天"
                onClick={() => changeDay(-1)}
              >
                <ChevronLeft />
              </button>
              <label>
                <span>
                  {dayKey(selectedDate) === dayKey(now) ? "今天 · " : ""}
                  {selectedDate.toLocaleDateString("zh-CN", {
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                <input
                  aria-label="选择记录日期"
                  type="date"
                  value={`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`}
                  onChange={(e) => {
                    if (e.target.value)
                      setSelectedDate(new Date(`${e.target.value}T12:00:00`));
                  }}
                />
              </label>
              <button
                className="icon-button"
                aria-label="后一天"
                onClick={() => changeDay(1)}
              >
                <ChevronRight />
              </button>
            </div>
            <div className="filters" aria-label="记录类型">
              {(["all", "water", "small"] as const).map((kind) => (
                <button
                  key={kind}
                  aria-pressed={filter === kind}
                  className={filter === kind ? "selected" : ""}
                  onClick={() => setFilter(kind)}
                >
                  {kind === "all" ? "全部" : labels[kind]}
                </button>
              ))}
            </div>
            <div className="history-summary">
              <span>{groupRecords(history).length} 项记录</span>
              <span>点击查看详情</span>
            </div>
            {recordList(groupRecords(history))}
          </>
        )}
        {tab === "rank" && (
          <>
            <section className="page-heading">
              <p>好习惯，慢慢来</p>
              <h1>
                习惯榜 <span className="demo-badge">演示</span>
              </h1>
            </section>
            <section className="rank-intro">
              <Trophy size={40} />
              <h2>每一次坚持，都值得</h2>
              <p>本周记录天数榜</p>
            </section>
            <div className="rank-list">
              {[
                ["小水滴", 7],
                ["慢慢来", 6],
                ["早睡的鱼", 5],
              ].map(([name, count], i) => (
                <div className="rank-row" key={name}>
                  <span className="rank-index">{i + 1}</span>
                  <span className={`avatar avatar-${i}`}>
                    {String(name).slice(0, 1)}
                  </span>
                  <strong>{name}</strong>
                  <span>
                    {count}
                    <small> 天</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="info-note">
              <ShieldCheck size={20} />
              <p>
                这是模拟榜单，仅展示交互效果。
                <br />
                你的记录只保存在本机，不会上传或参与排名。
              </p>
            </div>
          </>
        )}
        {tab === "me" && (
          <>
            <section className="page-heading">
              <p>照顾自己，是件小事</p>
              <h1>我的</h1>
            </section>
            <section className="profile">
              <span className="profile-icon">
                <Waves size={36} />
              </span>
              <h2>自己的节奏，就很好</h2>
              <p>不比较，不赶路，慢慢养成习惯。</p>
              <div className="profile-stats">
                <span>
                  <strong>{days}</strong>记录天数
                </span>
                <span>
                  <strong>{entries.length}</strong>累计记录
                </span>
              </div>
            </section>
            <section className="settings">
              <div>
                <ShieldCheck />
                <span>
                  <strong>数据留在你的设备</strong>
                  <small>无需登录，不上传个人记录</small>
                </span>
              </div>
              <button
                className="refresh-app"
                onClick={refreshApp}
                disabled={refreshing}
              >
                <RefreshCw className={refreshing ? "refresh-spinning" : ""} />
                <span>
                  <strong>{refreshing ? "正在刷新…" : "刷新应用"}</strong>
                  <small>重新加载页面，保留本机记录</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button onClick={() => open("clear")}>
                <Trash2 />
                <span>清空所有记录</span>
                <ChevronRight size={18} />
              </button>
            </section>
            <p className="settings-note">
              清除浏览器数据后，记录也会消失。
              <br />
              不同设备或浏览器之间不会同步。
            </p>
            <div className="app-signature">
              <Waves size={22} />
              <span>大水之王 · 用心记录日常</span>
              <small>当前版本 · {appBuild}</small>
            </div>
          </>
        )}
      </main>
      {tab === "today" && (
        <div className="action-dock">
          <button
            className="primary log-water"
            disabled={blocked || progress === cup.capacity}
            onClick={() =>
              commitProgress(Math.min(cup.capacity, progress + 10))
            }
          >
            <Droplet size={23} />
            <span>{progress === cup.capacity ? "这杯喝完啦" : "嘬一口"}</span>
            <span className="quick-amount">
              {progress === cup.capacity
                ? "去再接一杯"
                : `+${Math.min(10, cup.capacity - progress)} ml`}
            </span>
          </button>
        </div>
      )}
      <nav className="tab-bar" aria-label="底部导航">
        {[
          { id: "today", label: "今天", icon: GlassWater },
          { id: "history", label: "记录", icon: History },
          { id: "rank", label: "习惯榜", icon: Trophy },
          { id: "me", label: "我的", icon: UserRound },
        ].map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => navigate(item.id as Tab)}
          >
            <item.icon size={23} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div
          className={`toast ${tab === "today" ? "above-action" : ""}`}
          role="status"
        >
          <Check size={18} />
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              onClick={() => {
                if (
                  persist(
                    entries.filter((e) => e.id !== notice.undo),
                    "已撤销记录",
                  )
                )
                  setSheet(null);
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}
      {sheet && (
        <BottomSheet
          title={
            sheet === "water"
              ? "设置杯子容量"
              : sheet === "small"
                ? "记录一次嘘嘘"
                : sheet === "clear"
                  ? "清空所有记录？"
                  : "记录详情"
          }
          close={() => setSheet(null)}
        >
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {sheet === "water" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveCapacity();
              }}
            >
              <p className="sheet-description">
                设置杯子的总容量。修改容量会开启新的一杯，已记录的饮水量会保留。
              </p>
              <div className="amount-control">
                <button
                  type="button"
                  className="step-button"
                  aria-label="减少50毫升"
                  onClick={() =>
                    setAmount(String(Math.max(1, (Number(amount) || 250) - 50)))
                  }
                >
                  <Minus />
                </button>
                <label>
                  <input
                    aria-label="杯子容量"
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span>ml</span>
                </label>
                <button
                  type="button"
                  className="step-button"
                  aria-label="增加50毫升"
                  onClick={() =>
                    setAmount(
                      String(Math.min(5000, (Number(amount) || 0) + 50)),
                    )
                  }
                >
                  <Plus />
                </button>
              </div>
              <div className="presets">
                {[150, 250, 350, 500].map((v) => (
                  <button
                    type="button"
                    aria-pressed={amount === String(v)}
                    className={amount === String(v) ? "selected" : ""}
                    onClick={() => setAmount(String(v))}
                    key={v}
                  >
                    <GlassWater size={22} />
                    <strong>
                      {v}
                      <small> ml</small>
                    </strong>
                  </button>
                ))}
              </div>
              <button className="primary" disabled={blocked}>
                <Check size={20} />
                保存容量 {amount || "0"} ml
              </button>
            </form>
          ) : sheet === "small" ? (
            <>
              <div className="confirm-activity">
                <span className={`record-icon ${sheet}`}>
                  <Icon kind={sheet} />
                </span>
                <h3>轻松一下，也记一下。</h3>
                <p>将以当前时间记录 1 次{labels[sheet]}。</p>
              </div>
              <button
                className="primary"
                disabled={blocked}
                onClick={() => add(sheet)}
              >
                <Check size={20} />
                确认记录
              </button>
            </>
          ) : sheet === "clear" ? (
            <>
              <p className="sheet-description">
                所有饮水和如厕记录都会被永久删除，无法恢复。
              </p>
              <button
                className="danger"
                onClick={() => {
                  if (
                    persist(
                      [],
                      "本地记录已清空",
                      undefined,
                      newCup(cup.capacity),
                    )
                  )
                    setSheet(null);
                }}
              >
                确认清空全部记录
              </button>
              <button className="secondary" onClick={() => setSheet(null)}>
                保留记录
              </button>
            </>
          ) : (
            <>
              <div className="entry-detail">
                <span className={`record-icon ${sheet.kind}`}>
                  <Icon kind={sheet.kind} />
                </span>
                <h3>
                  {labels[sheet.kind]} <strong>{sheet.amount}</strong>{" "}
                  {sheet.kind === "water" ? "ml" : "次"}
                </h3>
                <p>
                  {new Date(sheet.at).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {"members" in sheet && sheet.kind === "water" && sheet.cupId ? (
                <>
                  <div className="cup-detail-heading">
                    <h3>饮水明细</h3>
                    <span>{sheet.members.length} 次 · 可逐条修正</span>
                  </div>
                  <div className="cup-details">
                    {sheet.members.map((entry) => (
                      <div className="cup-detail-row" key={entry.id}>
                        <span>
                          {new Date(entry.at).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <strong>+{entry.amount} ml</strong>
                        <button
                          aria-label={`删除 ${entry.amount} ml 饮水明细`}
                          disabled={blocked}
                          onClick={() => remove(entry)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="delete-record"
                    disabled={blocked}
                    onClick={() => {
                      if (
                        window.confirm(
                          "删除这杯水的全部饮水记录？今日累计也会同步减少。",
                        )
                      ) {
                        const ids = new Set(sheet.members.map((e) => e.id));
                        if (
                          persist(
                            entries.filter((e) => !ids.has(e.id)),
                            "这杯水的记录已删除",
                          )
                        )
                          setSheet(null);
                      }
                    }}
                  >
                    <Trash2 size={18} />
                    删除整杯记录
                  </button>
                </>
              ) : (
                <button
                  className="delete-record"
                  disabled={blocked}
                  onClick={() => remove(sheet)}
                >
                  <Trash2 size={18} />
                  删除这条记录
                </button>
              )}
            </>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
