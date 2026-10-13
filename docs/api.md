# REST API 规划（尚未实现）

前缀 `/v1`，JSON，Bearer 会话认证。实际可用端点只有 `GET /health`。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | /auth/wechat | code 交换平台身份，建立内部用户会话 |
| POST | /activities | 写入单条记录，clientRequestId 保证重试幂等 |
| GET | /activities | 当前用户记录，游标分页与时间过滤 |
| DELETE | /activities/:id | 仅删除自己的记录 |
| GET | /me/summary?day=YYYY-MM-DD | 自己的日统计 |
| PATCH | /me | 昵称及 leaderboardOptIn 设置 |
| GET | /leaderboard?period=week | 自愿参与的周记录天数榜 |
| GET | /me/export | 导出自己的数据 |
| DELETE | /me | 删除账号和记录，撤销会话 |

记录字段：`clientRequestId` UUID、`kind` water/urination/bowel、`occurredAt` 带时区 ISO 8601。water 需要 `amountMl` 整数 1–2000；其余类型不得有该字段。这里只是输入约束，不代表饮水建议。

错误格式 `{ code, message, requestId }`；401 未认证，403 无权限，404 不存在或非本人资源，400 输入无效，429 限流。重复请求应返回既有记录；同一请求 ID 但不同内容应返回 409。服务端拒绝过远未来时间，并限制补录窗口（具体窗口待产品确定）。

实现前应增加路由级测试：跨用户隔离、身份交换失败、重复写入、删除后统计、退出排行榜、同分名次、周边界。
