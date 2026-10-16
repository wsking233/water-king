import { getCloudClient } from "./client";
export type GoalTicket = { ticket: string; day: string; revision: number };
export async function loadGoalTicket(owner: string, signal: AbortSignal): Promise<GoalTicket> {
  const client = getCloudClient();
  if (!client || owner === "local" || !navigator.onLine) throw Error("当前无法确认服务端日期");
  const { data: auth, error } = await client.auth.getSession();
  if (error) throw error;
  if (auth.session?.user.id !== owner) throw Error("目标账号已变化");
  const result = await client.rpc("goal_ticket", {}).setHeader("Authorization", `Bearer ${auth.session.access_token}`)
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
  if (result.error) throw result.error;
  const value = result.data as unknown as GoalTicket;
  if (!value || typeof value.ticket !== "string" || !/^[a-f0-9-]{36}$/i.test(value.ticket)
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isSafeInteger(value.revision) || value.revision < 0)
    throw Error("目标日期凭证格式不正确");
  return value;
}
