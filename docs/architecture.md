# 架构决策 ADR-001

状态：采用；日期：2026-10-13。

## 选择与理由

采用 Taro + React + TypeScript，Fastify API，PostgreSQL，pnpm monorepo。
微信原生小程序可快速开始，但未来复用界面的空间较小；Flutter 在小程序端需要额外方案；Taro 对微信小程序支持直接，且官方支持 React Native。跨端可复用业务代码，并不意味着所有微信 API 和 UI 都自动适用于原生端。

独立 API 避免把业务逻辑绑定到微信云函数调用方式。CloudBase 是更省运维的候选方案；本项目优先考虑未来多客户端、身份映射和关系型统计，因此选择标准 API + PostgreSQL。初期不引入 Redis、队列和复杂服务拆分。具体托管商、费用和区域留到部署时决定。

```text
微信小程序（Taro） ── HTTPS REST ── Fastify ── PostgreSQL
未来 iOS / Android ──────┘             │
                                微信登录服务
packages/domain：共享类型与统计规则
```

## 身份与权限

微信客户端使用 wx.login code，服务端交换身份，随后签发自己的短期会话。AppSecret、session_key 和数据库连接信息只保留在服务端。内部用户 ID 与微信 openid 分离；identity 以 provider + app_id + subject 唯一，未来增加原生登录身份，并通过已认证的绑定流程关联账户，不能用昵称合并。

所有业务读写均从会话获取 user_id，不能接受客户端任意 user_id。排行榜仅输出主动参与用户的昵称、记录天数和名次。个人如厕时间、次数与饮水原始数据不进入排行榜响应。以后须实现限流、会话撤销、日志脱敏、数据导出和账号删除。

## 数据与排名

饮水以整数 ml 存储；如厕区分 urination/bowel。occurred_at 使用 timestamptz，服务端校验时间及范围。日统计统一以 Asia/Shanghai 计算，当前版本不跟随设备时区变更。

写入时客户端生成 UUID client_request_id，数据库按用户去重，实现断网重试幂等。初始化 SQL 已包含去重约束，但同步流程尚未实现。删除采用物理删除，并重算统计；账号删除级联清理。

默认周榜按本周有记录的不同自然日数量降序，同分共享名次，用户 ID 仅用于稳定排序。周一 00:00 开始，周末结束，按 UTC 查询半开时间区间。榜单查询只统计 opted-in 用户，退出后立即消失。若以后增加饮水量/如厕次数娱乐榜，需要独立选择参与和展示范围，不能默认暴露。

## 参考

- [Taro 跨端能力](https://docs.taro.zone/)
- [Taro 编译配置](https://docs.taro.zone/docs/config/)
- [Fastify TypeScript 文档](https://fastify.dev/docs/latest/Reference/TypeScript/)

以上是技术选型参考；业务规则是本项目的初始设计，可在开发阶段调整。
