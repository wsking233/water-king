export type ToiletKind = 'urination' | 'bowel';
export type Activity =
  | { id: string; kind: 'water'; amountMl: number; occurredAt: string }
  | { id: string; kind: ToiletKind; occurredAt: string };

/** All calendar statistics use Asia/Shanghai, independent of the device timezone. */
export function calendarDay(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp');
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dailySummary(records: readonly Activity[], day: string) {
  const today = records.filter(record => calendarDay(record.occurredAt) === day);
  return {
    waterMl: today.reduce((total, record) => total + (record.kind === 'water' ? record.amountMl : 0), 0),
    urinationCount: today.filter(record => record.kind === 'urination').length,
    bowelCount: today.filter(record => record.kind === 'bowel').length
  };
}

export function recordedDays(records: readonly Activity[], from: string, to: string): number {
  return new Set(records.map(record => calendarDay(record.occurredAt)).filter(day => day >= from && day <= to)).size;
}
