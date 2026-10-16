/** Calendar navigation uses the device's local day, independently of Beijing cloud rankings. */
export function localDayInput(date: Date) {
  return `${String(date.getFullYear()).padStart(4,"0")}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function parseHistoryDay(value: string, now=new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0,4)==='0000') return null;
  const [y,m,d]=value.split('-').map(Number), date=new Date(0);
  date.setFullYear(y,m-1,d);date.setHours(12,0,0,0);
  if (localDayInput(date)!==value) return null;
  if (localDayInput(date)>localDayInput(now)) return new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  return date;
}
export function moveHistoryDay(date: Date, offset: number, now=new Date()) {
  const next=new Date(date);next.setDate(next.getDate()+offset);next.setHours(12,0,0,0);
  return parseHistoryDay(localDayInput(next),now) ?? date;
}
