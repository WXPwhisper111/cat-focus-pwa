# V0.2.1 邮箱认证与跨设备验收

这是本地开发工具，不是正式账号入口。`/auth-test` 由 Vite `configureServer` 提供独立 HTML，未引用主应用入口。生产构建和 `vite preview` 不提供此认证页（SPA 回退时可能显示原应用，而不是 404）。未改动 IndexedDB、计时、钱包、签到、猫咪、家具或业务数据库。本阶段没有业务数据同步。

## 配置和启动

在 `D:\MyDesktopPet\cat-focus-pwa` 的 `.env.local` 填写：

```dotenv
VITE_SUPABASE_URL=https://pvmoyaxkraelgdvozcrg.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=填写你的公开密钥
```

密钥从 Supabase 项目的 API Keys 设置获取，必须是 `sb_publishable_` 开头的 Publishable Key。此值会提供给测试浏览器。不要填写 Secret Key、service_role、数据库密码或 Resend API Key。`.env.local` 已被 Git 忽略；`.env.example` 只有 URL 与空密钥。编辑后重启开发服务器。新环境可复制 `.env.example`，不要覆盖已有本地配置。

```powershell
cd D:\MyDesktopPet\cat-focus-pwa
npm ci
npm run dev -- --port 5173 --strictPort
```

电脑打开 `http://localhost:5173/auth-test`。原应用仍在根路径。不要用 `npm run preview` 测认证。

Android 手机连接与电脑相同的 Wi-Fi，在 Chrome 浏览器访问 `http://<电脑的 WLAN IPv4>:5173/auth-test`。本次检查 WLAN 地址为 `10.40.185.106`，可先试 `http://10.40.185.106:5173/auth-test`；IP 变化后运行 `ipconfig` 重新查询，不使用 Radmin VPN 地址。Vite 的现有 dev 命令已监听 `0.0.0.0`。若连不上，检查 Windows 专用网络防火墙是否允许 Node 的 5173 入站、Wi-Fi 客户端隔离，以及双方是否处于可互访网络。不要关闭整个防火墙。

此页不注册 Service Worker，局域网 HTTP 仅用于认证操作测试，不用于 PWA 安装或离线验收；只在可信局域网使用。需要 HTTPS 时复用 README 的本地证书流程，以及现有 `CAT_FOCUS_TLS_CERT` / `CAT_FOCUS_TLS_KEY` 配置，并把访问地址改为 HTTPS。不要打开生产环境来测试此页面。

## 双设备完整验收

1. 电脑打开测试页。未配置时应显示配置提示；配置正确时应恢复会话或显示“未登录”。
2. 输入邮箱，点击发送。等待邮件，填写最新六位数字验证码，点击验证。应显示“已登录”、邮箱与 UID。记录 UID 即可，不复制令牌。发送按钮有 60 秒冷却，服务端可能要求等待更久。
3. 刷新电脑页面，邮箱与 UID 应保持。不要清除浏览器站点存储，不使用退出即清数据的隐私窗口。
4. Android Chrome 打开上述局域网网址，输入**完全相同的邮箱**，重新发送验证码，再使用此次收到的最新码登录。两台设备按顺序验证，避免新码使旧码失效；不要在手机复用电脑已消费的码。
5. 对照两端 UID，必须逐字相同。刷新手机页面，邮箱与 UID 应保持。这个结论只说明同一 Auth 用户，不代表任何业务数据同步。
6. 在电脑点击“退出本设备登录”，邮箱与 UID 应变为“—”；刷新电脑仍未登录。刷新手机应仍登录且 UID 不变。电脑重新登录后，在手机退出并刷新，再确认电脑仍登录。
7. 关闭并重新打开同一浏览器、相同协议/域名/IP/端口的测试页，检查持久化。`localhost` 和局域网 IP 是不同源，会话不会共享；同一浏览器的同源标签页会共享会话，不能把它们当作两台设备。
8. 检查错误路径：不足六位数字不能提交；错误或超过 600 秒的码应提示并允许重试；连续发送会冷却，服务端限流应提示等待；断网提交应提示失败，恢复网络后可重试。若请求失败，不自动重复发信。
9. 打开原 PWA，检查原有计时、猫咪和本地记录。测试页不导入业务存储代码，不应改变这些数据。

SDK 使用 `persistSession: true`、`autoRefreshToken: true` 和独立 `cat-focus-auth-test-session` 存储键；刷新通过 `getSession()` 恢复，状态通过 `onAuthStateChange` 更新。退出明确使用 `signOut({ scope: 'local' })`，避免全设备登出。若退出请求失败，页面显示错误并保留状态供重试。会话令牌由 SDK 存入浏览器本地存储，界面和应用日志不输出验证码或令牌；勿分享浏览器存储/网络请求截图。

## 验证范围

自动交互测试使用模拟 Auth 客户端，覆盖请求参数、六位码校验、重复提交、限流、错误、会话恢复、状态更新与 local 退出。它们不能替代真实邮件、SDK 持久化或 Android 双设备验收。未填写公开密钥、未实际操作手机之前，不宣称真实跨设备登录已通过。

生产检查：运行 `npm test`、`npm run build`；检查 `dist` 中没有认证测试入口、`cat-focus-auth-test-session`、Supabase SDK 或项目 URL。正式部署仍只使用 `dist`，不发布项目源码目录。本轮不执行部署命令。

自动测试包含读取生产产物的分发检查；新环境应先 `npm run build` 再 `npm test`，不要同时运行两条命令，以免测试读到重建中的文件。响应式布局已在桌面浏览器及 360 像素模拟视口检查；这不等同于真实 Android 登录验收。

## 本轮验收记录（2026-10-25）

- 用户填写公开配置后，按前述电脑与 Android 双设备流程实测，并反馈“已经完成测试，没有出现问题”。真实邮箱 OTP 登录与双设备验收结果以此次用户反馈记录。
- 全量自动测试：66 个测试文件、332 项测试通过；类型检查和生产构建通过。
- 用户已确认 V0.2.1 验收通过，并授权在本地 `feature/supabase-auth-test` 分支提交本阶段代码与验收记录；不推送 GitHub、不合并到 `main`、不执行正式部署。

## 测试结束后移除

先在两台设备分别点击退出，再关闭测试页与开发服务器。删除 `src/dev/auth-test.ts`、`src/dev/auth-test-view.ts`、`src/dev/auth-test.css`、`scripts/auth-test-dev.ts`、`tests/auth-test.test.ts`、`tests/auth-test-isolation.test.ts`；从 `vite.config.ts` 删除 `authTestDev` 导入和插件调用。删除文档、README 链接与 `.env.example` 中不再需要的测试配置，从 `.env.local` 仅移除本次两项配置（保留其他配置）。若后续未使用 SDK，执行 `npm uninstall @supabase/supabase-js`，重新运行测试与构建。不要清空 localStorage、IndexedDB 或站点数据；如果只需去除残留认证会话，仅移除当前测试源的 `cat-focus-auth-test-session` 键。

参考：[Supabase 邮箱 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[仅当前会话退出](https://supabase.com/docs/guides/auth/signout)。
