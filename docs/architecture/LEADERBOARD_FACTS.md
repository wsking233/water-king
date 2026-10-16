# 排行榜私有记录事实层（LB-02 增量）

2026-10-16，用户授权“直接上生产版本”后，四项私有统计已正式部署；仍不是公开 API 或完整排行榜。历史目标设计草案未部署。

生产 SQL：`supabase/leaderboard-record-facts.sql`；迁移 `20261016162526_add_leaderboard_private_record_facts`。SHA-256：`4d2e722feb5aae06066dfefe14069caf8f463eb50335befadc9c42e8702cc8ae`。只新增 `leaderboard_record_days` / `leaderboard_record_scores` 两函数，读取既有当前实体，无业务数据写入。生产空用户只读查询返回四项零分；anon/authenticated 均无执行权限。

## 输入与边界

只消费 `waterking_private.sync_entities` 中经既有服务端协议接收的当前 `record`。同一用户/记录 ID 只有一个当前版本；不累计 receipts，不读杯状态、客户端缓存或传入分数。墓碑不计；水量仅 water，small 只形成记录日。历史补记沿用记录事件时间，转换到 Asia/Shanghai，而非上传时间。

`draft_record_days(user, as_of)` 返回私有北京日期、每日水量和记录数。`draft_record_scores(user, as_of)` 返回累计记录日、当前连续日、今日和历史水量；均使用 bigint。今天无记录时从昨天起算，今天/昨天均空则连续为零。按需计算，午夜无写入也不会沿用昨日“今日”值，无 Cron。

## 安全与兼容

函数为 SECURITY INVOKER、空 search_path，撤销 PUBLIC/anon/authenticated 执行权限；不是可传任意用户 ID 的客户端 RPC。测试时钟和用户参数只供隔离 fixture/受信操作端使用。未来公共接口必须由服务端取当前时间，只返回参与者公开聚合，不能暴露每日事实或开放本函数。现阶段未实现公开参与筛选、过期游客过滤、排名、分页或我的名次。

沿用已有同步校验，不引入第二套写入路径。读取按 as_of 排除未来事件；as_of 是查询截止时间，不是历史快照：记录被编辑后，过去时间参数也读取当前版本，不能用于审计旧成绩。NULL/非有限时钟不返回事实。现有每用户实体主键可限定扫描范围；全站规模化扫描与增量物化/索引需后续测量，不能把此原型宣称为已完成性能验证。

历史目标完成天数不在本批计算，不能把当前目标套用到历史日。目标时间策略仍见 GOAL_HISTORY.md 待评审项。

## 复验

运行 `npm run test:goal-history`：加载既有 Schema/协议/生命周期及两个隔离原型，同一库重放三次并回滚，核对旧协议函数定义未变。SQL 覆盖重复 mutation、嘘嘘、空用户、多账号、补记、删改、北京午夜、非北京会话时区及客户端拒绝执行。PGlite 不能替代真实 Postgres 并发及生产计划验证。

生产采用无 draft 前缀的正式函数，计算与原型相同；CI 同时重放正式 SQL。后续目标历史及公开接口另行实现，不能把本次迁移当成完整五榜上线。

回滚：先确认没有新依赖，再只撤销本次新增的两个函数（先 scores 后 days），禁止 CASCADE，不触碰 sync 数据。当前没有依赖的新 RPC 或触发器，因此撤销不影响记录同步。默认不执行回滚。

CLI 环境说明：当前 CLI 因只读 `/home/agent/.supabase` 无法启动，旧版尝试也失败；本次保留独立部署 SQL，通过 Supabase MCP 正式迁移工具产生真实迁移编号，不伪造 CLI 迁移文件或历史。

部署后运行安全 Advisor：没有涉及新增函数的发现；既有提示包括 guest_activity 无 RLS policy（私有拒绝客户端访问）、游客可按归属访问自身资料/同步数据（产品要求），以及尚未启用泄露密码保护。未在本次迁移中改变这些设置。密码保护参考：https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection 。
