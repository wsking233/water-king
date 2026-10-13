# 大水之王 · Water King

私人项目：记录饮水量、如厕频次，并提供自愿参与的记录天数排行榜。微信小程序优先，后续评估 iOS / Android。

## 技术架构

- 客户端：Taro 4 + React 18 + TypeScript，先编译为微信小程序。
- 服务端：Fastify + TypeScript，独立 REST API，供所有客户端使用。
- 数据库：PostgreSQL；初期直接 SQL 聚合，无需 Redis 或微服务。
- 代码组织：pnpm workspace；`packages/domain` 共享类型、日期及统计规则。
- 扩展：后续评估 Taro React Native；也可新增 Expo 客户端，复用 domain 与 API。平台登录、存储和界面需要适配，不能保证原样编译。

详见 [架构决策](docs/architecture.md)、[接口规划](docs/api.md) 和 [开发路线](docs/roadmap.md)。

## 当前完成范围

这是项目初始化骨架，不是可上线的完整应用。

- 小程序本地演示：250 ml 饮水记录、小便/大便计次、今日统计、撤销最近记录；数据存在设备本地。
- 共享统计逻辑及测试；Asia/Shanghai 日期边界。
- API 健康检查；业务路由返回 501，尚未实现认证、数据库读写、云同步和真实排行榜。
- 数据库初始化 SQL、开发数据库 Compose、GitHub CI。

## 本地开发

要求 Node.js 24、pnpm 10.11.0、微信开发者工具；数据库开发另需 Docker。

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm dev:mini
# 另一个终端
pnpm dev:api
```

微信开发者工具导入 `apps/miniapp`，编译输出在其 `dist` 目录。`touristappid` 用于初始化预览；真实登录和上传需要替换为自己的小程序 AppID。首页使用本地数据，尚不调用 API。

```sh
docker compose up -d db
curl http://127.0.0.1:3000/health
```

Compose 会在新数据库卷首次启动时执行初始化 SQL；已有数据库需要显式运行后续迁移。示例密码仅用于本地数据库。API 当前无需环境文件；接入数据库/微信登录时再加载 `.env` 并验证配置。

## 部署方向

小程序通过微信开发者工具上传和审核；API 使用容器部署在中国大陆可访问的服务环境，数据库采用托管 PostgreSQL。上线前需要 HTTPS 域名、小程序合法请求域名、真实 AppID、服务端密钥、隐私说明及认证/权限检查。具体域名与备案条件按届时实际部署环境确认。

代码仓库保持 Private，不添加开源许可证。任何密钥和真实用户记录都不能提交到 Git。
