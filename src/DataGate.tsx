import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cloudSyncEnabled, getCloudClient } from "./cloud/client";
import { createSyncTransport } from "./cloud/syncTransport";
import { DataSession, localWriteLock, type DataSnapshot } from "./dataSession";
import { SyncRepository } from "./syncRepository";
import { SyncWorker, type SyncResult } from "./syncWorker";
import { parsePage, type RemoteChange } from "./syncProtocol";
import { newCup } from "./records";
import { guestExpiryMessage, shouldRestoreIdentity } from "./cloud/lifecycle";

export type SyncView = { status: "local" | "pending" | "syncing" | "synced" | "conflict" | "expired" | "error"; message: string };
export type DataAccess = {
  syncEnabled: boolean;
  session: DataSession;
  initial: DataSnapshot;
  sync: SyncView;
  changed: () => void;
  subscribe: (listener: () => void) => () => void;
  synchronize: () => Promise<void>;
  signOut: (expectedAccount: string) => Promise<void>;
  connect: (preview: DataSnapshot, importLocal: boolean, expectedAccount: string, signal?: AbortSignal) => Promise<void>;
};

export function DataGate({ children }: { children: (access: DataAccess) => ReactNode }) {
  const [setup] = useState(() => {
    try { return { client: getCloudClient(), error: "" }; }
    catch { return { client: null, error: "账号配置有误；本机记录仍可使用。" }; }
  });
  const [selected, setSelected] = useState<{ session: DataSession; initial: DataSnapshot } | null>(null);
  const [error, setError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [sync, setSync] = useState<SyncView>({ status: "local", message: "记录仅保存在本机" });
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const owner = useRef<string | null>(null);
  const offlineView = useRef<string | null>(null);
  const db = useRef<Promise<SyncRepository | null>>(Promise.resolve(null));
  const worker = useRef<SyncWorker | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const listeners = useRef(new Set<() => void>());
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const writeEpoch = useRef(0);
  const signingOut = useRef(false);
  const synchronizing = useRef(false);

  const notify = useCallback(() => { for (const callback of listeners.current) callback(); }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener); return () => { listeners.current.delete(listener); };
  }, []);
  const publish = useCallback((kind: "write" | "sync" | "activate" = "write") => {
    channel.current?.postMessage({ owner: selectedRef.current?.session.owner, kind });
  }, []);
  const synchronize = useCallback(async () => {
    const current = selectedRef.current;
    if (synchronizing.current || signingOut.current || !cloudSyncEnabled || !current || current.session.owner === "local" || !worker.current) return;
    if (syncRef.current.status === "conflict" || syncRef.current.status === "expired") return;
    const account = current.session.owner;
    const startedAt = writeEpoch.current;
    if (owner.current !== account || !navigator.onLine) {
      setSync({ status: "pending", message: owner.current !== account
        ? "身份尚未恢复，记录仅保存在本机。请先导出备份，再登录或创建新游客。"
        : "记录已保存在本机，联网后可同步" }); return;
    }
    synchronizing.current = true;
    let continueSync = false;
    setSync({ status: "syncing", message: "正在同步…本机仍可记录" });
    try {
      await createSyncTransport(setup.client!).status(account,new AbortController().signal);
      if(signingOut.current || selectedRef.current?.session!==current.session || owner.current!==account) return;
      const repository = await db.current;
      const cursorBefore = (await repository?.load(account))?.cursor;
      const result: SyncResult = await worker.current.run(account);
      if (selectedRef.current?.session !== current.session || owner.current !== account) return;
      if (result.status === "conflict") setSync({ status: "conflict", message: "发现不同版本，已暂停同步并保留本机改动。可先导出备份；不会自动覆盖任何一方。" });
      else if (result.status === "synced" && startedAt === writeEpoch.current) setSync({ status: "synced", message: "记录已同步" });
      else {
        const remaining = (await repository?.pending(account))?.length ?? 0;
        const cursorAfter = (await repository?.load(account))?.cursor;
        if (selectedRef.current?.session !== current.session || owner.current !== account) return;
        continueSync = result.status !== "stopped" && (result.uploaded > 0 || cursorAfter !== cursorBefore
          || (result.status === "synced" && startedAt !== writeEpoch.current));
        setSync({ status: "pending", message: remaining
          ? `记录已保存在本机，仍有 ${remaining} 项改动${continueSync ? "，正在继续同步…" : "等待同步"}`
          : continueSync ? "正在继续获取云端记录…" : "同步已暂停，可稍后重试" });
      }
    } catch (cause) {
      if (selectedRef.current?.session === current.session)
        setSync(guestExpiryMessage(cause) ? {status:"expired",message:guestExpiryMessage(cause)!}
          : { status: "error", message: "同步未完成，本机改动已保留。请联网后重试。" });
    } finally {
      synchronizing.current = false;
      if (selectedRef.current?.session === current.session) { notify(); publish("sync"); }
      const next = selectedRef.current;
      if (!signingOut.current && next && owner.current === next.session.owner && next.session.owner !== "local"
        && (continueSync || next.session !== current.session)) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { if (!document.hidden && navigator.onLine) void synchronizeRef.current(); }, 300);
      }
    }
  }, [notify, publish, setup]);
  const synchronizeRef = useRef(synchronize);
  synchronizeRef.current = synchronize;
  const changed = useCallback(() => {
    writeEpoch.current++;
    publish();
    if (cloudSyncEnabled && selectedRef.current?.session.owner !== "local") {
      if (syncRef.current.status === "conflict" || syncRef.current.status === "expired") return;
      setSync({ status: "pending", message: "记录已保存在本机，等待同步" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void synchronizeRef.current(), 600);
    }
  }, [publish]);

  useEffect(() => {
    let disposed = false;
    const client = setup.client;
    db.current = SyncRepository.open().catch(() => null);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("water-king.data.v1");
      channel.current.onmessage = (event) => {
        if (event.data?.owner === owner.current && selectedRef.current?.session.owner === "local") void select(owner.current);
        if (event.data?.owner === selectedRef.current?.session.owner) {
          if (event.data?.kind === "write" && selectedRef.current?.session.owner !== "local") {
            writeEpoch.current++;
            if (syncRef.current.status !== "conflict" && syncRef.current.status !== "expired")
              setSync({ status: "pending", message: "其他页面的数据已更新，可同步查看最新状态" });
          }
          notify();
        }
      };
    }
    const select = async (account: string | null, cached = false) => {
      const epoch = ++generation.current;
      const previous = selectedRef.current;
      if (previous && previous.session.owner !== "local" && previous.session.owner !== account) {
        previous.session.invalidate(); worker.current?.cancel(); selectedRef.current = null; setSelected(null);
      }
      try {
        const repository = await db.current;
        const saved = repository && account ? await repository.load(account) : null;
        const target = saved ? account! : "local";
        if (disposed || epoch !== generation.current) return;
        if (!cached && account && repository) await repository.rememberOwner(target);
        if (disposed || epoch !== generation.current) return;
        if (selectedRef.current?.session.owner === target) {
          if (cached && target !== "local") setSync({ status: "pending", message: "身份尚未恢复，记录仅保存在本机。请先导出备份，再登录或创建新游客。" });
          if (!cached && target !== "local" && syncRef.current.status !== "conflict" && syncRef.current.status !== "expired") {
            setSync({ status: "pending", message: cloudSyncEnabled ? "身份已恢复，等待同步" : "账号记录已在本机恢复，云同步暂未开放" });
            if (navigator.onLine && !document.hidden) void synchronizeRef.current();
          }
          return;
        }
        const session = new DataSession(target, repository, () => target === "local" || owner.current === target
          || (owner.current === null && offlineView.current === target));
        const initial = await session.read();
        if (disposed || epoch !== generation.current) return;
        selectedRef.current?.session.invalidate();
        selectedRef.current = { session, initial };
        setSelected({ session, initial });
        setSync({ status: target === "local" ? "local" : "pending", message: target === "local" ? "记录仅保存在本机" : "本机记录已恢复，等待同步" });
        setError("");
        if (!cloudSyncEnabled && target !== "local") setSync({ status: "pending", message: "账号记录已在本机恢复，云同步暂未开放" });
        if (cached && target !== "local") setSync({ status: "pending", message: "身份尚未恢复，记录仅保存在本机。请先导出备份，再登录或创建新游客。" });
        if (!cached && cloudSyncEnabled && target !== "local" && navigator.onLine) void synchronizeRef.current();
      } catch { if (!disposed && epoch === generation.current) setError("记录暂时无法读取，请重试。已有数据未被替换。"); }
    };
    const recoverCached = async () => {
      try {
        const repository = await db.current;
        if (disposed || owner.current !== null) return;
        if (localStorage.getItem("water-king.signed-out.v1") === "true") {
          offlineView.current = null; await select(null); return;
        }
        const cached = await repository?.lastOwner();
        if (disposed || owner.current !== null) return;
        const previous = selectedRef.current?.session.owner;
        const candidate = previous && previous !== "local" ? previous : cached;
        offlineView.current = candidate ?? null;
        await select(candidate ?? null,true);
      } catch {
        if (!disposed) setError("账号本机记录暂时无法读取，请重新打开。已有数据未被替换。");
      }
    };
    void recoverCached();
    let unsubscribe = () => {};
    let sawAuthEvent = false;
    if (client) {
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        sawAuthEvent = true;
        const next = session?.user.id ?? null;
        const previous=owner.current;
        owner.current = next;
        // Token refresh alone is not user activity and must not renew a guest.
        if(!shouldRestoreIdentity(previous,next,_event)) return;
        if (next) { setAuthNotice(""); localStorage.removeItem("water-king.signed-out.v1"); offlineView.current = null; void select(next); }
        else if (_event === "SIGNED_OUT" && (localStorage.getItem("water-king.logout-intent.v1")
          || localStorage.getItem("water-king.signed-out.v1") === "true")) {
          localStorage.setItem("water-king.signed-out.v1", "true");
          offlineView.current = null; worker.current?.cancel(); clearTimeout(timer.current);
          void select(null);
        } else { worker.current?.cancel(); void recoverCached(); }
      });
      unsubscribe = () => subscription.unsubscribe();
      // A storage/refresh error must still leave the original local mode usable.
      void client.auth.getSession().then(({ data, error: authError }) => {
        if (disposed) return;
        if (sawAuthEvent) return;
        if (!authError && data.session) { owner.current = data.session.user.id; offlineView.current = null; void select(owner.current); }
        else void recoverCached();
      }).catch(() => { if (!disposed) void recoverCached(); });
    }
    const wake = () => { if (!document.hidden) void synchronizeRef.current(); };
    const storage = (event: StorageEvent) => {
      if (event.key === "water-king.data-owner.v1" && event.newValue === owner.current) void select(owner.current);
      if (selectedRef.current?.session.owner === "local" && (event.key === "water-king.state.v2" || event.key === null)) notify();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("storage", storage);
    return () => {
      disposed = true; generation.current++; unsubscribe(); worker.current?.cancel(); clearTimeout(timer.current);
      channel.current?.close(); channel.current = null;
      window.removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); window.removeEventListener("storage", storage);
      void db.current.then(repository => repository?.close());
    };
  }, [setup, notify]);

  useEffect(() => {
    void db.current.then(repository => {
      if (cloudSyncEnabled && repository && setup.client && !worker.current)
        worker.current = new SyncWorker(repository, createSyncTransport(setup.client), () => owner.current);
    });
  }, [setup, selected]);

  async function signOut(expectedAccount: string) {
    if (!setup.client || signingOut.current) throw Error("账号服务暂时不可用");
    signingOut.current = true;
    worker.current?.cancel(); clearTimeout(timer.current);
    try {
      const { data, error } = await setup.client.auth.getSession();
      if (error) throw error;
      if (data.session?.user.id !== expectedAccount) throw Error("账号已变化，请重新操作");
      const intent = crypto.randomUUID();
      localStorage.setItem("water-king.logout-intent.v1", intent);
      try {
        const result = await setup.client.auth.signOut({ scope: "local" });
        if (result.error) {
          const remaining = await setup.client.auth.getSession();
          if (remaining.data.session) throw result.error;
          setAuthNotice("已退出此浏览器，但服务端会话撤销尚未确认。账号数据已保留；请勿在共用设备保留浏览器数据。");
        }
      } finally {
        if (localStorage.getItem("water-king.logout-intent.v1") === intent)
          localStorage.removeItem("water-king.logout-intent.v1");
      }
    } finally { signingOut.current = false; }
  }

  async function connect(preview: DataSnapshot, importLocal: boolean, expectedAccount: string, cancellation?: AbortSignal) {
    if (signingOut.current) throw Error("正在退出账号，请稍后重试");
    if (!cloudSyncEnabled) throw Error("当前构建已关闭云同步，本机记录不受影响");
    const account = owner.current;
    const source = selectedRef.current;
    const repository = await db.current;
    if (account !== expectedAccount) throw Error("账号已变化，请重新查看同步范围");
    if (!setup.client || !repository || !account || source?.session.owner !== "local") throw Error("账号或本机存储未准备好");
    if (!navigator.locks) throw Error("当前浏览器暂不支持安全切换；本机记录可继续使用。");
    if (preview.error) throw Error("请先处理本机数据读取问题");
    const transport = createSyncTransport(setup.client);
    const changes: RemoteChange[] = [];
    let cursor = "0";
    const signal = cancellation ? AbortSignal.any([cancellation, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
    try { await transport.status(account,signal); }
    catch(cause) { throw new Error(guestExpiryMessage(cause) ?? "账号状态暂时无法验证，尚未切换或上传。"); }
    for (;;) {
      signal.throwIfAborted();
      if (owner.current !== account) throw Error("账号已变化，请重新确认");
      const page = parsePage(await transport.pull(account, cursor, signal), cursor);
      changes.push(...page.changes); cursor = page.cursor;
      if (!page.hasMore) break;
    }
    await localWriteLock(async () => {
      signal.throwIfAborted();
      if (owner.current !== account || selectedRef.current?.session !== source.session) throw Error("账号已变化，请重新确认");
      const current = await source.session.read();
      if (current.version !== preview.version || current.error) throw Error("本机数据已变化，请重新查看导入范围");
      await repository.initializeAccount(account, { entries: [], cup: newCup(current.state.cup.capacity) }, changes, cursor,
        importLocal ? current.state : null);
      localStorage.setItem("water-king.data-owner.v1", account);
    });
    const session = new DataSession(account, repository, () => owner.current === account
      || (owner.current === null && offlineView.current === account));
    const initial = await session.read();
    if (owner.current !== account) throw Error("账号已变化，数据已单独保留，请重新打开");
    source.session.invalidate();
    selectedRef.current = { session, initial }; setSelected({ session, initial });
    setSync({ status: "pending", message: "数据已在本机准备好，等待同步" });
    publish("activate");
    void synchronizeRef.current();
  }
  if (!selected) return <main className="app"><p role="status">{error || "正在读取本机记录…"}</p>
    {error && <button onClick={() => window.location.reload()}>重新打开</button>}</main>;
  return <>{authNotice && <p role="alert">{authNotice}</p>}{setup.error && <p role="alert">{setup.error}</p>}{children({ ...selected, syncEnabled: cloudSyncEnabled, sync, changed,
    subscribe,
    synchronize, signOut, connect })}</>;
}
