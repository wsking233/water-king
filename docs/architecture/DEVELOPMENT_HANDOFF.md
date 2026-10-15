# V0.2 开发交接

按用户要求优先开发、分阶段中文提交；人工操作或产品确认事项记录并跳过。当前已具备账号基础代码和私有 profiles 表，**完整账号与记录云同步尚未可用**，原有单机界面与存储继续工作。

## 本次续作（2026-10-15）

- 已合入 `8bb6423` 及其本地 Repository、IndexedDB 队列和测试，沿用原接口，未将同步存储提前接入页面。
- 新增精确版本 `@supabase/supabase-js@2.118.0`；可选游客登录、自动恢复会话、跨标签页创建互斥、私有昵称读取/保存及重试入口。失败不替换本机记录；网络错误不会自动创建新游客。暂未开放登出、登录其他账号或绑定，不触发本机记录上传。
- 模型入口 `src/cloud/models.ts`；`npm run schema:generate` 生成 `supabase/schema.sql`。Supabase 工具已部署 `create_private_profiles`，绕开旧环境 CLI 的只读目录阻塞，未使用管理密钥。其余记录/设置/设备杯类型只是后续接口，尚无对应表或同步接口。
- 通过 Supabase SQL 事务模拟双用户 JWT：各自 profile 可读写，跨用户读取/修改/插入、归属转移及未登录访问均被拒绝；非法昵称被约束拒绝。所有测试 fixture rollback。Advisor 仅提示允许匿名游客访问自己的行，符合产品要求；[提示说明](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins)。
- 已读取当前 changelog 网页与认证文档；原 `.md` 路径不被网页工具支持，近期 TLS 改动不要求本次现代浏览器 SDK 改动。
- 本地 Project URL/Publishable Key 已通过连接项目读取并写入忽略的 `.env.local`；不提交公钥配置。Pages workflow 已读取同名 Actions Variables，但当前环境禁止 `api.github.com`，未能检查或设置仓库变量。需要仓库设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY` 后重新构建，控制台 Provider/URL 配置不会自动传入 GitHub Actions。
- 项目 Auth 域名也被网络策略拒绝，真实 signInAnonymously、刷新恢复与昵称 REST 链路仍待验证。Chromium 320px 模拟通过本机保存、登录网络失败不改记录、首次离线缓存及断网重开继续记录；尚未实测 iPhone。
- 昵称输入当前有 1–40 字符技术校验，不代表产品已确认最终昵称规则；绑定体验、冲突交互等原待决项继续保留。完整记录同步、账号绑定及 30 天清理没有在本次冒充完成。

以下保留上一轮底层开发交接；其中“未部署 profiles/未接入客户端配置/CLI 阻塞”等历史状态以以上续作为准。

## 已提交的开发

- `9c6f189`：WK-01，RecordRepository / SettingsRepository 与本地实现；统一页面读写，保存前校验，失败不修改页面成功状态，保留 v1 记录、v2 Store 和 JSON 备份兼容。
- `e70a478`：WK-03/04 的独立存储基础，尚未接入页面。IndexedDB 快照和 outbox 同事务，稳定 mutationId、按实体递增预期版本、删除墓碑、匹配服务端确认出队；账号隔离，安装实例 deviceId 持久化，杯子队列带本机设备 ID。本地 namespace 不入上传队列。
- 只将 `fake-indexeddb` 作为精确版本的开发依赖；未添加管理凭据或个人数据，未修改远程数据库。

## 验证证据

- Node 24：`npm test`，33 项通过，包括旧数据迁移失败保护、备份往返、跨日杯子、队列重开、账号隔离、编辑删除版本链、错误确认不出队、实际 IndexedDB 事务失败整体回滚。
- `npm run build -- --base=/water-king/`：TypeScript 与生产构建通过。
- `git diff --check`：通过。
- IndexedDB 验证使用 fake-indexeddb，未声称真实 Safari 或多设备云同步验证通过。

## 已确认的外部状态

- Supabase MCP 发现同名 `water-king` 项目（`kxnubwalifvbatmpfdld`）为 ACTIVE_HEALTHY；public schema 尚无应用表。
- 用户已告知开启 Anonymous Sign-Ins；未创建真实测试游客验证此设置。
- 已通过 Supabase 文档工具查阅匿名登录、原账号绑定、验证后设置密码要求。匿名用户属于 authenticated，未来 RLS 必须额外校验每行归属。

## 本轮跳过与阻塞

1. **数据库迁移工具环境**：当前 Supabase CLI 启动需要写 `/home/agent/.supabase`，执行环境返回 EROFS；申请该路径的附加写权限后仍为只读。固定旧版 CLI 的尝试也未成功。尚未生成或部署迁移。后续需在可运行 CLI 的环境继续；不要手写虚假迁移历史或用管理密钥绕过。普通 npm 缓存权限问题已通过 `/tmp/water-king-npm-cache` 解决。
2. **文档访问限制**：直接获取 Supabase changelog 被环境代理以 HTTP 403 拒绝，未绕过网络策略；专题文档可通过 MCP 查询。升级 SDK/CLI 前仍需补查相关 breaking changes。
3. **待产品确认（原规格明确标为待决）**：首版绑定渠道和验证/密码体验、昵称规则、同记录并发冲突交互、设备身份丢失后的恢复策略、物理清理频率与备份保留、账号主动删除流程。本轮未自行将这些改成已确认规则。
4. **尚未完成的开发**：WK-02 私有表/RLS/身份恢复；WK-03 网络 Worker、幂等 RPC、服务端版本检测、增量游标/拉取、冲突保留与处理；WK-04 页面接入、首次上传范围确认和账号切换；WK-05 绑定/密码/恢复；WK-06 服务端活跃判断、30 天过期拒绝恢复及并发安全清理。存储 API 的 cursor 目前仅占位，不代表已支持增量同步。
5. **客户端配置未接入**：尚未选择并配置构建用 Supabase URL 与 publishable key，CI 中也未添加对应变量；不使用 service_role/secret key。

## 后续开发顺序

先恢复可用的迁移工具和相关文档访问，逐项处理依赖产品决定的部分；用迁移建立私有表、归属约束及 RLS 后，补齐服务端幂等/版本协议。`SyncRepository` 的 expectedRevision 当前按每次成功变更增加 1，服务端需采用相同规则；若协议不同必须同步修改，不能直接上线。随后接入认证、异步页面保存、显式首次迁移确认与 SyncWorker。页面接入前应处理多标签页状态更新、存储读取失败和本机数据归属，避免将旧账号队列带入新账号。云端数据拉取不能直接覆盖有待同步修改的快照，也不能覆盖另一设备的杯状态。

## 留给人工的验收

- 真实 iPhone 首次离线缓存、断网重开、长按取消、主动更新后数据保留、旧版本升级与备份恢复。
- 两游客 RLS 越权、刷新恢复同一身份、断网新增/编辑/删除与重复请求、上传中断、跨设备水位独立。
- 验证绑定前后 userId 不变、错误绑定不覆盖他人数据、账号切换队列隔离、30 天边界、清理/绑定/同步并发。
- 后两组需先完成相应开发；目前不具备人工验收条件。

## 发布

用户已授权构建正常后直接推送 main 触发现有 GitHub Actions。最终提交与推送状态以本次交付消息为准；未观察到部署成功前不宣称已上线。
