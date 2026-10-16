export type LeaderboardRow = { nickname: string; score: number; rank: number; empty: boolean; incomplete: boolean };
export type LeaderboardPage = { rows: LeaderboardRow[]; mine: LeaderboardRow | null; total: number; hasMore: boolean; participating: boolean | null; snapshot: string; stale: boolean; updatedAt: string; day: string; goalHistoryAvailable: boolean; goalCoverageStart?: string | null };
function row(input: unknown, total: number): LeaderboardRow {
  const value = input as LeaderboardRow;
  if (!value || typeof value.nickname !== "string" || value.nickname.length > 80 || !value.nickname.trim()
    || !Number.isSafeInteger(value.score) || value.score < 0 || !Number.isSafeInteger(value.rank) || value.rank < 1 || value.rank > total
    || typeof value.empty !== "boolean" || typeof value.incomplete !== "boolean") throw Error("排行榜数据不完整，请刷新重试。");
  return { nickname: value.nickname, score: value.score, rank: value.rank, empty: value.empty, incomplete: value.incomplete };
}
export function parseLeaderboard(input: unknown, offset = 0): LeaderboardPage {
  const value = input as LeaderboardPage;
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.rows) || value.rows.length > 20
    || typeof value.snapshot !== "string" || !/^[a-f0-9]{32}$/.test(value.snapshot)
    || typeof value.stale !== "boolean" || typeof value.hasMore !== "boolean" || typeof value.goalHistoryAvailable !== "boolean"
    || ![true, false, null].includes(value.participating) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)
    || (value.goalCoverageStart != null && (typeof value.goalCoverageStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.goalCoverageStart)))) throw Error("排行榜数据不完整，请刷新重试。");
  const rows = value.rows.map(item => row(item, value.total));
  if (value.stale ? rows.length !== 0 : rows.length !== Math.min(20, Math.max(0, value.total - offset))) throw Error("榜单分页已变化，请刷新后重试。");
  if (!value.stale && value.hasMore !== (offset + rows.length < value.total)) throw Error("榜单分页已变化，请刷新后重试。");
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1], current = rows[i];
    if (current.score > previous.score || current.rank < previous.rank || (current.score === previous.score && current.rank !== previous.rank)) throw Error("榜单顺序已变化，请刷新后重试。");
  }
  const mine = value.mine === null ? null : row(value.mine, value.total);
  if (mine && value.participating !== true || !mine && value.participating === true) throw Error("账号排名状态已变化，请刷新重试。");
  return { rows, mine, total: value.total, hasMore: value.hasMore, participating: value.participating, snapshot: value.snapshot, stale: value.stale, updatedAt: value.updatedAt, day: value.day, goalHistoryAvailable: value.goalHistoryAvailable, goalCoverageStart: value.goalCoverageStart };
}
export function refreshedLeaderboard(previous: LeaderboardPage | null, next: LeaderboardPage): LeaderboardPage {
  if (previous && previous.snapshot === next.snapshot && previous.rows.length > next.rows.length)
    return { ...next, rows: previous.rows, hasMore: previous.rows.length < next.total };
  return next;
}
