# v0.3.0 私有动态成就交接

依据 [已确认产品规则 AC-01～AC-04](../product/ACHIEVEMENTS.md)。用户选择按当前有效记录重算、可收回，因此无需永久解锁/领奖账本；历史记录被服务端接受后自动参与，重复读取和重试无副作用。

## 生产迁移与接口

迁移 `20261016172215_add_private_dynamic_achievements` 已成功应用，仅新增三个函数，没有建表或写业务数据，没有改原同步/目标日志/榜单函数。

- `supabase/achievement-facts.sql`：SHA-256 `65f9bd8e4e3ae17ca90a68be65da982111b99f36ce415aaeb5e65b7552356fd6`。
- `supabase/achievements.sql`：SHA-256 `b43fd1fac1273862af85b21f62ebc3335e419ac877d6433f7872b7821287ebf8`。
- `public.achievement_page()`：无用户/时间/分数参数，仅 authenticated 可调用。私有 definer helper 验证 require_active_user(false)，从 auth.uid 推导归属，固定服务器时钟，拒绝无账号/过期游客。返回规则版本、北京日、本次确认时间、目标覆盖提示、达成数量与九项固定目录/当前进度/状态；无 ID、邮箱或原始记录。
- `achievement_facts(user,as_of)` 为撤销客户端 execute 的私有 invoker helper；消费现有已接受记录日和 goal_on_day，统计有效记录数、累计记录日、历史最长连续段、可靠目标完成日。不读杯子，不接受客户端分数。
- 所有函数固定空 search_path；公开 wrapper 为 invoker。没有匿名读成就入口或状态写入口。退出排行榜不影响私有成就。
- 生产核验：三函数类型/空搜索路径正确，匿名均不可调用；authenticated 仅可调用受控 page helper/wrapper，不能指定他人读取 facts。随机不存在用户的受信事实查询为四项零值、覆盖缺口 false。未操作真实用户来制造成绩。
- 安全 Advisor 未报告涉及新增函数的发现；既有私有表 RLS 无 policy、游客归属访问和密码保护配置未改。[既有 RLS 提示说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

## 客户端与缓存

「我的 → 记录里程碑 → 我的成就」底部弹层，320px 双列；展示当前达成，删改后可能收回，无永久解锁日期或奖励。没有第六个底部导航。首次确认、重试、待同步、可靠目标不足、缓存状态都有中文提示。

请求固定已核对的账号 token，账号变化/关闭弹层取消请求；不能把旧账号响应展示到新账号。缓存键 `water-king.achievements.v1:<owner>`，保存来源 owner 和经校验的 v1 响应。读缓存必须 owner 匹配、九项 ID 不重复、版本/进度/状态一致；坏缓存忽略，存储失败不把真实成功查询变成失败。弹层内身份变化时撤回展示并移除旧账号缓存；弹层关闭后保留的缓存仍受 owner 隔离，不能视为身份凭据。

离线显示“缓存，尚未重新确认”与上次时间，不声称当前已由服务器重新确认；联网及本机同步状态变化后重新读取。纯本机/未登录只显示接入说明，不用本机估计冒充云端成就。已登录但未接入本机数据时，可查看该云端账号已有的成就，本机旧记录仍须首次上传确认。

原 Store、备份 v1、IndexedDB 队列与旧存储键不变；不导出或导入成就状态。旧记录服务端收到后自然参与计算，无批量补发任务或 Cron。门槛改变必须升级规则版本，旧客户端对不兼容目录拒绝冒认。

## 验证与边界

- `npm run test:achievements`：正式 SQL 同库三次事务回滚，首条/历史记录、同日去重、历史最长连续、删除中间日收回与恢复、30日门槛、目标可靠/缺口、跨账号、匿名/空 uid/过期游客及原始字段不泄露。
- `npm run test:goal-browser`：浏览器连接实际生产 SQL，2账号/同账号2设备，新增本机模式入口、九项展示、503后重试、离线关闭重开缓存、删除最后记录收回、其他账号仍达成、320px 无横向溢出。
- 单元测试覆盖缓存串账号、旧规则、重复 ID、非法进度/状态、存储失败；原 SQL/目标历史/lifecycle/同步/排行榜/邮箱浏览器及生产路径 build/release:check 均通过。
- 用户已报告 v0.2.2 人工验收通过；**不把该报告扩展为新成就实机验收或真实 PostgreSQL 多连接压测已完成**。本次使用 PGlite 和模拟移动 Chrome，真实 iPhone 弹层/安全区、跨设备删改收回、账号切换缓存仍需人工验收。

## 恢复与后续

优先回滚前端入口或撤回 public/private page 的 authenticated execute；原记录保存、同步及榜单不受影响。没有成就持久表需要清理；不 DROP CASCADE，不删除真实数据。未来公开展示、永久纪念、奖励与宠物联动不在本次授权规则中。
