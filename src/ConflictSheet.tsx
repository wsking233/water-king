import { useEffect, useRef, useState } from "react";
import type { DataAccess } from "./DataGate";
import type { DataSnapshot } from "./dataSession";
import type { EntityValue } from "./syncProtocol";
function describe(value: EntityValue) {
  if (value === null) return "此记录已删除或不存在";
  if ("kind" in value) return `${value.kind === "water" ? `饮水 ${value.amount} ml` : "嘘嘘 1 次"} · ${new Date(value.at).toLocaleString("zh-CN", {hour12:false})}`;
  if ("goal" in value) return value.goal === null ? "不显示每日目标" : `每日目标 ${value.goal} ml`;
  return `杯子容量 ${value.capacity} ml`;
}
export function ConflictSheet({ access, preview, close }: { access: DataAccess; preview: DataSnapshot; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  useEffect(() => {
    const previous=document.activeElement as HTMLElement, overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.current!.showModal();
    return ()=>{dialog.current?.close();document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  const conflict=access.conflict!;
  const {entity,entityId}=conflict.mutation;
  const local: EntityValue=entity==="record" ? preview.state.entries.find(item=>item.id===entityId)??null
    : entity==="settings" ? {goal:preview.state.goal??null} : preview.state.cup;
  async function choose(choice:"local"|"remote") {
    if(running.current)return;
    running.current=true;setWorking(true);setError("");
    try{await access.resolveConflict(choice,preview);close();}
    catch(cause){setError(cause instanceof Error?cause.message:"选择未保存，请重试。");setWorking(false);running.current=false;}
  }
  return <dialog ref={dialog} className="sheet" aria-labelledby="conflict-title" onCancel={e=>{e.preventDefault();if(!working)close();}}>
    <div className="sheet-handle"/><h2 id="conflict-title">选择保留的内容</h2>
    <p className="sheet-description">同一项内容在不同设备发生了变化。请比较后选择；此选择仅处理当前项，其他冲突会逐项显示。</p>
    <div className="conflict-option"><h3>本机内容</h3><p>{describe(local)}</p><button className="primary" disabled={working} onClick={()=>void choose("local")}>保留本机内容</button></div>
    <div className="conflict-option"><h3>云端内容</h3><p>{describe(conflict.current?.value??null)}</p><button className="secondary" disabled={working||(!conflict.current&&entity!=="record")} onClick={()=>void choose("remote")}>使用云端内容</button></div>
    <p className="sheet-description">保留本机会在同步确认后更新云端；使用云端会替换这一项的本机改动。选择前可关闭弹层并导出备份。云端再次变化时会重新提示。</p>
    {error&&<p className="account-error" role="alert">{error}</p>}
    <button className="secondary" disabled={working} autoFocus onClick={close}>稍后处理</button>
  </dialog>;
}
