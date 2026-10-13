# 大水之王 · Water King

私人微信小程序：记录饮水量与如厕次数，先验证体验，再加入多人排行榜。

## 第一版架构

Taro + React + TypeScript → 微信小程序 → 设备本地存储。

无需独立服务端、PostgreSQL、Docker 或 WSL。保留小程序与共享统计逻辑两个工作区，方便以后复用。

已实现：250 ml 饮水记录、小便/大便计次、今日统计、撤销最近记录。数据仅在当前设备，清理小程序数据或换设备不会自动恢复；排行榜尚未实现。

多人排行榜阶段使用微信开发者工具内的微信云开发：云函数 + 托管文档数据库。云开发尚未开通或接入。按记录天数排名、主动选择参与，个人如厕明细不向他人开放。

## 本地开发

只需 Node.js 24 LTS、pnpm 11.25.0、微信开发者工具；VS Code 可选。

```sh
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

开发者工具导入 apps/miniapp，输出目录为 dist。touristappid 用于演示；上传体验版需要真实小程序 AppID。

```sh
pnpm test
pnpm typecheck
pnpm build
```

## 快速发布

先在开发者工具验证记录体验，再配置真实 AppID、上传体验版，邀请少量用户试用。确实需要多人排行榜时才开通云开发，套餐和费用按开通页面确认。正式发布仍需隐私说明及微信审核。

详见 [架构决策](docs/architecture.md) 和 [开发路线](docs/roadmap.md)。仓库保持 Private。
