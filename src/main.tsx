import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Droplet,
  Waves,
  Plus,
  ArrowUpRight,
  History,
  Trophy,
  X,
  Trash2,
  RotateCcw,
  Check,
  GlassWater,
  Sprout,
  ShieldCheck,
} from "lucide-react";
import {
  KEY,
  parseEntries,
  todayEntries,
  totals,
  validAmount,
  type Entry,
  type Kind,
} from "./records";
import "./style.css";
const labels = { water: "饮水", small: "小便", large: "大便" };
function App() {
  const [initial] = useState(() => {
    try {
      return { entries: parseEntries(localStorage.getItem(KEY)), error: "" };
    } catch {
      return {
        entries: [] as Entry[],
        error: "无法读取本地记录。原数据尚未覆盖，请清空数据后重试。",
      };
    }
  });
  const [entries, setEntries] = useState(initial.entries);
  const [blocked, setBlocked] = useState(Boolean(initial.error));
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("today");
  const [amount, setAmount] = useState("250");
  const [now, setNow] = useState(new Date());
  const [clear, setClear] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key !== KEY && e.key !== null) return;
      try {
        setEntries(parseEntries(localStorage.getItem(KEY)));
        setBlocked(false);
        setError("");
      } catch {
        setBlocked(true);
        setError("本地记录发生异常，请清空后重试。");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  function persist(next: Entry[], message: string) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setEntries(next);
      setError("");
      setNotice(message);
      setBlocked(false);
      return true;
    } catch {
      setError(
        "保存失败：浏览器存储不可用或空间不足。本次操作未保存，请重试。",
      );
      return false;
    }
  }
  function add(kind: Kind) {
    if (blocked) return;
    if (kind === "water" && !validAmount(Number(amount))) {
      setError("请输入 1–5000 ml 的整数饮水量。");
      return;
    }
    const date = new Date();
    setNow(date);
    persist(
      [
        {
          id: crypto.randomUUID(),
          kind,
          amount: kind === "water" ? Number(amount) : 1,
          at: date.toISOString(),
        },
        ...entries,
      ],
      `已记录${labels[kind]}${kind === "water" ? ` ${amount} ml` : " 1 次"}`,
    );
  }
  const today = todayEntries(entries, now),
    stats = totals(today),
    percent = Math.min(100, Math.round((stats.water / 2000) * 100));
  const shown = tab === "history" ? entries : today;
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("today");
          }}
        >
          <span className="brand-icon">
            <Waves />
          </span>
          <span>
            大水之王<small>WATER KING</small>
          </span>
        </a>
        <div className="nav-label">我的日常</div>
        <nav aria-label="主导航">
          {[
            ["today", "今日概览", GlassWater],
            ["history", "全部记录", History],
            ["rank", "排行榜", Trophy],
          ].map(([id, label, Icon]) => {
            const I = Icon as typeof GlassWater;
            return (
              <button
                key={String(id)}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(String(id))}
              >
                <I size={19} />
                {String(label)}
                {id === "rank" && <span className="demo">演示</span>}
              </button>
            );
          })}
        </nav>
        <div className="side-note">
          <Sprout size={25} />
          <strong>小小记录，慢慢养成。</strong>
          <p>照顾自己，从每一口水开始。</p>
          <span>LOCAL FIRST · V0.1</span>
        </div>
        <button className="clear-link" onClick={() => setClear(true)}>
          <Trash2 size={15} /> 清空本地数据
        </button>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            我的日常 <span>/</span>{" "}
            {tab === "today"
              ? "今日概览"
              : tab === "history"
                ? "全部记录"
                : "排行榜"}
          </div>
          <span className="local-badge">
            <span /> 单机体验版
          </span>
        </header>
        <div className="content">
          <section className="page-title">
            <div>
              <div className="eyebrow">MAKE EVERY SIP COUNT</div>
              <h1>
                {tab === "today"
                  ? "每一口，都算数。"
                  : tab === "history"
                    ? "你的日常，有迹可循。"
                    : "一起养成好习惯。"}
              </h1>
              <p>
                {tab === "today"
                  ? "喝口水，放松一下。今天也要好好照顾自己。"
                  : tab === "history"
                    ? "记录那些微小、却值得留意的日常。"
                    : "这里展示榜单的交互样式，所有排名均为模拟数据。"}
              </p>
            </div>
            <div className="date">
              {now.toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
              })}
              <span>
                {now.toLocaleDateString("zh-CN", { weekday: "long" })}
              </span>
            </div>
          </section>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {tab === "today" && (
            <>
              <section className="overview">
                <article className="water-card">
                  <div className="card-top">
                    <span>
                      <Droplet size={18} /> 今日饮水
                    </span>
                    <span className="pill">一点一滴，积少成多</span>
                  </div>
                  <div className="water-body">
                    <div>
                      <div className="big-number">
                        {stats.water.toLocaleString()}
                        <span> ml</span>
                      </div>
                      <p>
                        参考目标 <strong>2,000 ml</strong>
                      </p>
                      <div className="progress-label">
                        <span>
                          {percent >= 100
                            ? "今日参考目标已达成"
                            : "今天的饮水进度"}
                        </span>
                        <b>{percent}%</b>
                      </div>
                      <div
                        className="progress"
                        role="progressbar"
                        aria-label="饮水进度"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                    <div className="glass-art" aria-hidden="true">
                      <div className="glass">
                        <div
                          className="liquid"
                          style={{ height: `${Math.max(12, percent)}%` }}
                        >
                          <span />
                          <span />
                          <span />
                        </div>
                        <Droplet size={30} />
                      </div>
                      <span>STAY HYDRATED</span>
                    </div>
                  </div>
                  <div className="water-footer">
                    <Sprout size={15} />{" "}
                    按自己的身体需求饮水，参考目标不是医疗建议。
                  </div>
                </article>
                <div className="bathroom-stats">
                  <article className="stat-card">
                    <span className="stat-icon mint">
                      <Waves size={20} />
                    </span>
                    <span>今日小便</span>
                    <div>
                      <strong>{stats.small}</strong> 次
                    </div>
                    <small>顺其自然，轻松记录</small>
                  </article>
                  <article className="stat-card">
                    <span className="stat-icon peach">
                      <Sprout size={20} />
                    </span>
                    <span>今日大便</span>
                    <div>
                      <strong>{stats.large}</strong> 次
                    </div>
                    <small>关注身体的日常节奏</small>
                  </article>
                </div>
              </section>
              <section className="quick-section">
                <div className="section-title">
                  <h2>记一笔</h2>
                  <span>留意身体，只需一瞬间</span>
                </div>
                <div className="quick-grid">
                  <form
                    className="add-water"
                    onSubmit={(e) => {
                      e.preventDefault();
                      add("water");
                    }}
                  >
                    <div className="quick-heading">
                      <GlassWater size={21} />
                      <strong>喝水啦</strong>
                      <span>补充一点能量</span>
                    </div>
                    <div className="amounts">
                      {[150, 250, 500].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={amount === String(v) ? "selected" : ""}
                          onClick={() => setAmount(String(v))}
                        >
                          {v} ml
                        </button>
                      ))}
                      <label>
                        <input
                          aria-label="自定义饮水量"
                          type="number"
                          min="1"
                          max="5000"
                          step="1"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                        <span>ml</span>
                      </label>
                    </div>
                    <button className="primary" disabled={blocked}>
                      <Plus size={18} /> 记录饮水
                    </button>
                  </form>
                  <button
                    className="quick-bath"
                    disabled={blocked}
                    onClick={() => add("small")}
                  >
                    <span className="stat-icon mint">
                      <Waves />
                    </span>
                    <strong>小便一次</strong>
                    <span>给身体一点轻松</span>
                    <span className="round-plus">
                      <Plus size={20} />
                    </span>
                  </button>
                  <button
                    className="quick-bath"
                    disabled={blocked}
                    onClick={() => add("large")}
                  >
                    <span className="stat-icon peach">
                      <Sprout />
                    </span>
                    <strong>大便一次</strong>
                    <span>记录日常好状态</span>
                    <span className="round-plus">
                      <Plus size={20} />
                    </span>
                  </button>
                </div>
              </section>
            </>
          )}
          {tab !== "rank" ? (
            <section className="records-section">
              <div className="section-title">
                <h2>
                  {tab === "history" ? "全部记录" : "今日记录"}{" "}
                  <span className="count">{shown.length}</span>
                </h2>
                {tab === "today" && (
                  <button
                    className="text-button"
                    onClick={() => setTab("history")}
                  >
                    查看全部 <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
              <div className="record-list">
                {shown.length === 0 ? (
                  <div className="empty">
                    <span>
                      <GlassWater size={27} />
                    </span>
                    <h3>
                      {tab === "today"
                        ? "今天的第一笔，从现在开始"
                        : "还没有记录"}
                    </h3>
                    <p>
                      {tab === "today"
                        ? "喝一口水，再轻轻点一下「记录饮水」。"
                        : "回到今日概览，记录你的第一口水。"}
                    </p>
                    {tab === "history" && (
                      <button
                        className="text-button"
                        onClick={() => setTab("today")}
                      >
                        去记一笔 <ArrowUpRight size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  shown.map((e) => (
                    <div className="record" key={e.id}>
                      <span
                        className={`stat-icon ${e.kind === "water" ? "blue" : e.kind === "small" ? "mint" : "peach"}`}
                      >
                        {e.kind === "water" ? (
                          <Droplet size={18} />
                        ) : e.kind === "small" ? (
                          <Waves size={18} />
                        ) : (
                          <Sprout size={18} />
                        )}
                      </span>
                      <div>
                        <strong>{labels[e.kind]}</strong>
                        <small>
                          {new Date(e.at).toLocaleString(
                            "zh-CN",
                            tab === "history"
                              ? {
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              : { hour: "2-digit", minute: "2-digit" },
                          )}
                        </small>
                      </div>
                      <b>
                        {e.amount}{" "}
                        <small>{e.kind === "water" ? "ml" : "次"}</small>
                      </b>
                      <button
                        className="undo"
                        aria-label={`撤销${labels[e.kind]}记录`}
                        disabled={blocked}
                        onClick={() =>
                          persist(
                            entries.filter((r) => r.id !== e.id),
                            "已撤销记录",
                          )
                        }
                      >
                        <RotateCcw size={15} />
                        <span>撤销</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : (
            <section className="ranking">
              <div className="rank-banner">
                <Trophy size={30} />
                <div>
                  <h2>本周习惯榜</h2>
                  <p>演示数据 · 按记录天数排序 · 不连接真实用户</p>
                </div>
              </div>
              {[
                ["小水滴", 7],
                ["慢慢来", 6],
                ["早睡的鱼", 5],
              ].map(([name, days], i) => (
                <div className="rank-row" key={name}>
                  <b>0{i + 1}</b>
                  <span>{name}</span>
                  <strong>
                    {days} <small>天</small>
                  </strong>
                </div>
              ))}
              <p className="rank-note">
                你的本地记录不会上传，也不会参与此榜单排名。
              </p>
            </section>
          )}
          <footer>
            <span>
              <ShieldCheck size={15} /> 数据只保存在当前浏览器
            </span>
            <span>
              保持一点点好习惯 <Waves size={16} />
            </span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {clear && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setClear(false);
              if (e.key === "Tab") {
                const buttons = e.currentTarget.querySelectorAll("button");
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="clear-title">清空全部本地记录？</h2>
            <p>饮水和如厕记录都会被删除，无法恢复。</p>
            <div>
              <button autoFocus onClick={() => setClear(false)}>
                取消
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (persist([], "本地记录已清空")) setClear(false);
                }}
              >
                确认清空
              </button>
            </div>
            <button
              className="close"
              aria-label="关闭"
              onClick={() => setClear(false)}
            >
              <X size={19} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
