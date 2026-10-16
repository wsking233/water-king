# 邮箱账号（WK-05）

2026-10-16：用户报告上一组人工验收通过，并确认首版采用邮箱验证＋设置密码、密码登录、修改和找回；手机号后续加入。该报告不代表尚未开发的绑定、冲突解决、清理并发已验收。

## 已接入的验证入口

`VITE_EMAIL_AUTH_PREVIEW=true` 时「我的」显示邮箱操作；默认 false，正式构建在邮件与真实 Auth 验收前保持关闭。该开关独立于记录同步预览，不会自动开放云同步。

- 游客通过 `updateUser({email})` 请求绑定，再输入邮件验证码，以 `email_change` 验证；必须返回原 userId 且已确认邮箱，才进入设置密码。不会调用 signUp 创建另一个账号。
- 已验证账号可以设置或修改密码，安全要求由 Supabase 服务端执行；密码仅存在表单内存，不写存储、日志或备份。
- 密码登录切换目标账号；当前账号快照和 outbox 保留原归属，不自动合并。邮箱已被占用时说明如何登录，不把游客数据覆盖到已有账号。
- 找回密码发送 recovery 邮件，输入验证码后获得目标账号身份，再设置新密码；验证前明确告知切换和数据隔离。
- 邮箱请求及密码修改使用不持久化的独立 Auth 客户端，固定操作开始时的身份，避免其他标签页切换导致改写另一账号。服务端仍执行真实用户校验与游客过期触发器。
- 网络失败、错误密码、过期验证码、频率限制不会删除本机记录；未完成的密码流程可重新从账号页设置密码。

## Supabase 控制台准备

此前 Provider、URL Configuration、Publishable Key 已完成，无需重做。新增的验证码体验还需：

1. 在 Authentication → Email Templates 的 **Change Email Address** 和 **Reset Password** 模板加入 `{{ .Token }}`。本客户端使用输入验证码流程，`detectSessionInUrl=false`，不消费邮件跳转链接。模板建议正文：

   ```html
   <p>你的水王邮箱验证码是：</p>
   <p><strong>{{ .Token }}</strong></p>
   <p>请返回水王输入验证码。若非本人操作，请忽略，不要转发验证码。</p>
   ```

2. 核对邮箱确认开启、匿名账号允许绑定；Supabase 文档说明匿名账号转正需要允许 manual linking。不要关闭确认来绕过验证。若提示 linking disabled，在身份提供商设置中开启对应能力。
3. 确认当前邮件服务允许给实际测试邮箱发送。内置发信服务的收件人及频率限制可能影响测试；面向普通用户前配置自己的 SMTP，并核对费用。
4. 核对密码强度配置；当前 Advisor 的泄露密码保护警告仍未处理，按项目套餐能力配置。前端不会伪称已启用。
5. 邮件和真实操作全部通过后，再在隔离验证构建开启 `VITE_EMAIL_AUTH_PREVIEW`，验收后决定正式开放。

## 验收

自动化：`npm test`；`npm run test:email-browser`（320px Chromium，模拟 Auth 请求，不实际发邮件）；既有 `npm run test:browser` 保持同步与离线回归。

真实邮件待验收：游客绑定前后 ID 不变、未验证仍为游客、已占用邮箱不覆盖账号、错误及过期验证码、密码设置/修改/登录、找回邮件及新旧密码行为、刷新恢复、两标签页切账号期间操作不串身份、两设备恢复及本机队列隔离。邮件验证码有效期和发送频率遵循项目服务端配置。

账号退出、已有游客数据向另一绑定账号的显式合并、冲突解决、过期后新建游客/重新导入、主动删号不在本次新增入口内，仍待后续开发或产品决策。

参考：[匿名账号转正](https://supabase.com/docs/guides/auth/auth-anonymous)、[密码认证](https://supabase.com/docs/guides/auth/passwords)、[验证码验证](https://supabase.com/docs/reference/javascript/auth-verifyotp)。
