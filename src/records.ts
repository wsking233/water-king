export type Kind = "water" | "small";
export type Entry = {
  id: string;
  kind: Kind;
  amount: number;
  at: string;
  cupId?: string;
};
export const KEY = "water-king.records.v1";
export function validAmount(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 5000;
}
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function todayEntries(entries: Entry[], now = new Date()) {
  return entries.filter((e) => dayKey(new Date(e.at)) === dayKey(now));
}
export function totals(entries: Entry[]) {
  return entries.reduce(
    (sum, e) => ({
      water: sum.water + (e.kind === "water" ? e.amount : 0),
      small: sum.small + Number(e.kind === "small"),
    }),
    { water: 0, small: 0 },
  );
}
export function parseEntries(raw: string | null): Entry[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (
    !Array.isArray(data) ||
    !data.every(
      (e) =>
        e &&
        typeof e.id === "string" &&
        ["water", "small", "large"].includes(e.kind) &&
        (e.cupId === undefined || typeof e.cupId === "string") &&
        typeof e.at === "string" &&
        Number.isFinite(Date.parse(e.at)) &&
        (e.kind === "water" ? validAmount(e.amount) : e.amount === 1),
    ) ||
    new Set(data.map((e) => e.id)).size !== data.length
  )
    throw new Error("记录格式不正确");
  return data.filter((e) => e.kind !== "large");
}

export type Cup = { id: string; capacity: number; day: string };
export type Store = { entries: Entry[]; cup: Cup; goal?: number | null };
export function validGoal(value: number) {
  return Number.isInteger(value) && value >= 100 && value <= 10000;
}
export const STORE_KEY = "water-king.state.v2";
export function newCup(capacity = 250, now = new Date()): Cup {
  return { id: crypto.randomUUID(), capacity, day: dayKey(now) };
}
export function cupProgress(state: Store, now = new Date()) {
  if (state.cup.day !== dayKey(now)) return 0;
  return state.entries
    .filter((e) => e.kind === "water" && e.cupId === state.cup.id)
    .reduce((sum, e) => sum + e.amount, 0);
}
export function readStore(raw: string | null, legacy: string | null): Store {
  if (raw === null) return { entries: parseEntries(legacy), cup: newCup() };
  const state = JSON.parse(raw);
  if (
    !state ||
    !state.cup ||
    typeof state.cup.id !== "string" ||
    typeof state.cup.day !== "string" ||
    !validAmount(state.cup.capacity)
  )
    throw Error("杯子数据异常");
  const entries = parseEntries(JSON.stringify(state.entries));
  if (
    entries
      .filter((e) => e.cupId === state.cup.id)
      .reduce((n, e) => n + e.amount, 0) > state.cup.capacity
  )
    throw Error("杯子进度异常");
  if (state.goal !== undefined && state.goal !== null && !validGoal(state.goal))
    throw Error("目标数据异常");
  return {
    entries,
    cup: state.cup,
    ...(state.goal !== undefined ? { goal: state.goal } : {}),
  };
}
export function updateProgress(
  state: Store,
  target: number,
  now = new Date(),
): Store {
  if (!Number.isInteger(target) || target < 0 || target > state.cup.capacity)
    throw Error("进度超出杯子容量");
  const cup =
    state.cup.day === dayKey(now) ? state.cup : newCup(state.cup.capacity, now);
  const current = cupProgress({ ...state, cup }, now);
  if (target === current) return { ...state, cup };
  if (target > current)
    return {
      cup,
      entries: [
        {
          id: crypto.randomUUID(),
          kind: "water",
          amount: target - current,
          at: now.toISOString(),
          cupId: cup.id,
        },
        ...state.entries,
      ],
    };
  let remaining = current - target;
  const entries = state.entries.flatMap((e) => {
    if (e.kind !== "water" || e.cupId !== cup.id || remaining === 0) return [e];
    const remove = Math.min(remaining, e.amount);
    remaining -= remove;
    return remove === e.amount ? [] : [{ ...e, amount: e.amount - remove }];
  });
  return { cup, entries };
}

export type RecordGroup = Entry & { members: Entry[] };
/** Group one cup within a local day; legacy records stay individually editable. */
export function groupRecords(entries: Entry[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const entry of [...entries].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  )) {
    const key =
      entry.kind === "water" && entry.cupId
        ? JSON.stringify(["cup", entry.cupId, dayKey(new Date(entry.at))])
        : JSON.stringify(["entry", entry.id]);
    const group = groups.get(key);
    if (group) {
      group.amount += entry.amount;
      group.members.push(entry);
    } else groups.set(key, { ...entry, members: [entry] });
  }
  return [...groups.values()];
}
