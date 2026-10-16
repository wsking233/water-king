import test from 'node:test';
import assert from 'node:assert/strict';
import {localDayInput,parseHistoryDay,moveHistoryDay} from '../src/historyDates.ts';
test('local calendar selection validates dates and clamps the future without UTC conversion',()=>{
 const today=new Date(2026,0,1,8,30);
 assert.equal(localDayInput(parseHistoryDay('2025-12-31',today)!),'2025-12-31');
 assert.equal(localDayInput(parseHistoryDay('2026-01-02',today)!),'2026-01-01');
 for(const input of ['','bad','2025-02-29','2026-13-01','0000-01-01'])assert.equal(parseHistoryDay(input,today),null);
 assert.equal(localDayInput(moveHistoryDay(today,-1,today)),'2025-12-31');
 assert.equal(localDayInput(moveHistoryDay(today,1,today)),'2026-01-01');
 assert.equal(localDayInput(parseHistoryDay('2024-02-29',today)!),'2024-02-29');
});
