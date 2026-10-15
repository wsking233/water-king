import {
  readStore,
  validAmount,
  dayKey,
  totals,
  todayEntries,
  type Store,
  type Entry,
  type Kind,
} from "./records.ts";
export function backupText(state: Store, now = new Date()) {
  return JSON.stringify(
    {
      format: "water-king-backup",
      version: 1,
      exportedAt: now.toISOString(),
      state,
    },
    null,
    2,
  );
}
export function parseBackup(text: string): Store {
  if (text.length > 5 * 1024 * 1024)
    throw Error("备份超过 5 MB，请选择较小的文件。");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("文件不是有效的 JSON 备份。");
  }
  if (
    data?.format !== "water-king-backup" ||
    data.version !== 1 ||
    !data.state ||
    !Array.isArray(data.state.entries) ||
    data.state.entries.length > 50000
  )
    throw Error("无法识别这个备份，请选择大水之王导出的文件。");
  try {
    return readStore(JSON.stringify(data.state), null);
  } catch {
    throw Error("备份中的记录或设置不完整，尚未修改本机数据。");
  }
}
export function localInputDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function upsertRecord(
  state: Store,
  input: { id?: string; kind: Kind; amount: number; at: string },
  now = new Date(),
): Entry[] {
  const time = new Date(input.at);
  if (!Number.isFinite(time.getTime()) || time.getTime() > now.getTime())
    throw Error("请选择现在或过去的记录时间。");
  if (
    !["water", "small"].includes(input.kind) ||
    (input.kind === "water" ? !validAmount(input.amount) : input.amount !== 1)
  )
    throw Error("饮水量请输入 1–5000 ml 的整数。");
  const old = state.entries.find((e) => e.id === input.id);
  if (input.id && !old) throw Error("这条记录已不存在，请重新打开记录列表。");
  const cupId =
    old?.kind === "water" && input.kind === "water" ? old.cupId : undefined;
  const entry: Entry = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    amount: input.amount,
    at: time.toISOString(),
    ...(cupId ? { cupId } : {}),
  };
  const next = [entry, ...state.entries.filter((e) => e.id !== entry.id)].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  if (
    next
      .filter((e) => e.kind === "water" && e.cupId === state.cup.id)
      .reduce((n, e) => n + e.amount, 0) > state.cup.capacity
  )
    throw Error("修改后会超过当前杯子的容量，请调整水量或另补一条记录。");
  return next;
}
export function weekSummary(entries: Entry[], now = new Date()) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6 + i,
      12,
    );
    const day = todayEntries(entries, date);
    return {
      date,
      key: dayKey(date),
      ...totals(day),
      hasRecords: day.length > 0,
    };
  });
}
