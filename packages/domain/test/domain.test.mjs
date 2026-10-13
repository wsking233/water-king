import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay, dailySummary, recordedDays } from '../src/index.ts';

test('Shanghai midnight belongs to the next calendar day', () => {
  assert.equal(calendarDay('2026-10-12T16:00:00Z'), '2026-10-13');
  assert.equal(calendarDay('2026-10-12T15:59:59Z'), '2026-10-12');
  assert.throws(() => calendarDay('bad'));
});
const records = [
  { id: '1', kind: 'water', amountMl: 250, occurredAt: '2026-10-13T01:00:00Z' },
  { id: '2', kind: 'water', amountMl: 300, occurredAt: '2026-10-13T02:00:00Z' },
  { id: '3', kind: 'urination', occurredAt: '2026-10-13T03:00:00Z' },
  { id: '4', kind: 'bowel', occurredAt: '2026-10-12T03:00:00Z' }
];
test('water and toilet events aggregate separately', () => {
  assert.deepEqual(dailySummary(records, '2026-10-13'), { waterMl: 550, urinationCount: 1, bowelCount: 0 });
});
test('ranking counts distinct days, not volume or event count', () => {
  assert.equal(recordedDays(records, '2026-10-12', '2026-10-13'), 2);
  assert.equal(recordedDays(records, '2026-10-13', '2026-10-13'), 1);
});
