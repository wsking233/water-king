import { useEffect, useRef, useState } from "react";
import { appBuild, appVersion } from "./build";
import { releases } from "./releases";

export function AboutApp({ close, refresh, disabled }: { close: () => void; refresh: () => void; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [newer, setNewer] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current!.showModal();
    return () => { controller.current?.abort(); dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="about-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="sheet-handle" /><h2 id="about-title">关于水王</h2>
    <p className="release-version">v{appVersion}</p><p className="sheet-description">当前安装版本 · {releases[0].date}</p>
    <h3>{releases[0].title}</h3>
    <ul className="release-notes">{releases[0].changes.map(item => <li key={item}>{item}</li>)}</ul>
    <details><summary>版本诊断信息</summary><p className="sheet-description">构建：{appBuild}</p></details>
    {status && <p role="status" className="sheet-description">{status}</p>}
    <button className="primary" disabled={checking || disabled} onClick={async () => {
      if (checking) return;
      setChecking(true); setStatus("");
      controller.current = new AbortController();
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}version.json?_=${Date.now()}`, { cache: "no-store", signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw Error("unavailable");
        const latest = await response.json();
        if (typeof latest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(latest.version) || typeof latest.build !== "string") throw Error("invalid release");
        const available = latest.version !== appVersion || latest.build !== appBuild;
        setNewer(available); setStatus(available ? `发现可用更新 v${latest.version}，应用更新后保留本机记录。` : `当前已是最新版本 v${appVersion}`);
      } catch { if (!controller.current.signal.aborted) setStatus("暂时无法检查更新，请联网后重试。当前记录不受影响。"); }
      finally { if (!controller.current.signal.aborted) setChecking(false); }
    }}>{checking ? "正在检查…" : "检查更新"}</button>
    {newer && <button className="primary" disabled={disabled} onClick={refresh}>应用更新</button>}
    <button className="secondary" onClick={close} autoFocus>关闭</button>
  </dialog>;
}
