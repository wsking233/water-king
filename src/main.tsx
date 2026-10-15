import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Droplet,
  Waves,
  Plus,
  ChevronRight,
  ChevronLeft,
  History,
  BarChart3,
  Download,
  Upload,
  Pencil,
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
  validGoal,
  dayKey,
  groupRecords,
  type RecordGroup,
  type Entry,
  type Kind,
} from "./records";
import "./style.css";
import { useOfflineApp, prepareRefresh } from "./offline";
import { EntryEditor } from "./EntryEditor";
import {
  backupText,
  parseBackup,
  upsertRecord,
  localInputDate,
  weekSummary,
} from "./dataTools";
import { CupControl } from "./CupControl";
import { appBuild } from "./build";
const labels = { water: "喝水", small: "嘘嘘" };
type Tab = "today" | "history" | "review" | "me";
type Sheet =
  "edit" | "import" | Kind | "goal" | "clear" | Entry | RecordGroup | null;
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
  const [pendingBackup, setPendingBackup] = useState<Store | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editorDate, setEditorDate] = useState(new Date());
  const [reviewKind, setReviewKind] = useState<Kind>("water");
  const [refreshing, setRefreshing] = useState(false);
  const offline = useOfflineApp();
  async function refreshApp() {
    if (!navigator.onLine) {
      setError("当前处于离线状态，请联网后再刷新应用。记录仍保存在本机。");
      return;
    }
    setRefreshing(true);
    try {
      await prepareRefresh();
    } catch {
      setRefreshing(false);
      setError("刷新失败，请联网后再试。本机记录未受影响。");
      return;
    }
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
        goal: undefined as number | null | undefined,
        error:
          "本地记录暂时无法读取，原数据未被覆盖。可前往「我的」清空后重新开始。",
      };
    }
  });
  const [cup, setCup] = useState(initial.cup);
  const [holding, setHolding] = useState(false);
  const [lastDrink, setLastDrink] = useState<string | null>(null);
  const [goal, setGoal] = useState<number | null>(
    initial.goal === undefined ? 2000 : initial.goal,
  );
  const [goalDraft, setGoalDraft] = useState("2000");
  const [goalOff, setGoalOff] = useState(false);
  const [entries, setEntries] = useState(initial.entries),
    [blocked, setBlocked] = useState(Boolean(initial.error)),
    [error, setError] = useState(initial.error);
  const [tab, setTab] = useState<Tab>("today"),
    [sheet, setSheet] = useState<Sheet>(null),
    [amount, setAmount] = useState("250"),
    [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState<{
    text: string;
    undo?: string;
    restore?: Entry[];
  } | null>(null);
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
        setNotice(null);
        setLastDrink(null);
        setGoal(state.goal === undefined ? 2000 : state.goal);
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
    nextGoal: number | null = goal,
  ) {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ entries: next, cup: nextCup, goal: nextGoal }),
      );
      setCup(nextCup);
      setGoal(nextGoal);
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

  function commitProgress(value: number) {
    if (blocked) return;
    const date = new Date();
    setNow(date);
    if (value === cupProgress(state, date)) return;
    const next = updateProgress(state, value, date);
    if (persist(next.entries, `本杯已喝 ${value} ml`, undefined, next.cup)) {
      setLastDrink(next.entries[0]?.id ?? null);
      setNotice(null);
    }
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
    if (next === "goal") {
      setGoalDraft(String(goal ?? 2000));
      setGoalOff(goal === null);
    }
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
    ) {
      setNotice({ text: "记录已删除", restore: [entry] });
      setSheet(null);
    }
  }
  function editEntry(entry: Entry | null) {
    const date = new Date(selectedDate);
    const current = new Date();
    date.setHours(current.getHours(), current.getMinutes(), 0, 0);
    setEditorDate(date > current ? current : date);
    setEditing(entry);
    open("edit");
  }
  function saveEdit(input: Parameters<typeof upsertRecord>[1]) {
    try {
      const next = upsertRecord(state, input);
      if (persist(next, editing ? "记录已修改" : "补记已保存")) setSheet(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "记录无法保存。");
    }
  }
  function exportData() {
    try {
      const url = URL.createObjectURL(
        new Blob([backupText({ entries, cup, goal })], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `water-king-${localInputDate(new Date()).slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice({ text: "备份已生成，请在下载中保存文件。" });
    } catch {
      setError("备份导出失败，请重试。");
    }
  }
  async function importData(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("备份超过 5 MB，无法导入。");
      const next = parseBackup(await file.text());
      setPendingBackup(next);
      open("import");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取备份。");
    }
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
    percent = goal ? Math.min(100, Math.round((stats.water / goal) * 100)) : 0;
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
                ? "长按水杯，或轻点侧边「嘬一口」。"
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
        {offline.available && (
          <div className="update-banner">
            <span>新版本已准备好</span>
            <button
              disabled={holding || refreshing}
              onClick={() => void refreshApp()}
            >
              更新应用
            </button>
          </div>
        )}
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
                <span>
                  {goal
                    ? `目标 ${goal.toLocaleString()} ml · ${percent}%`
                    : "按自己的节奏喝水"}
                </span>
                <div className="daily-track" hidden={goal === null}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              </div>
            </section>
            <section className="cup-tracker">
              <div className="section-heading">
                <h2>我的杯子</h2>
                <span className="capacity-label">{cup.capacity} ml</span>
              </div>
              {lastDrink && entries.some((e) => e.id === lastDrink) && (
                <button
                  className="undo-sip"
                  disabled={blocked || holding}
                  onClick={() => {
                    if (
                      persist(
                        entries.filter((e) => e.id !== lastDrink),
                        "已撤销刚才的喝水",
                      )
                    ) {
                      setLastDrink(null);
                      setNotice(null);
                    }
                  }}
                >
                  撤销刚才的喝水
                </button>
              )}
              <CupControl
                key={`${cup.id}:${dayKey(now)}:${progress}`}
                capacity={cup.capacity}
                progress={progress}
                disabled={blocked}
                onCommit={commitProgress}
                onHolding={setHolding}
              />
              <button
                className="refill"
                disabled={blocked || holding}
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
              <button
                onClick={() => add("small")}
                disabled={blocked || holding}
              >
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
              <div className="history-heading">
                <h1>记录</h1>
                <button disabled={blocked} onClick={() => editEntry(null)}>
                  <Plus size={18} />
                  补记
                </button>
              </div>
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
        {tab === "review" && (
          <>
            <section className="page-heading">
              <p>看看自己的节奏</p>
              <h1>近 7 天</h1>
            </section>
            <div className="editor-types">
              {(["water", "small"] as const).map((k) => (
                <button
                  key={k}
                  aria-pressed={reviewKind === k}
                  onClick={() => setReviewKind(k)}
                >
                  {k === "water" ? "饮水量" : "嘘嘘次数"}
                </button>
              ))}
            </div>
            <section className="week-card">
              <div className="week-head">
                <span>
                  {reviewKind === "water" ? "7 天饮水总量" : "7 天嘘嘘总次数"}
                </span>
                <strong>
                  {weekSummary(entries, now)
                    .reduce((n, d) => n + d[reviewKind], 0)
                    .toLocaleString()}
                  <small>{reviewKind === "water" ? " ml" : " 次"}</small>
                </strong>
              </div>
              <div className="week-chart">
                {weekSummary(entries, now).map((day) => {
                  const maximum = Math.max(
                    1,
                    ...weekSummary(entries, now).map((d) => d[reviewKind]),
                  );
                  return (
                    <button
                      className="week-day"
                      key={day.key}
                      onClick={() => {
                        navigate("history");
                        setSelectedDate(day.date);
                        setFilter(reviewKind);
                      }}
                      aria-label={`${day.date.toLocaleDateString("zh-CN")} ${day[reviewKind]}${reviewKind === "water" ? "毫升" : "次"}，查看记录`}
                    >
                      <span className="week-value">{day[reviewKind]}</span>
                      <span className="week-column">
                        <span
                          style={{
                            height: `${(day[reviewKind] / maximum) * 100}%`,
                          }}
                        />
                      </span>
                      <span>
                        {day.key === dayKey(now)
                          ? "今天"
                          : `${day.date.getMonth() + 1}/${day.date.getDate()}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p>点击一天查看明细 · 未记录不代表没有发生</p>
            </section>
            <div className="review-summary">
              <span>
                <strong>
                  {weekSummary(entries, now).filter((d) => d.hasRecords).length}
                </strong>
                天有记录
              </span>
              <span>
                <strong>
                  {Math.round(
                    weekSummary(entries, now).reduce((n, d) => n + d.water, 0) /
                      7,
                  )}
                </strong>
                ml / 天（按 7 天平均）
              </span>
            </div>
            <p className="settings-note">
              只和自己的节奏相处，不比较、不排名。
              <br />
              这些是估计记录，不用于判断健康状况。
            </p>
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
                className="preference"
                onClick={() => open("water")}
                disabled={blocked}
              >
                <GlassWater />
                <span>
                  <strong>我的杯子</strong>
                  <small>{cup.capacity} ml · 通常只需设置一次</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button
                className="preference"
                onClick={() => open("goal")}
                disabled={blocked}
              >
                <Droplet />
                <span>
                  <strong>每日饮水目标</strong>
                  <small>
                    {goal ? `${goal.toLocaleString()} ml / 天` : "不显示目标"}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
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
              <button
                className="preference"
                disabled={blocked}
                onClick={exportData}
              >
                <Download />
                <span>
                  <strong>导出备份</strong>
                  <small>保存记录、杯子和目标设置</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button
                className="preference"
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                <span>
                  <strong>从备份恢复</strong>
                  <small>确认后替换当前记录和设置</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                aria-label="选择备份文件"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importData(file);
                }}
              />
              <button onClick={() => open("clear")}>
                <Trash2 />
                <span>清空所有记录</span>
                <ChevronRight size={18} />
              </button>
            </section>
            <p className="offline-status">
              <ShieldCheck size={15} />
              {offline.status}
            </p>
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
        <div className="sip-float">
          <button
            className="sip-button"
            disabled={blocked || holding || progress === cup.capacity}
            onClick={() =>
              commitProgress(Math.min(cup.capacity, progress + 10))
            }
          >
            <Droplet size={23} />
            <span>嘬一口</span>
            <span className="quick-amount">
              {progress === cup.capacity
                ? "已喝完"
                : `+${Math.min(10, cup.capacity - progress)} ml`}
            </span>
          </button>
        </div>
      )}
      <nav className="tab-bar" aria-label="底部导航">
        {[
          { id: "today", label: "今天", icon: GlassWater },
          { id: "history", label: "记录", icon: History },
          { id: "review", label: "回顾", icon: BarChart3 },
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
          className={`toast ${tab === "today" ? "cup-toast" : ""}`}
          role="status"
        >
          <Check size={18} />
          <span>{notice.text}</span>
          {notice.restore && (
            <button
              onClick={() => {
                const currentIds = new Set(entries.map((e) => e.id));
                const next = [
                  ...notice.restore!.filter((e) => !currentIds.has(e.id)),
                  ...entries,
                ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
                try {
                  readStore(JSON.stringify({ entries: next, cup, goal }), null);
                  persist(next, "记录已恢复");
                } catch {
                  setError(
                    "当前杯子状态已变化，无法直接撤销。可通过补记恢复。",
                  );
                }
              }}
            >
              撤销删除
            </button>
          )}
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
            sheet === "edit"
              ? editing
                ? "编辑记录"
                : "补记一条"
              : sheet === "import"
                ? "从备份恢复"
                : sheet === "goal"
                  ? "每日饮水目标"
                  : sheet === "water"
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
          {sheet === "edit" ? (
            <EntryEditor
              key={editing?.id ?? "new"}
              entry={editing}
              date={editorDate}
              onSave={saveEdit}
            />
          ) : sheet === "import" && pendingBackup ? (
            <>
              <p className="sheet-description">
                备份包含 {pendingBackup.entries.length} 条记录，杯子容量{" "}
                {pendingBackup.cup.capacity}{" "}
                ml。导入将替换本机的全部记录和设置。
              </p>
              <button
                className="secondary"
                disabled={blocked}
                onClick={exportData}
              >
                先导出当前数据
              </button>
              <button
                className="primary import-confirm"
                onClick={() => {
                  if (
                    persist(
                      pendingBackup.entries,
                      "备份已恢复",
                      undefined,
                      pendingBackup.cup,
                      pendingBackup.goal === undefined
                        ? 2000
                        : pendingBackup.goal,
                    )
                  ) {
                    setSheet(null);
                    setPendingBackup(null);
                    setLastDrink(null);
                  }
                }}
              >
                确认替换并恢复
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setSheet(null);
                  setPendingBackup(null);
                }}
              >
                取消
              </button>
            </>
          ) : sheet === "import" ? null : sheet === "goal" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!goalOff && !validGoal(Number(goalDraft))) {
                  setError("请输入 100–10,000 ml 的整数目标。");
                  return;
                }
                if (
                  persist(
                    entries,
                    "饮水目标已保存",
                    undefined,
                    cup,
                    goalOff ? null : Number(goalDraft),
                  )
                )
                  setSheet(null);
              }}
            >
              <p className="sheet-description">
                按自己的需求设置，保存后用于今天及之后每天。目标只是提醒，不需要勉强完成。
              </p>
              <label className="goal-input">
                每日目标
                <input
                  aria-label="每日饮水目标"
                  type="number"
                  inputMode="numeric"
                  min="100"
                  max="10000"
                  step="1"
                  disabled={goalOff}
                  required={!goalOff}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value)}
                />
                <span>ml</span>
              </label>
              <div className="goal-presets">
                {[1500, 2000, 2500].map((v) => (
                  <button
                    type="button"
                    key={v}
                    disabled={goalOff}
                    aria-pressed={goalDraft === String(v)}
                    onClick={() => setGoalDraft(String(v))}
                  >
                    {v} ml
                  </button>
                ))}
              </div>
              <label className="goal-toggle">
                <input
                  type="checkbox"
                  checked={goalOff}
                  onChange={(e) => setGoalOff(e.target.checked)}
                />
                不显示目标，轻松记录
              </label>
              <button className="primary" disabled={blocked}>
                保存目标
              </button>
            </form>
          ) : sheet === "water" ? (
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
                          aria-label={`编辑 ${entry.amount} ml 饮水明细`}
                          disabled={blocked}
                          onClick={() => editEntry(entry)}
                        >
                          <Pencil size={16} />
                        </button>
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
                        ) {
                          setNotice({
                            text: "这杯水的记录已删除",
                            restore: sheet.members,
                          });
                          setSheet(null);
                        }
                      }
                    }}
                  >
                    <Trash2 size={18} />
                    删除整杯记录
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={() => editEntry(sheet)}
                  >
                    <Pencil size={17} />
                    编辑这条记录
                  </button>
                  <button
                    className="delete-record"
                    disabled={blocked}
                    onClick={() => remove(sheet)}
                  >
                    <Trash2 size={18} />
                    删除这条记录
                  </button>
                </>
              )}
            </>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
