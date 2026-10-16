export const achievementIds = ["first_record", "record_days_3", "record_days_7", "record_days_30", "streak_3", "streak_7", "goal_days_3", "goal_days_7", "goal_days_30"] as const;
export type Achievement = { id: string; title: string; description: string; target: number; progress: number; unit: string; achieved: boolean };
export type AchievementPage = { rulesVersion: 1; updatedAt: string; day: string; incompleteGoalHistory: boolean; achievedCount: number; items: Achievement[] };
export function parseAchievements(input: unknown): AchievementPage {
  const page = input as AchievementPage;
  if (!page || page.rulesVersion !== 1 || typeof page.updatedAt !== "string" || !Number.isFinite(Date.parse(page.updatedAt))
    || typeof page.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(page.day) || typeof page.incompleteGoalHistory !== "boolean"
    || !Array.isArray(page.items) || page.items.length !== achievementIds.length) throw Error("成就数据格式不正确，请更新应用或重试。");
  const ids = new Set<string>();
  for (const item of page.items) {
    if (!item || !achievementIds.includes(item.id as typeof achievementIds[number]) || ids.has(item.id)
      || typeof item.title !== "string" || !item.title.length || item.title.length > 80
      || typeof item.description !== "string" || item.description.length > 300
      || !Number.isSafeInteger(item.target) || item.target <= 0 || !Number.isSafeInteger(item.progress)
      || item.progress < 0 || item.progress > item.target || !["条", "天"].includes(item.unit)
      || typeof item.achieved !== "boolean" || item.achieved !== (item.progress >= item.target)) throw Error("成就数据格式不正确，请重试。");
    ids.add(item.id);
  }
  if (page.achievedCount !== page.items.filter(item => item.achieved).length) throw Error("成就统计不一致，请重试。");
  return page;
}
export const achievementCacheKey = (owner: string) => `water-king.achievements.v1:${owner}`;
export function readAchievementCache(storage: Pick<Storage, "getItem">, owner: string): AchievementPage | null {
  if (!owner || owner === "local") return null;
  try {
    const cached = JSON.parse(storage.getItem(achievementCacheKey(owner)) ?? "null");
    return cached?.owner === owner ? parseAchievements(cached.page) : null;
  } catch { return null; }
}
