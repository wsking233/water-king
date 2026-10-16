# 游客生命周期核心（WK-06）

状态：代码与本地隔离 PostgreSQL 验证已完成。用户明确批准这份升级后，已于 2026-10-16（北京时间）应用生产受控迁移 `20261016014201_add_guest_lifecycle_guards`。此前的升级加回滚测试请求被自动审批审查拒绝；获得具体批准后改为正式迁移，未运行生产清理测试或删除真实账号。

## 可审阅的升级

`supabase/lifecycle-schema.sql` 定义生命周期模型/函数；`npm run lifecycle:generate` 将其与现有同步 RPC 的鉴权入口升级合并为 **`supabase/lifecycle-upgrade.sql`**。该文件是已获批准并应用的迁移内容，依赖现有 profiles/sync schema，不能重复安装。它会：

- 新增私有 `guest_activity`，从服务端已知创建、登录、profile 创建及记录修改时间初始化，不把全体活跃时间重置为部署时间。客户端不能直读或改写。
- 按服务端 `clock_timestamp()` 判定连续 **720 小时**，到点拒绝恢复，不依赖清理是否运行。缺少可信创建/活跃时间的匿名记录按失效处理；已绑定账号豁免。
- 为同步上传、拉取、profile 访问增加资格检查；有效且需计入的访问才更新活动，失败事务回滚。不接受客户端传入当前时间或最后活动时间。新增当前用户的 `account_status` RPC。
- 会续期的请求先锁 Auth 用户行；只读 profile GET 只检查、不加写锁或续期，兼容 PostgREST 的 READ ONLY 事务。该模式也有独立 SQL 回归。
- 在 `auth.users` 安装 BEFORE UPDATE 触发器，防止过期匿名身份通过绑定或更新登录时间复活。以数据库实际 `is_anonymous` 为准，不依赖用户元数据或过时 JWT 匿名标识。
- 新增仅受信任操作员可执行的私有 `cleanup_expired_guests(limit, onlyUser?)`。统一先锁 Auth 用户行，跳过被其他事务锁定的用户，拿锁后重查绑定/活跃状态，再通过外键级联删除私人数据。本地测试仅操作明确 fixture ID。

**迁移只安装清理入口，不创建 cron、不调用清理函数，不在部署时删除真实账号。** 调度频率、备份保留和实际绑定/清理并发验收仍待确认。同步预览继续默认关闭。

## 客户端

- 同步与首次迁移前先调用 `account_status`；新 RPC 缺失或网络失败即停止，不通过旧协议继续上传。默认关闭预览时不会触发此路径。
- 仅服务端 `PT401 / guest_expired` 显示过期状态，保留本机快照、队列与导出能力并停止自动重试。普通网络/认证错误不冒充游客过期。重建游客及重新导入入口尚未完成，不自动换 ID 或移动数据。
- 同用户 TOKEN_REFRESHED、重复 SIGNED_IN、USER_UPDATED 不再触发续期同步；首次恢复/换身份、前台返回、手动同步和实际写入才进入流程。隐藏页面不为昵称读取发请求，不增加周期活动心跳。

## 验证边界

`npm run test:lifecycle` 在独立内存 PGlite PostgreSQL 创建最小 Auth 表、角色、uid 函数，安装现有 schema、sync schema 和升级，运行三组 SQL 测试，再确认所有 fixture 回滚。不需要项目 URL、凭据或网络，不访问现有 Supabase。

已验证到期前 1 微秒、恰好到期、到期后、跨夏令时 720 小时、绑定账号豁免、JWT 匿名标识不改变资格、过期读写/续期/绑定拒绝、活跃与绑定账号不误清理、客户端不能清理或改写活动、私人数据级联删除及删除后旧 uid 被拒绝。既有同步/权限 SQL 回归通过；Node 与模拟服务浏览器回归另行运行。

这些测试不代表 Supabase Auth API 或真实多连接并发已验收。生产只读核验已确认活动表 RLS、Auth 触发器启用、profile 策略与同步资格检查生效、公开状态函数为 invoker，anon 无执行权限，authenticated 无清理权限。生产 Advisor 无 ERROR：私有活动表无策略是刻意禁止直访；新索引未使用属于 INFO；游客访问自己的数据符合产品要求。已有[密码泄露保护未启用警告](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)仍保留，密码登录尚未实现。托管 Auth API 行为与真实绑定/清理/同步多连接竞争仍待受控验收。调度、完整过期恢复界面、绑定及冲突产品选项仍未完成，不构成完整 V0.2 发布。
