# LB-02.1 历史目标：数据契约与本地 SQL 原型

当前生产状态：2026-10-16 用户已确认保守日期规则，v0.2.2 正式实现与迁移见 [GOAL_HISTORY_PRODUCTION.md](GOAL_HISTORY_PRODUCTION.md)。下文是先前设计/fixture 记录，不再代表对应规则待审；原型仍不是生产迁移。

原记录状态：**设计与可重放 fixture；不是生产迁移。** 依据 2026-10-16 最新 `LEADERBOARD.md` / `LEADERBOARD_TASKS.md` 的 LB-02 第一部分。本轮不增加公开榜单、计分 RPC 或客户端入口，不改变现有同步载荷，不修改生产 Schema、不启用 Cron、不删除真实数据。以下保守策略是供评审的技术建议，不代替产品审批。

## 1. 当前事实与不可逆缺口

已阅读：`src/records.ts`、`dataTools.ts`、`syncRepository.ts`、`syncProtocol.ts`、`cloud/models.ts`、`supabase/sync-schema.sql`、`lifecycle-upgrade.sql` 及 `SYNC_PROTOCOL.md`。

| 现有位置 | 实际结构 | 不能证明的事 |
| --- | --- | --- |
| `Store` | `goal?: number \| null`；100–10000 的整数为开启，null 为关闭，undefined 是缺失 | 没有 goal 的旧数据不能推断成过去每天 2000；界面/实体默认值不是历史证据 |
| JSON 备份 v1 | `format/version/exportedAt/state`；仅 state.goal 当前值 | exportedAt 是客户端导出时间，不是目标设置时间；备份不含目标历史 |
| settings 实体 | `(user_id,'settings','settings')`，value 只有 `{goal}`，revision/cursor/updated_at 为当前版本 | updated_at 仅保留最后一次提交时间，不能恢复之前每一天的最后目标 |
| sync_receipts | 原始 request 与 applied response，含 mutationId/revision/cursor；没有逐条服务端确认时间 | 能恢复部分旧值及顺序，但不能证明这些值的北京生效日期；不能把保留下来的 receipts 当日历历史回填 |
| IndexedDB outbox | owner/sequence/mutationId/entity/entityId/expectedRevision/value | 设置没有业务事件时间或时间凭证；本机 sequence 不是服务端时间，mutationId 不是发生时间证明 |
| 冲突解决 | 保留本机时产生新的 mutationId、使用云端 expectedRevision；使用云端不产生新 settings 写入 | 不能把用户今天重试/选择的时间自动称为原离线设置日期 |

饮水事件的 `at` 与目标历史是不同事实。旧饮水记录即使有完整时间，也不能反推出当日目标。累计饮水等其他指标可后续按现有规则重算；目标完成天数只使用 `known=true AND goal_ml>0` 的日期。未知日期不计数，并需在 LB-03 展示“历史目标统计可能不完整”。

## 2. 拟议持久化契约

本地文件 `supabase/design/goal-history.prototype.sql` 使用带 `_draft` 后缀的私有对象，防止误认为已完成正式迁移。**禁止把这个文件直接应用生产。**

### 2.1 覆盖基线 `goal_history_baselines_draft`

| 字段 | 用途与约束 |
| --- | --- |
| user_id | Auth 用户外键；不新增账号，不因邮箱绑定重复建立历史 |
| cutover_at | 服务端观察/切换时刻，有限 timestamptz；原型可注入测试时钟，未来生产必须来自服务器 |
| baseline_from_day | 明确的保守基线覆盖起日；原型为切换时刻的北京日期 + 1；不把未完整观察的切换当天自动算作旧目标历史 |
| settings_revision / settings_cursor | 切换时读取的真实 settings 版本与账号游标；不存在设置时 revision=0、cursor=NULL |
| snapshot_updated_at | 原实体最后更新时间，仅作审计元数据，**不用它回填历史生效日期** |
| baseline_known / goal_ml | true+正数=已观察开启；true+NULL=已观察关闭；false+NULL=未设置/没有证据。不存在快照不补默认 2000 |

基线以 user_id 唯一。相同 cutover 重跑只读原基线，不因当前设置后来变化而重写；尝试用另一 cutover 重置覆盖边界被拒绝。生产回填还需批次登记和备份/核对方案，不在本轮执行。

### 2.2 不可变确认事件 `goal_history_events_draft`

| 字段 | 用途与约束 |
| --- | --- |
| (user_id,event_id) | 稳定的业务变更 ID，用户内唯一；不同账号可使用相同 UUID |
| mutation_id | 对应已 applied 的 settings receipt；复合外键绑定同一账号，用户内唯一 |
| settings_revision / sync_cursor | 从该 receipt 的确认读取，不接收客户端的最终版本；分别用户内唯一 |
| goal_ml | 已验证服务器接受的目标值；NULL 是明确关闭，不是未知标记 |
| source | server_observed / offline_unverified / legacy_write / backup_current；**只能由未来受信任服务端分支分类，不能相信客户端声称 source** |
| claimed_occurred_at | 可选客户端声称的发生/导出时刻，仅留审计，不能直接赋给 effective_day |
| server_confirmed_at | 首次接受该事件的服务端时刻；重试不改变；原型由 fixture 注入，禁止照搬为客户端 RPC 参数 |
| effective_day | 仅 server_observed 原型路径有值，从 server_confirmed_at 显式转 Asia/Shanghai date |
| uncertain_from_day | 无法验证发生日时的保守缺口起点，来源于服务端已有证据，不由 claimed_at 决定 |

表启用 RLS 且不向 anon/authenticated 授予任何表权限。原型 helper 均为非公开 schema 的 SECURITY INVOKER、空 search_path，并撤销 PUBLIC/anon/authenticated EXECUTE；只供隔离测试的可信操作者使用。没有 public RPC，没有前端模型接入。提供的写入口只有插入与严格幂等，不提供改写/删除历史入口；这不声称能防止数据库管理员直接改表。

外键在未来经审批的 Auth 用户删除时可级联移除私有历史，与现有生命周期一致；**定义级联不是本轮执行任何账号删除或清理任务**。当前 receipts 保留策略不变；未来若压缩 receipts，须先审阅审计外键和证明留存，不能随意删除来源证据。

## 3. 日期、最后目标和未知缺口

### 确定的约束

1. 所有生效日显式按 Asia/Shanghai 转换，与会话/设备时区无关。边界 UTC 16:00 是次日北京 00:00。
2. 同日以服务端确认的 settings revision 最大者为准，不使用客户端时间、随机 UUID 排序；同一服务端时间戳的两次确认仍由 revision 决定。
3. 目标从可信生效日延续，不把新目标回写到更早日期。null 关闭同样延续；再开启是另一个确认事件。
4. 失败 CAS 没有 applied receipt，因此不写历史。幂等重发原 mutation/event 只返回原证据，跨日重试不移动原日期；同一业务 ID 不可对应第二次成功变更。

### 保守原型策略（需评审）

- 现有当前值只形成基线，默认从切换后的第一个完整北京日沿用；不猜测设置的原始日期。切换当天若随后确有新的可信在线确认，可从该确认日建立新证据，并不需要等待次日。
- 单纯从候选集中忽略不可信离线/旧客户端事件是不够的：旧目标会被继续沿用，仍可能误计。所以原型同时记录未知缺口。
- 未验证变更的 `uncertain_from_day` 取此次 revision 之前最新的可信在线确认北京日；没有则取服务端 cutover 北京日。不能用声称的远古日期反向扩大/回写历史。该下界是**保守建议**：会舍弃部分本来可能有效的完成天数，需要明确接受统计不完整的代价。
- 查询某日时，在“基线起日/可信 effective_day/未知起日 <= 当日”的候选中选最大 settings revision。未知候选胜出则 known=false；之后新的可信目标只恢复其生效日及之后，不能补好此前缺口。
- 原型日目标查询允许未来日期仅供 fixture 验证沿用；**不是公开榜单函数**。实际聚合必须限制到服务器北京今天，不允许客户端传日期决定今日榜。

### 字段级样例（fixture A）

cutover = `2026-10-15T15:55:00Z`（北京 15 日 23:55），当前 goal=1500/revision=1。基线覆盖起日 16 日；14 日未知，15 日无新证据前也未知。

| settings revision | source | server_confirmed_at (UTC) | goal_ml | effective_day / uncertain_from_day | 结果 |
| --- | --- | --- | --- | --- | --- |
| 2 | server_observed | 15 日 15:58Z | 2000 | effective 15 日 | 当日新证据 |
| 3 | server_observed | 15 日 15:58Z（同一时刻） | 1800 | effective 15 日 | 同日最大 revision：15 日使用 1800 |
| 4 | server_observed | 15 日 16:00Z | NULL | effective 16 日 | 北京跨日关闭，不改变 15 日 |
| 5 | server_observed | 16 日 01:00Z | 1500 | effective 16 日 | 当天最后确认改为 1500 |
| 6 | offline_unverified | 17 日 01:00Z | 1000 | gap from 16 日；claimed=1999 年 | 16 日起未知；不把 1999 年写成已知目标，15 日仍是 1800 |
| 7 | server_observed | 18 日 01:00Z | 1700 | effective 18 日 | 18 日起恢复已知；17 日仍缺证据 |
| 8 | backup_current | 19 日 01:00Z | 1200 | gap from 18 日；claimed=2010 年 | 旧备份不是历史目标，18 日起保守未知 |
| 9 | legacy_write | 20 日 01:00Z | 1300 | gap from 18 日 | 当前私人设置仍可正常使用，不假装它的业务时间已被验证 |

`draft_goal_on_day` 返回 `{known,goal_ml,source,settings_revision}`，不是完成分数。对 known=false 的行返回 goal_ml=NULL，即使审计表保留原接受值，也不让调用方误用其计分。

## 4. 离线可信时间：不能通过 UUID 和客户端时钟解决

现有 v1 `{goal}` 无法区分在线设置、几天前离线队列和旧备份恢复；认证只证明用户是谁，**不证明设置发生在何时**。即使加入可签名的稳定 ID、设备签名或前端时间校验，也不能单独证明一个任意离线时间点。原型 `server_observed` 仅代表测试提供的可信在线证据假设，不能把普通旧 sync_apply 请求自动贴上这个标签。

供下一部分审阅的方案：

- 新协议使用稳定 eventId、claimedOccurredAt 和可选服务端观察凭证，凭证绑定 user/基准 settings revision/服务端 issued_at/有效范围/nonce，不把凭证当作最终目标分数。
- 服务端观察的开始与结束如果落在同一北京日，可在明确的业务约束下得到唯一生效日期；跨午夜的离线区间无法仅靠设备时钟辨别哪一天，需继续 unknown 或有额外在线时间证据。凭证签名只能证明签发内容，不能替离线操作提供可信时钟。
- 在线点击与服务器确认也可能跨午夜，原型把 server_observed 的确认时刻视为可信业务观察点只是待审假设，不能宣称已解决点击日与确认日差异。
- 不使用随意拍定的“允许回溯 N 天/客户端误差 N 分钟”作为已确认规则。这些窗口、跨日处理和拒绝/待核实体验仍需用户批准。
- 业务 eventId 和 transport mutationId 分离：失败冲突可重试，但只能有一个成功事件。用户今天明确选择“保留本机”是否作为**今天的新在线目标意图**，需确认；不能把今天的选择冒充过去的离线发生日。使用云端仅恢复本机状态，不凭空产生目标变更事件。

## 5. 兼容与未来迁移顺序（均未执行）

1. **扩展私有表**：审批后建立正式 baselines/events/时间证据结构、唯一键、索引、RLS 和撤权；先不开放公共读取。
2. **覆盖起点回填**：每用户锁后取得服务器观察时刻，并登记共同 rollout 批次（批次表待正式设计）；不得给后捕获的状态套用更早的统一时间。锁顺序沿用 auth.users → sync head → 历史行。已存在当前目标保存观察快照，缺失不补 2000；关闭为 known disabled。可重跑但不能重置基线。无效旧值先做数据体检，迁移校验失败须回滚并单列审阅，不能静默归一化或改原设置。源快照 updated_at 晚于观察时刻会拒绝，不能用未来源状态回填较早 cutover。部分迁移失败必须回滚/核对，不能“删掉再重建”。
3. **受控写路径（必须与第 2 项同批原子切换，不能留无日志窗口）**：新 v2 settings 写入在同一事务内完成现有 CAS、receipt、历史事件、可信时间分类。无法 capture 时整笔回滚，不能形成设置成功但历史丢失。现有 v1 载荷和旧缓存继续可用；所有旧 settings 成功写入须通过受信任 hook 标记 unknown/gap，不能悄悄当作在线事件。旧签名严格拒绝额外 effective_day 等字段。迁移应采用事务内切换，或受控 hook 在同一用户锁下懒初始化前值再记录新确认，剩余账号分批回填；不能先回填基线、数日后才装 hook。真实并发与批次重跑尚未验证。
4. **只读聚合接入**：LB-02 后续才由私有历史读取每日目标，目标完成仅 known 且正数时计入；用户/游客默认参加、公开投影、五榜及排序分页均不在本轮。
5. **客户端与备份升级**：另批新增本地业务事件及时间证据队列，不改旧存储键、不清数据；老备份仍能导入，但只提供当前设置，不能填充缺失历史。新版历史导出不能把签名/用户凭据作为跨账号可移植的历史证明。排行榜北京日期与现有个人本地日期展示分别保留。

### 本轮没有做的兼容承诺

- 没有改 v1 的 `{goal}`、TypeScript Store/EntityKind、JSON 备份版本或 IndexedDB 结构。
- 没有覆盖 sync_apply/sync_pull、生命周期 guard、现有 RLS；没有安装 trigger/hook。
- 原型私有 helper 使用调用者权限，不能直接作为将来给客户端 EXECUTE 的 RPC；真正公开入口必须重新验证 auth.uid/存活/归属，继续保留空 search_path 与最小权限。
- 脚本比较安装原型前后的原有函数定义并跑旧协议测试；这证明**当前实现不被原型改变**，不代表未来 hook/v2 集成已经安全。

## 6. 可重复测试

运行 `npm run test:goal-history`。只依赖已锁定的本地 PGlite，不读取 `.env`、不请求项目 URL、不调用 Supabase MCP、没有远程迁移入口。SQL 位置：

- `supabase/design/goal-history.prototype.sql`：隔离实例中的候选模型与可信 fixture adapter。
- `supabase/design/goal-history.test.sql`：完整 begin/rollback；同一个 PostgreSQL 实例连续执行 3 次，每次断言 Auth 用户、历史行和 receipts 均回到 0。
- `scripts/test-goal-history.mjs`：安装旧模型和 lifecycle，再安装原型；检查既有函数定义不变，追加旧 RLS/同步/lifecycle SQL 回归。

覆盖：当前值缺口、源快照不能晚于切换时刻、无效旧值失败不改源数据、不可重置 cutover、同日多次与同时间戳 revision、北京零点、关闭/再开启/沿用、重发跨日不挪日期、冲突失败无历史、同 eventId 重用拒绝、metadata 换内容拒绝、离线伪造远古日期、未知缺口与后续恢复、旧备份、旧客户端额外字段拒绝、跨用户 receipt 拒绝、anon/authenticated 表/函数撤权、会话时区改变不改变北京日期、fixture 全回滚、旧协议不变。

局限：PGlite 使用最小 Auth 模型，未证明托管 Auth 集成、真正多连接锁竞争、生产数据规模、查询计划性能或旧客户端 hook 的原子集成。这些属于 LB-02 后续和 LB-04；不运行真实数据清理测试。

## 7. 需要审批的迁移与剩余问题

**本轮不请求应用原型。** 下一步先评审本契约和字段级样例，再完成 LB-02 第 2 部分。正式生产迁移必须另给具体 SQL、hash/提交、数据范围、回滚/恢复方案和本地测试结果，取得明确批准后才可执行。

需分开审批：

- 正式历史基线/事件/时间凭证表、RLS/索引/外键及生产切换时点。
- 现有 settings 写入 hook / 新 RPC 的变更、旧客户端回退行为及原子回填。
- 覆盖起日是否接受保守的“切换次日”；同日新可信变更的例外；旧客户端/未验证离线变更造成的缺口下界是否接受。
- 离线跨北京零点的有效日证据、窗口、待核实流程；客户端导入和冲突重选如何记录新业务意图。

其他剩余工作：真实并发测试、批量回填与中断重跑、审计/receipt 保留、用户创建后的覆盖初始化、排行榜公开投影与隐私退出、五榜计算与稳定 20 人分页、午夜失效、客户端提示/备份升级。**Cron、生产真实数据删除和公开榜单发布均未授权也未执行。**
