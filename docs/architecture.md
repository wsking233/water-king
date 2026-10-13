# ADR-002：小程序优先，快速验证

日期：2026-10-14；替代 ADR-001 的独立 API + PostgreSQL 方案。

当前只运行 Taro 微信小程序，记录存设备本地，统计在客户端计算。保留 packages/domain 日期和统计逻辑，日统计使用 Asia/Shanghai。第一版不需要本地数据库、容器或服务端。

本地存储不能实现跨用户排行榜。需要此功能时采用微信开发者工具内的微信云开发（wx.cloud 体系）：云函数和托管文档数据库，不采用独立 CloudBase Web SDK 自定义登录方案。

只需 activities 与 profiles 两个集合。云函数从可信上下文获取 OPENID，不信任客户端传来的用户身份；本人才能访问和删除个人记录。写入按用户与 clientRequestId 去重。

周榜按不同记录天数降序，同分共享名次；只输出主动参与用户的昵称、天数和名次，个人饮水量和如厕明细不进入榜单。小规模先直接聚合，不引入缓存或微服务。

云资源尚未开通。开通时由用户确认套餐、服务条款及权限，再配置环境 ID、云函数与数据权限规则。

iOS / Android 延后，待需求验证后再决定。共享统计逻辑可复用，界面和身份绑定按平台适配。

参考：[微信开发者工具创建云环境](https://docs.cloudbase.net/quick-start/create-env)、[微信云开发与独立 CloudBase 的区别](https://docs.cloudbase.net/recipes/migrate-wxcloud-to-cloudbase)。
