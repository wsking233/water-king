import type { Mutation, SyncRepository } from "./syncRepository.ts";
import { parsePage, parseReply, type Conflict } from "./syncProtocol.ts";

export interface SyncTransport {
  apply(owner: string, mutation: Mutation, signal: AbortSignal): Promise<unknown>;
  pull(owner: string, after: string, signal: AbortSignal): Promise<unknown>;
}
export type SyncResult =
  | { status: "synced" | "pending" | "stopped"; uploaded: number }
  | { status: "conflict"; uploaded: number; mutation: Mutation; conflict: Conflict };

/** Explicitly invoked, never an unbounded background heartbeat. No UI data migration. */
export class SyncWorker {
  private active: { owner: string; controller: AbortController; promise: Promise<SyncResult> } | null = null;
  private readonly repository: SyncRepository;
  private readonly transport: SyncTransport;
  private readonly currentOwner: () => string | null;
  constructor(repository: SyncRepository, transport: SyncTransport, currentOwner: () => string | null) {
    this.repository = repository;
    this.transport = transport;
    this.currentOwner = currentOwner;
  }
  cancel() { this.active?.controller.abort(); }
  run(owner: string): Promise<SyncResult> {
    if (!owner || owner === "local") return Promise.reject(Error("请选择有效的同步账号"));
    if (this.active?.owner === owner && !this.active.controller.signal.aborted) return this.active.promise;
    this.cancel();
    const controller = new AbortController();
    const task = { owner, controller, promise: Promise.resolve(null as unknown as SyncResult) };
    const execute = async (): Promise<SyncResult> => {
      try {
        if (typeof navigator !== "undefined" && navigator.locks)
          return await navigator.locks.request(`water-king.sync:${owner}`, { signal: controller.signal },
            () => this.synchronize(owner, controller.signal));
        return await this.synchronize(owner, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || this.currentOwner() !== owner) return { status: "stopped", uploaded: 0 };
        throw error;
      }
    };
    task.promise = execute().finally(() => {
      if (this.active === task) this.active = null;
    });
    this.active = task;
    return task.promise;
  }
  private async synchronize(owner: string, signal: AbortSignal): Promise<SyncResult> {
    let uploaded = 0;
    const stopped = () => signal.aborted || this.currentOwner() !== owner;
    const stop = (): SyncResult => ({ status: "stopped", uploaded });
    if (stopped()) return stop();
    if (!await this.repository.load(owner)) throw Error("尚未确认此账号的本机数据处理范围");
    // Bound each pass so continuous local activity cannot keep it alive forever.
    for (let sent = 0; sent < 200; sent++) {
      if (stopped()) return stop();
      const mutation = (await this.repository.pending(owner))[0];
      if (!mutation) break;
      if (stopped()) return stop();
      let raw: unknown;
      try { raw = await this.transport.apply(owner, mutation, signal); }
      catch (error) { if (stopped()) return stop(); throw error; }
      if (stopped()) return stop();
      const reply = parseReply(raw, mutation.mutationId, mutation.expectedRevision);
      if (reply.status === "conflict") {
        if (reply.current && (reply.current.entity !== mutation.entity || reply.current.entityId !== mutation.entityId))
          throw Error("同步冲突实体不匹配");
        return { status: "conflict", uploaded, mutation, conflict: reply };
      }
      await this.repository.acknowledge(owner, mutation.sequence, mutation.mutationId, reply.revision);
      uploaded++;
    }
    if (stopped()) return stop();
    if ((await this.repository.pending(owner)).length) return { status: "pending", uploaded };
    for (let pages = 0; pages < 50; pages++) {
      if (stopped()) return stop();
      const snapshot = await this.repository.load(owner);
      if (!snapshot) throw Error("同步快照不存在");
      let raw: unknown;
      try { raw = await this.transport.pull(owner, snapshot.cursor ?? "0", signal); }
      catch (error) { if (stopped()) return stop(); throw error; }
      if (stopped()) return stop();
      const page = parsePage(raw, snapshot.cursor ?? "0");
      await this.repository.applyPage(owner, page, snapshot.cursor);
      if (stopped()) return stop();
      if (!page.hasMore) return {
        status: (await this.repository.pending(owner)).length ? "pending" : "synced", uploaded,
      };
    }
    return { status: "pending", uploaded };
  }
}
