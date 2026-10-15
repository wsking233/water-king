import { parseEntries, readStore, validGoal, type Entry, type Cup } from "./records.ts";

export type EntityKind = "record" | "settings" | "cup";
export type EntityValue = Entry | Cup | { goal: number | null } | null;
export type RemoteChange = {
  entity: EntityKind;
  entityId: string;
  revision: number;
  cursor: string;
  value: EntityValue;
};
export type ChangePage = { changes: RemoteChange[]; cursor: string; hasMore: boolean };
export type Applied = { status: "applied"; mutationId: string; revision: number; cursor: string };
export type Conflict = { status: "conflict"; mutationId: string; current: RemoteChange | null };

export function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    && value.length <= 19 && BigInt(value) <= 9223372036854775807n;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("同步响应格式异常");
  return value as Record<string, unknown>;
}
export function parseChange(input: unknown): RemoteChange {
  const row = object(input);
  if (!["record", "settings", "cup"].includes(String(row.entity))
    || typeof row.entityId !== "string" || row.entityId.length > 256
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || !validCursor(row.cursor) || row.cursor === "0") throw Error("同步变更版本异常");
  if (row.value === null) {
    if (row.entity !== "record") throw Error("非记录数据不能删除");
  } else {
    const value = object(row.value);
    if (row.entity === "record") {
      const entries = parseEntries(JSON.stringify([value]));
      if (entries.length !== 1 || entries[0].id !== row.entityId) throw Error("同步记录标识异常");
    } else if (row.entity === "settings") {
      if (row.entityId !== "settings" || (value.goal !== null && !validGoal(Number(value.goal)))
        || (value.goal !== null && typeof value.goal !== "number")) throw Error("同步目标异常");
    } else readStore(JSON.stringify({ entries: [], cup: value }), null);
  }
  return structuredClone(row) as RemoteChange;
}
export function parsePage(input: unknown, after: string): ChangePage {
  if (!validCursor(after)) throw Error("本地同步游标异常");
  const page = object(input);
  if (!Array.isArray(page.changes) || page.changes.length > 500 || !validCursor(page.cursor)
    || typeof page.hasMore !== "boolean" || BigInt(page.cursor) < BigInt(after)) throw Error("同步分页异常");
  const changes = page.changes.map(parseChange);
  let previous = BigInt(after);
  for (const change of changes) {
    const cursor = BigInt(change.cursor);
    if (cursor <= previous || cursor > BigInt(page.cursor)) throw Error("同步游标顺序异常");
    previous = cursor;
  }
  if ((changes.length && changes.at(-1)!.cursor !== page.cursor)
    || (page.hasMore && (!changes.length || page.cursor === after))) throw Error("同步分页未前进");
  return { changes, cursor: page.cursor, hasMore: page.hasMore };
}
export function parseReply(input: unknown, mutationId: string, expectedRevision: number): Applied | Conflict {
  const reply = object(input);
  if (reply.mutationId !== mutationId) throw Error("同步确认标识不匹配");
  if (reply.status === "conflict") return {
    status: "conflict", mutationId, current: reply.current === null ? null : parseChange(reply.current),
  };
  if (reply.status !== "applied" || reply.revision !== expectedRevision + 1
    || !validCursor(reply.cursor) || reply.cursor === "0") throw Error("同步确认版本不匹配");
  return { status: "applied", mutationId, revision: Number(reply.revision), cursor: reply.cursor };
}
