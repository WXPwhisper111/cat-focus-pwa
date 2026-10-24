# 猫咪日常动作与更新弹窗验收

日期：2026-10-24。交付方式：仅本地提交，不推送 GitHub，不部署 Vercel。

## 实现

- 六只猫共享现有播放器，在完整 idle 周期边界根据集中配置的 10–20 秒阈值播放一次伸懒腰，再恢复 idle。不新增 RAF 或每猫等待定时器；主要行为和手动操作优先。等待阈值之后仍需等当前 idle 周期结束。
- 伸懒腰接入 clip 独立展示缩放与锚点，保留世界脚底及接触点含义。猫咪资源归属由播放器校验，cat-01 映射 orange-white。
- 小屋及专注页睡眠使用 Zzz 气泡；专注页点击或键盘激活可抚摸一次，重复点击不叠加。每秒界面更新不重启动作，暂停仍显示睡眠，离页及后台清理临时播放和气泡。
- 上厕所仅自主触发：首次资格 60–90 秒，完成或中断后冷却 120–180 秒，选择权重为普通动作的四分之一；厕所单占用，计入两个主要行为并发上限。
- 如厕使用真实淡出完成事件后隐藏猫、影子、名称和点击层，排除原位置占用；右下角气泡跟随 wcExit 配置。前台等待 6 秒后回自己的地毯淡入；手动指令可结束等待，直接在新目标淡入。传送、失败、暂停、切页和销毁均有可见恢复与占用清理。
- 实现暖橙浅杏色更新弹窗、版本关联的用户版说明、稍后/前往更新、签到和活动会话优先、按构建版本提示去重、跨标签页同步及设置页长期说明入口。
- 更新说明由 release-notes.json 维护，经现有 SW 状态消息与目标构建一起返回；旧消息缺少说明时安全降级，不把当前版本文案冒充新版内容。首次已是最新版不弹提醒。旧客户端须先通过原有入口更新一次，才能获得新版弹窗能力。
- 普通 dialog 点击外部遮罩可关闭，通过原取消事件执行清理和焦点恢复，防止内向外拖动误关闭及点击穿透；更新提示弹窗排除。购买/导入进行中的取消保护保留或补齐。安装大图中点击遮罩关闭整个教程，Esc 保留返回步骤行为。

## 素材实测

- 6 段、108 个帧位置；每段 18 帧、3600ms、单次播放。
- Pillow 解码全部源 PNG 和移动 WebP，验证 1254×1254 / 288×288、RGBA 透明通道、帧时长与首尾一致，并核对注册待机首帧。未重绘或生成新素材。
- 原移动帧 3,421,898 字节；按内容哈希导出后 102 张唯一 WebP，3,234,830 字节。保持全部帧位置与时长。
- 新运行目录另含一份清单，103 个新增资源进入现有媒体缓存。源图、预览及旧素材保留在原位置，不加入该运行目录。

## 实际运行结果

- npm test：60 个测试文件、295 项通过，未删除旧测试。
- npx tsc --noEmit：通过。
- npm run build：通过。JS 350.95KB（gzip 88.33KB），CSS 46.93KB；核心 16 文件、媒体 838 文件；最终构建 9b5825a3e62b。
- git -c core.whitespace=cr-at-eol diff --check：通过。
- 新增/扩展测试覆盖真实资源映射及显示锚点、idle 周期与单一 RAF、手动抢占、重复抚摸、暂停恢复、pagehide 清理、Zzz 和改名同步、如厕独占/自然结束/手动切换/失败/后台恢复、更新优先级/去重/旧消息及存储失败、遮罩取消保护和大图关闭。
- Edge 无头隔离浏览器：320×690、390×840、430×840 模拟视口均通过；更新弹窗外部不关闭、普通弹窗外部关闭、Zzz、如厕隐藏及手动返回、伸懒腰解码并恢复、专注页抚摸、无横向溢出或页面异常。430px 另验证如厕自然结束后完全淡入，再接受下一次动作。
- 实际应用页面：新用户六选一、铃铛领养、点击抚摸、倒计时暂停、刷新恢复暂停会话/主陪伴，以及入住管理点击遮罩关闭。
- 最终生产构建浏览器：真实 Service Worker 返回 cat-life-v1 说明，设置可查看；首次安装和刷新均不误弹新版提醒；无页面异常。见 production-browser-results.json。
- 更新弹窗的“旧版发现新版”视觉通过 ui-check.html 内明确标记的模拟控制器验收，不冒充线上真实更新；控制器及 worker 版本关联另有自动化测试。
- 内置浏览器工具初始化失败，改用本机已安装 Edge 的独立无头进程，不使用现有浏览器档案或用户 IndexedDB。未安装新前端依赖。
- 开发环境验收曾被 HMR 重载打断；固定代码后重跑通过。如厕自然结束测试也修正为等待淡入/idle 完全恢复后再启动下一动作。

## 文件职责

- scripts/prepare-cat-stretch.py、art/cat-stretch-v1/runtime.json、public/cat-stretch-v1：真实素材校验、去重及运行清单。
- src/cat-stretch.ts、cat-animation.ts、cat-player.ts、focus-cat.ts：伸懒腰配置、注册几何、原播放器复用、专注页互动与生命周期。
- src/cat-pet-feedback.ts、room-scene.ts、room-scene.css：爱心/Zzz/厕所反馈、显示/隐藏及坐标。
- src/room-behavior-config.ts、room-behavior.ts、room-autonomy.ts、cat-teleport.ts：如厕配置、执行、独占、调度和单阶段淡入淡出。
- release-notes.json、src/release-notes.ts、update-dialog.ts、app-update.ts、app-update-view.ts、app-update.css、scripts/generate-sw.mjs、sw-runtime.js：发布说明、更新弹窗、消息兼容及资源筛选；不改变现有缓存保留、更新完整性或离线恢复策略。
- src/dialog-dismiss.ts、main.ts、pwa-install-view.ts、cat-shop.ts、data-manager.ts、AGENTS.md：统一外部取消入口、原业务事件接线、关闭保护及后续规范。
- tests/cat-life.test.ts、update-dialog.test.ts 和现有更新/安装/自主行为/执行器测试：本轮验收断言。
- 本目录 ui-check.html、browser-check.mjs、production-browser-check.mjs、结果 JSON 和截图：可复用的隔离验收材料，不进入产品发布目录。

## 兼容与未验证事项

- IndexedDB v6、JSON 备份 v9 保持不变；不修改专注结算、钱包、签到奖励、任务模型或所有权/入住数据。
- Windows Edge 无头模拟不等同于 Android Edge/Chrome、iOS Safari 或主屏幕 PWA 实机。真实触屏、系统键盘/返回手势、系统后台回收及慢设备动画观感仍待手机实测。
- 未进行 GitHub 推送或 Vercel 部署；本地提交结果见交付回复。此前 b3bc9b4 素材提交保留，不 amend、不重写历史。

## 重跑浏览器检查

使用已有 Playwright 开发工具，通过 CAT_FOCUS_PLAYWRIGHT_PATH 指向其包目录；不属于应用运行依赖。启动 127.0.0.1:4236 的 Vite 开发服务后运行 browser-check.mjs；生产构建预览在 4237 时运行 production-browser-check.mjs。测试使用临时隔离上下文，结束后关闭浏览器，不读取真实用户档案。
