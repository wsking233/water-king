# 大水之王 · Water King

面向手机触摸操作的饮水与嘘嘘记录应用。无需账号即可本机使用；配置 Supabase 后，「我的」可选择游客登录、自动恢复身份和修改云端昵称。默认不上传饮水与嘘嘘记录；云同步页面已接入验证开关，尚未正式开放。

## 日常使用

- 首页的水杯显示估计剩余水量。整个水杯展示区（杯子、两侧空白与剩余水量文字）均可长按，水位缓慢下降，松手保存；短点不记入，切到后台或手势取消会放弃未保存的变化。
- 杯子下方「嘬一口」增加 10 ml，剩余不足 10 ml 时只记剩余量；喝完后先「加满水」。
- 「加满水」恢复满杯，保留饮水累计，不把剩水计作已喝；满杯时按钮禁用。喝水或加满后可以撤销刚才的操作，下一次成功的数据/设置修改、跨页面数据同步或刷新会结束这次撤销机会；切换应用内页面不会结束。嘘嘘一键记录，随后可以撤销。
- 「我的」中设置杯子容量和每日目标。容量修改会开始新杯，已有记录保留；目标适用于今天及之后每天，也可关闭目标显示。
- 「记录」按日期、类型筛选，同一天同一杯汇总展示，展开查看饮水明细；支持补记、修改时间和水量、删除及撤销删除。没有杯子标识的旧记录独立展示。
- 「回顾」展示最近 7 天的饮水量、嘘嘘次数和记录天数，点击某天查看明细。未记录不代表没有发生。
- 「我的」支持 JSON 备份导出和恢复。恢复前校验文件并要求确认，导入会替换本机记录、杯子和目标，不会自动合并。

水量只是估计，不需要精确测量；目标与回顾不用于医疗判断。未加入提醒或联网排行榜。邮箱绑定、密码登录/修改/找回已接入默认关闭的验证入口，验证码邮件模板已由用户配置，真实邮件待验收；可用 `?email-preview=1` 打开本次页面的验收入口（[配置与步骤](docs/architecture/EMAIL_AUTH.md)）；30 天游客生命周期核心已在本地验证，生产迁移已获批准并应用，定时清理尚未启用。完整 V0.2 尚未发布。

## 数据与离线

默认本机模式仍使用同一个 localStorage 对象保存记录、杯子状态与目标，沿用旧存储键与备份格式。保存过程等待事务成功后才更新页面，失败不会显示成功；过期页面不能覆盖另一页面的新记录。原有饮水与嘘嘘数据自动读取，大便记录不再纳入展示。跨日保留杯中剩余水量，饮水累计按设备本地日期分别统计。编辑饮水记录的日期保留杯子关联，修改水量或删除会影响当前杯子；独立补记不扣当前杯子水量。

验证环境打开 `VITE_CLOUD_SYNC_PREVIEW=true` 后，游客可在「我的 → 设置云同步」查看目标账号和数据范围，并选择合并本机记录或仅恢复云端。取消不上传；确认后一次事务建立按账号隔离的 IndexedDB 快照与队列，原 localStorage 不删除。相同 ID 的不同内容会暂停接入；相同 ID 相同内容去重，云端墓碑不被旧数据复活。云端已有目标时沿用其目标，本机杯子保持独立。后续新增、编辑、删除和备份替换均入本机队列，联网或回到前台时补传；冲突会暂停并保留改动，不自动覆盖。入口、验证与限制见[页面接入说明](docs/architecture/SYNC_UI.md)。

首次联网打开后，等待「我的」显示“已准备好，可离线打开和记录”，之后可断网打开、记录和回顾。Service Worker 只缓存应用页面与静态资源。默认本机模式不会跨设备同步；验证模式下须在相同账号中明确接入，匿名游客本身没有换设备找回方式。系统清理网站数据可能移除本机记录、身份与离线缓存，请定期导出备份。

「我的 → 刷新应用」主动检查并应用已准备的新版本，再重新加载页面；不会删除记录。检测到新版时仅提示，不自动刷新。离线时不会跳转刷新。当前版本使用构建时 Git 提交短编号，开发环境显示「本地开发」。离线缓存仅在生产构建中启用。

## 本地开发

Node.js 24、npm：

```sh
npm ci
npm run dev
npm test
npm run test:lifecycle
npm run test:browser
npm run build
npm run preview
```

账号配置：复制 `.env.example` 为 `.env.local`，填写 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。仅接受 `sb_publishable_…` 公钥，禁止放入 secret/service_role 密钥。未配置时保留完整本机体验。GitHub Pages 构建从同名 GitHub Actions **Variables** 读取；仅配置 Supabase 控制台不会自动设置 GitHub 构建变量。`VITE_CLOUD_SYNC_PREVIEW` 默认为 false，真实 Auth、同步与生命周期完成验收前不正式开放。关闭开关不会删除已有账号快照与队列，也不会继续发出记录 RPC。

`npm run test:browser` 使用 `CHROME_PATH` 指定 Chrome/Chromium（默认 `/usr/bin/chromium`），自动在临时目录构建虚拟项目、启动临时服务并清理；不需要真实 Supabase 密钥，所有 Auth/REST 请求均由测试接管。覆盖迁移确认、合并、第二标签页、离线重开/补传、主动更新保留记录及正式开关关闭时不发 RPC。CI 使用 Ubuntu 镜像预装 Google Chrome 运行同一回归，再构建正式产物。

云端模型在 `src/cloud/models.ts`。`npm run schema:generate` 从 profile 模型生成 `supabase/schema.sql`，经授权的 Supabase 部署工具执行；浏览器不持有建表权限，TypeScript 类型声明本身不会建表。已部署 `profiles` 和私有同步模型/事务 RPC（`supabase/sync-schema.sql`）；同步 Worker 已接入验证页面，首次上传需要明确确认。模型和验证详见[同步协议](docs/architecture/SYNC_PROTOCOL.md)。两个 SQL 测试文件均在事务中验证权限及协议后回滚测试数据。

游客主动登录，不会因断网反复创建账号；会话凭证由 Supabase SDK 单独持久化，不进入 JSON 备份。昵称只展示给自己。清除网站数据或更换设备不能找回未绑定游客。页面接入已通过模拟服务验证，**真实服务、跨设备实测、账号切换入口、绑定、过期处理仍未完成**，不能将此阶段视为完整云同步版本。

使用 Pages 路径验证正式构建：

```sh
npm run build -- --base=/water-king/
npm run preview -- --base=/water-king/
```

## 架构

生命周期核心与受控迁移见 [LIFECYCLE.md](docs/architecture/LIFECYCLE.md)。`npm run test:lifecycle` 使用 PGlite 的本地 PostgreSQL 与最小 Auth 模型，运行权限、同步协议和生命周期 SQL 回归，不连接真实项目。用户明确批准后，`supabase/lifecycle-upgrade.sql` 已于 2026-10-16 作为受控迁移应用，触发器、RLS 和函数权限已核验；未启用清理调度或删除真实账号。新客户端在预览同步前要求 `account_status` 验证，旧 schema 会停止该轮而保留本机数据，不绕过生命周期检查。

Vite + React + TypeScript + CSS。前端状态与业务函数在同一项目中；Supabase 提供认证、私有表与事务 RPC。

- `src/main.tsx`：导航、记录流程、设置、备份与回顾界面。
- `src/CupControl.tsx`、`src/cupMotion.ts`：可取消的长按交互与水位变化。
- `src/EntryEditor.tsx`、`src/dataTools.ts`：补记编辑、备份校验与 7 天汇总。
- `src/DataGate.tsx`、`src/dataSession.ts`：身份与数据会话、首次接入确认、异步保存、跨页面通知及同步状态。
- `src/syncRepository.ts`、`src/syncWorker.ts`、`src/syncProtocol.ts`：IndexedDB 队列、原子首次迁移与分页合并、同步 Worker、账号隔离和冲突保留。
- `src/repository.ts`：记录与设置的统一访问接口，校验后原子写入原有本地存储，保留旧记录迁移路径。
- `src/records.ts`：本地数据校验、按日统计与按杯汇总。
- `src/AccountPanel.tsx`、`src/cloud/`：可选游客身份、昵称、公开配置与云模型。
- `src/offline.ts`、`vite.config.js`：离线注册、主动更新、构建时生成静态资源缓存清单。
- `public/`：主屏幕图标和 Web App manifest。

## CI/CD

每次推送 `main` 或手动运行 `.github/workflows/deploy.yml`，自动安装依赖、运行测试、检查 TypeScript、构建并部署 GitHub Pages。测试或构建失败不会部署，无需个人访问令牌。

预览：https://wsking233.github.io/water-king/

仓库使用公开 GitHub Pages，Settings → Pages 的 Source 为 GitHub Actions。修改仓库名时需要同步修改工作流里的 `--base`。

个人开发默认直接在 `main` 修改、提交和推送，不创建功能分支或 PR。设计以手机操作为准，电脑仅展示居中的手机宽度。

## 规划与协作

- [产品规格](docs/product/README.md)：游客账号规则、设计决策状态与其他系统设计提纲。
- [产品路线图](ROADMAP.md)：单机收尾、成就、用户与同步、排行榜、宠物的阶段目标和验收标准。
- [协作指南](agent.md)：多人、多 Agent 的任务边界、文件协调、数据约定与交接流程。
- [Agent 入口](AGENTS.md)：仓库的简要工作约定。

路线图是后续规划，当前记录仍保存在本机，账号基础与记录同步分阶段验收。
