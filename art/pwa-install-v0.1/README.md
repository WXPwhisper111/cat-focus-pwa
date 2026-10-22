# PWA Install UX V0.1

日期：2026-10-22。

## 修改文件

- src/pwa-install.ts：单例安装能力控制器，真实安装事件保存和消费、安装观察状态、独立运行检测、一次提醒与跨标签同步。
- src/pwa-install-view.ts：设置卡片、八种浏览器教程、可访问弹窗、内嵌提醒及焦点恢复。
- src/pwa-install.css：暖橙浅杏色局部样式，44px触控区域、窄屏与安全区域滚动。
- src/main.ts：初始化前创建控制器；设置和专注页挂载独立视图；只在有效结算确认后标记提醒资格。安装状态更新不重建计时表单或猫咪播放器。
- index.html：apple-touch-icon引用现有icon-192.png。
- tests/pwa-install.test.ts、tests/pwa-install-view.test.ts、tests/pwa-install-integration.test.ts：新增12项能力、UI与真实入口集成测试。
- 本报告、README.md及截图：使用说明和验收证据。

## 检测与流程

首次访问不会自动打开安装指引或调用安装提示。设置页长期提供“添加到手机桌面”卡片。

beforeinstallprompt只在具备prompt方法时保存；用户点击“安装到桌面”后在原点击调用栈内调用prompt，立即消费该事件并防重。优先读取userChoice，取消、异常均回到手动方案；accepted不直接当成已安装成功。

appinstalled、display-mode standalone/fullscreen/minimal-ui及iOS navigator.standalone用于实际状态观察。没有事件不代表不支持安装。localStorage按来源保存 cat-focus:installed-v1 与 cat-focus:install-reminder-v1，不写IndexedDB、不进入备份。

已观察到安装或独立运行时不推广再次安装，但设置仍允许查看教程。浏览器不能可靠探测系统中的卸载情况；若后来收到新的真实安装事件，会清除历史安装观察标记并重新允许原生按钮。

正计时保存、倒计时完成或提前结束保存的正时长记录，在用户确认关闭结算后才有提醒资格；放弃和导入记录不触发此入口。活动会话、其他弹窗、其他导航及后台会阻止展示，必要时延后。提醒显示前保存一次性标记；关闭、查看或离开后不再重新推广。无法持久化标记时跳过提醒，设置入口仍正常。storage事件同步其他标签页关闭状态。

## 平台指引与备用路径

八项均可手动切换：通用Android、华为、小米、OPPO、vivo、夸克、iOS Safari、其他。

- Android及各品牌：仅建议查找“添加到桌面”“添加到主屏幕”“安装应用”或类似菜单，明确设备和版本差异；可能生成网页快捷方式，不保证独立PWA窗口。
- iOS/iPadOS：默认Safari教程，参考分享菜单中的“添加到主屏幕”，不写死按钮位置。
- 其他浏览器：通用菜单/地址栏入口建议，并建议必要时用系统浏览器或Safari。
- 全部保留继续网页版、添加书签/收藏、设置中重新查看指引的路径。安装提示失败不作为应用错误，不申请通知权限。

参考：
- https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event
- https://support.apple.com/es-us/guide/iphone/iphea86e5236/27/ios/27

## 实际测试

- 最终npm test：50个文件、244项全部通过；包括12项新增测试和现有业务回归。
- 最终npm run build：通过，含TypeScript检查、Vite构建、SW生成。最终资源为 index-1jfnaHOu.css 与 index-Bzv6KjoG.js。无独立lint脚本。
- 开发中曾发现测试类型标注及焦点回退选择顺序问题，均已修复；未删除旧测试。
- 模拟事件测试：同步调用prompt、重复点击防重、userChoice、拒绝/异常、appinstalled、独立运行、历史状态修正、八类教程、iPad桌面UA、一次标记、存储写失败、跨标签存储事件、销毁清理。
- 入口集成：正计时保存后结算未确认时无提醒；确认后有提醒；关闭后不再推广。打开/关闭设置指引保持活动会话、记录、钱包、猫咪所有权及导航，统计页仍可用。
- 生产浏览器预览使用隔离4214/4215来源，未操作用户4195数据。人工验证设置入口、无原生事件时手动指引、华为/Safari/夸克教程切换、继续网页版、设置入口焦点恢复。
- 320×568视口：页面可用宽305、滚动宽305；弹窗内容宽251、滚动宽251，高度543、内容高923，内部可滚动且无横向溢出。
- 360px视口：页面宽345、滚动宽345，弹窗内容宽291、滚动宽291；844×390横屏弹窗520宽、366高，位于视口内。390px视口截图已保存。
- 另一个全新来源人工完成正计时11秒保存→确认结算→出现内嵌提醒→查看指引后隐藏→刷新不再出现。没有伪造专注时间或发币。
- 最终生产构建 index-Bzv6KjoG.js 已在浏览器加载并保存android-390.png。轻提醒入口关闭后的计时按钮焦点回退修正有自动测试；该最终分支未重新进行手机人工测试。
- 已检查192/512图标及最终JS/CSS都在生成的预缓存清单。没有改Service Worker脚本生成规则或manifest；只新增apple-touch-icon引用，不制作新素材。

## 实机待验证

以下均未进行手机实机安装，系统和浏览器具体版本需由后续测试记录，不能据此宣布兼容成功：

| 浏览器 | 待记录信息 | 待验证事项 |
| --- | --- | --- |
| 通用Android/Chrome | 机型、Android及浏览器版本 | HTTPS原生安装、独立启动、重开 |
| 华为浏览器 | 机型、HarmonyOS/Android及浏览器版本 | 菜单入口、快捷方式/PWA差异 |
| 小米浏览器 | 机型、HyperOS/Android及浏览器版本 | 菜单入口、添加桌面 |
| OPPO浏览器 | 机型、ColorOS及浏览器版本 | 菜单入口、添加桌面 |
| vivo浏览器 | 机型、OriginOS及浏览器版本 | 菜单入口、添加桌面 |
| 夸克浏览器 | 机型、系统及夸克版本 | 菜单入口、桌面快捷方式 |
| iOS Safari | iPhone/iPad机型、iOS/iPadOS版本 | 分享菜单、主屏幕图标、standalone |
| 其他浏览器 | 系统及浏览器版本 | 手动备用路径、书签 |

原生安装和appinstalled是自动模拟事件测试，不是这些手机浏览器的真实安装验证。真实双标签页、断网安装/离线重开、系统安全区域与屏幕阅读器本轮未实测。

## Git与数据边界

实施初检查git status时未发现仓库；最终只读检查时当前项目已存在Git仓库，分支main，origin为https://github.com/WXPwhisper111/cat-focus-pwa.git。本任务没有初始化或配置Git。按用户要求，未暂存、提交、推送或发布。最终待改动文件均属于本阶段；原有代码和素材未清理。

数据库schema/版本、JSON备份格式、专注算法、经济、签到、商城、猫咪行为均未修改。

## 后续微调：导航图标与安装入口置顶

- 用户授权将本阶段安装引导与微调一同提交推送。
- 专注与设置导航由字符图标改为原生内联SVG秒表、齿轮，复用原有26px、currentColor和线条样式；统计与小屋图标不变。
- 安装卡片移动到设置页标题下方，成为第一张功能卡片。
- 修改 src/category-icons.ts 与 src/main.ts；截图 settings-top-390.png 为390px模拟视口生产预览，非手机实机。
- 微调后全量244项测试及类型检查、构建均通过；生产资源 index-Cwxlajbp.js。
- 提交前已确认main与origin/main同为2299a0d，远程为已确认的WXPwhisper111/cat-focus-pwa。实际提交和推送结果见本轮交付回复。
