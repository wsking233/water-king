# 排行榜生产 API 与验收（v0.2.1）

2026-10-16 用户要求完整排行榜界面并推送更新，沿用上一轮直接生产交付授权。正式迁移：`20261016163557_add_leaderboard_projection_and_privacy`；SQL：`supabase/leaderboard.sql`，SHA-256 `7bd6a1c895a8cac17f32ca1b566c560d9de1f97ada4bc7ded0c8c46849a9c95d`。未启用 Cron，未删除真实数据。

## 查询与隐私

- `leaderboard_page(p_metric,p_offset,p_snapshot)` 支持 streak/days/goals/today/total，单页固定最多 20，offset 必须为非负 20 的倍数且 <=1000000。第一页 snapshot=null，后续必须携带前页快照。
- 返回公开 rows（仅 nickname/score/rank/empty/incomplete）、mine、total、hasMore、participating、北京 day、服务器 updatedAt、snapshot/stale 与目标覆盖提示。排名为 competition ranking；同分按零数据已验证邮箱优先、规范昵称、内部稳定 ID 排序，邮箱状态和 ID 不出 API。
- 快照是服务器候选序列的摘要，包含所有页成绩/顺序、公开昵称、记录/覆盖数量、北京日期与指标。变化则 stale=true、rows=[]，前端清空分页并要求刷新，不混用两份结果。
- 匿名可读最小公开投影，但 mine/participating 为 null；登录者 mine 从 auth.uid() 推导，不接收客户端 user_id。纯本机数据不计分。游客/邮箱默认参加，包括零记录账号；已过期游客排除。
- `leaderboard_participation(p_enabled)` 仅 authenticated，通过 require_active_user 验证、按真实 uid 写私有偏好；不允许改他人状态。客户端固定当前账号会话后写入，失败不显示成功。退出立即影响新查询并使旧分页失效；别人设备已保存的公开内容无法远程抹除。
- 新表启用 RLS 并撤销客户端权限，公开 wrapper 为 invoker；受信 helper 在非暴露 schema 中为 definer、空 search_path，仅授予对应入口 execute。anon 增加私有 schema USAGE，但无原始表权限、无其他私有计算函数执行权限。

## 历史目标（v0.2.2 已接通）

`leaderboard_daily_goals` 只允许受信服务端写入可靠的逐日证据。本批没有回填旧目标，也没有把现有 sync_apply 的当前值当作历史。目标完成榜按这个私有表与每日饮水真实聚合计算，测试含已知/关闭目标。

v0.2.2 已迁移 `20261016165913_capture_verified_goal_history`，目标聚合改读正式基线/事件日志，不依赖旧空表。在线保存目标可建立当天及之后的覆盖，未知日期不虚算；明确的保守规则已获用户确认。见 [正式历史目标交接](GOAL_HISTORY_PRODUCTION.md)。新增仅本人可见的 goalCoverageStart 起日字段，其余公开契约不变。

## 界面与验证

普通线上网址底部「排行」；五项横向切换、最多20人/页、加载更多、我的名次独立展示（在前20之外也显示）、空榜、错误重试、只在当前页面保留的离线缓存、服务端时间、60秒可见页自动刷新、返回前台/重新联网刷新。不会称缓存为实时，日界由服务器确定。

「我的 → 排行榜隐私」展示默认公开说明并能退出/重新参与；账号已登录但尚未接入同步时也可管理参与状态。未同步的本机变更不会伪装为成绩。版本 v0.2.1。

- `npm run test:leaderboard`：正式 SQL 同库三次回滚重放，19/20/21/41、并列分页、零记录邮箱/游客、我的名次、退出及快照失效、重新参与、过期游客、恶意参数、匿名/登录权限负面、原始字段不外泄、当前目标不能冒充历史、可靠目标/关闭目标。
- `npm run test:leaderboard-browser`：320px 模拟移动浏览器，五项切换、19/20/41分页、长昵称、空榜、失败重试、旧快照、断网与恢复、游客登录、退出/重新参与及前20之外我的名次。
- 既有 npm test、goal-history、lifecycle、sync-browser、email-browser、生产路径 build、release:check 通过。
- 生产只读核验：2位参与用户返回2行，日期为北京 2026-10-17；投影无 ID/邮箱/单条字段。匿名无原始表/参与写权限，authenticated 无目标证据写权限。未修改真实用户参与状态来冒充实测。
- 真实 iPhone 手势/安全区、多设备登录/退出以及正式环境游客生命周期仍需人工实测，PGlite 不代表真实多连接并发压测。

## 恢复与后续

若需撤回，先回滚客户端入口，再撤销公开 wrapper/helper 的客户端 execute；保留偏好表和证据，不删除用户数据。新增表/函数不改原有同步写入协议，不影响私人记录保存。不得使用 CASCADE 清理。

后续：真实多设备/午夜验收、真实多连接锁竞争与实际规模下查询性能。没有后台定时任务。

生产安全 Advisor 已复查：新增两个私有表的“RLS 无 policy”属于预期拒绝客户端直读/写的设计，只有受控 helper 可访问；未为消除提示开放表权限。参考 [RLS 提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。既有游客归属访问提示与泄露密码保护设置未在本次改变。
