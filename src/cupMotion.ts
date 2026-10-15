/** A short tap does not count; a full cup takes about 5.5 seconds of holding. */
export function heldProgress(start: number, capacity: number, elapsed: number) {
  const duration = Math.max(0, elapsed - 350);
  if (duration >= 5500) return capacity;
  const consumed = Math.floor(((duration / 5500) * capacity) / 5) * 5;
  return Math.min(capacity, start + consumed);
}
