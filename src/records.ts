export type Kind = "water" | "small" | "large";
export type Entry = { id: string; kind: Kind; amount: number; at: string };
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
      large: sum.large + Number(e.kind === "large"),
    }),
    { water: 0, small: 0, large: 0 },
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
        typeof e.at === "string" &&
        Number.isFinite(Date.parse(e.at)) &&
        (e.kind === "water" ? validAmount(e.amount) : e.amount === 1),
    ) ||
    new Set(data.map((e) => e.id)).size !== data.length
  )
    throw new Error("记录格式不正确");
  return data;
}
