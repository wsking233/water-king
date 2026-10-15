# 私人同步协议（WK-03）

本协议、代码和 SQL 已实现并验证；已接入默认关闭的页面预览，不表示默认上传现有记录。遵循 US-04、US-06、US-09～US-11 与 SYNC 的离线、隐私、冲突保留及设备杯子约束。首次迁移与页面验证见 [SYNC_UI.md](SYNC_UI.md)。

## 数据模型与访问

- `src/cloud/models.ts` 定义真实存储行；`src/syncProtocol.ts` 定义传输与运行时校验。
- `waterking_private.sync_entities`：以 `(user_id, entity, entity_id)` 标识记录、设置和设备杯，保存 `revision`、账号内 `cursor`、JSON `value` 与服务端时间。`value = NULL` 表示删除墓碑，只有记录可以删除。记录保留原 `Entry` 的字符串 ID 与 `cupId`，不强制将旧 ID 改为 UUID。
- `sync_heads`：每账号的递增提交游标。写操作锁定账号行，事务提交前持锁；避免序列号分配后乱序提交导致客户端漏读。
- `sync_receipts`：以 `(user_id, mutation_id)` 保存原请求和确认。相同请求重发返回相同确认；同 ID 换内容被拒绝。记录修改、删除或分页后也不改变旧确认。
- 私有表均启用 RLS，客户端没有表读写权限。公开接口仅有 `sync_apply`、`sync_pull` 两个 SECURITY INVOKER RPC；调用不暴露于 Data API 的私有 SECURITY DEFINER 函数，固定空 search_path，显式使用 `auth.uid()`、存活的 Auth 用户及所有权过滤。没有客户端 `user_id` 入参。Definer 是为了在无表写权限的条件下保证整套事务约束，不能用普通写表绕过版本或幂等协议。
- 只给 authenticated 执行权限；匿名游客也是 authenticated，按自身 user ID 隔离。无认证的 anon 不能执行；未来启用其他 Data API schema 时不能将私有 schema 加入暴露列表。

## 写入与拉取

`sync_apply(mutationId, entity, entityId, expectedRevision, value)`：新实体从 revision 0 开始，每次应用恰好加 1；成功更新实体、账号游标和请求确认在同一事务。客户端时间不参与冲突排序。水量、目标、杯容量、时间与载荷字段均由服务端验证。版本不符返回当前服务器版本（可能为墓碑，或实体不存在时为 null），不修改任何实体，不清理客户端队列。

`sync_pull(after, limit)`：游标用十进制字符串传输，避免 JavaScript 超过 2^53 的精度损失。按账号、游标升序下发实体最新状态和墓碑，每页与账号 head 一致。返回已交付页末的 cursor、changes、hasMore；同一实体稍后又变动时获得更大游标，会再次下发。该接口同步当前状态，不是审计历史。墓碑与请求确认暂不压缩/清除；生命周期清理账号时通过外键级联删除，不先行引入可能漏删除的 GC。

## 本地事务与 Worker

- 本地修改仍先事务提交快照与队列，成功反馈不依赖网络。`applyPage` 将一整页与 cursor 同事务落盘，校验失败（包括杯进度溢出）整体回滚。
- 有待上传改动的实体不被拉取覆盖；队列及预期版本保留。其他设备的杯子不改变本机杯状态。拉取使用旧 cursor 的并发任务被拒绝，不能回滚已保存游标。
- `SyncWorker.run(owner)` 需已有经过首次数据处理确认的账号快照。它不会自行迁移 localStorage 或创建账号；本地 namespace 不允许上传。每轮最多 200 次写请求和 50 页拉取，网络错误向调用方报告，下一轮复用原 mutationId。
- 只在匹配 mutationId 与 revision 的服务器确认后出队；任何冲突立即停止该轮，保留本地修改和整条未完成版本链，返回双方数据供未来界面展示，不自动选胜者。
- 同账号并发启动合并成一轮，多标签页通过 Web Lock 串行执行；支持取消。每个请求前后检查当前真实 Auth 用户；Transport 校验队列 owner 与 session，固定 Authorization header，防止切账号时把 A 队列写入 B。本机缓存的视图标记不参与服务器认证。单次 RPC 有 15 秒超时。
- 只有无待上传队列、末页已成功落盘才返回 synced。同步中又发生本地修改则返回 pending。无后台无限心跳，不自行定义游客活跃或 30 天期限。

## 验证与部署

`supabase/sync-schema.sql` 通过 Supabase 部署工具应用为 `add_private_sync_protocol`，不是由浏览器持有管理凭据建表。`supabase/sync-protocol.test.sql` 在回滚事务中验证幂等、重复 ID 换内容、版本冲突、删除与旧编辑竞争、分页墓碑、页后再次编辑、空页、非法数据、两账号隔离、私有表直读拒绝及未登录拒绝。已经在事务试运行和实际部署后各验证一次，不保留测试身份。

本地测试覆盖离线发送中断重试、精确确认、冲突不出队、账号切换、取消、分页断点、拉取期间本机编辑、游标异常与本机杯隔离；Transport 使用实际 SDK 与模拟 fetch 验证固定身份 header。未宣称真实 Auth REST、多设备并发、Safari 或 iPhone 验证通过。

安全 Advisor 的匿名游客策略提示符合产品规则；其余密码泄露保护关闭提示应在密码绑定阶段处理：[Supabase 密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。性能 Advisor 无提示。WK-04 页面接入已通过模拟服务验证；仍需产品确认后的冲突界面、WK-05 绑定、WK-06 30 天服务端生命周期和真实服务/设备验收，再开放正式同步。
