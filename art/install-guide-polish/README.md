# 安装图文指引与设置页布局优化

## 修改与职责
- src/install-guide.ts：平台默认选择、分步教程、截图组件、权限折叠排查和图片失败降级；没有写入业务数据。
- src/install-guide-images.json、public/install-guide/*.webp：八张用户截图的尺寸与运行路径，原图未修改；去除可剥离 EXIF，最长导出宽度 720px。
- src/pwa-install-view.ts：复用安装控制器与原弹窗，新增 Safari/Edge 推荐入口、折叠其他浏览器选择、原弹窗大图/返回步骤与焦点恢复。
- src/pwa-install.css：纵向图文卡片、等比预览和完整大图、短屏与窄屏适配。
- src/main.ts、src/app-update-view.ts、src/data-manager.ts、src/style.css：安装、更新、完成提醒、数据管理四组；诊断移入更新卡；数据数量与按钮分组，兼容说明折叠；删除旧“安装与离线”卡。保留 V0.4/V0.5 的通知和恢复接口。
- tests/pwa-install-view.test.ts：推荐策略、九种教程选择、真实安装事件条件、同一弹窗看图、焦点恢复及图片失败。
- tests/install-guide-assets.test.ts：八张真实 WebP 的文件头、尺寸配置与体积。
- tests/statistics-ui.test.ts：设置页入口、诊断所属区域和残留卡片移除回归。

## 图片与推荐规则
图片合计从 2,294,260 字节压缩到 226,972 字节，约减少 90.1%。逐图尺寸及体积见 image-report.json。八张均使用 Pillow 实际解码并检查没有 EXIF；移动浏览器大图保持原比例，不生成缺失步骤图片。

iOS/iPadOS 默认 Safari，Android 默认 Edge；桌面同时展示推荐入口，其他浏览器仍可选。推荐来自用户内测反馈，不宣称只有 Edge 支持或所有手机都兼容。原生安装按钮仍依赖 beforeinstallprompt。权限排查只提桌面快捷方式，不要求其他权限。

## 实际验证
- npm test：56 文件、267 项通过，无未处理异常。
- npm run build：通过，包含 TypeScript 类型检查；最终构建 9ad8acbad69b。
- 未修改 manifest、Service Worker 源码或缓存生成策略；八张图沿现有规则进入核心缓存，核心 16 文件，媒体 507 文件。
- 本地生产预览 http://127.0.0.1:4225/ 实际从旧本地版本提示更新并进入新版，原有一条测试记录和关闭的提醒偏好保留。
- 320×568、360×640、390×780、640×360 浏览器模拟：设置页及安装弹窗无横向溢出；完整大图只开启一个模态框，短屏弹窗高度在视口内。
- Edge/Safari 图文、完整图片与返回、关闭后焦点、其他浏览器选择由浏览器操作与自动化覆盖；Safari 图片实际加载成功。
- 实际 JSON 导出下载后选择同一文件导入：预览版本 8、重复记录 1；确认结果新增 0、跳过 1。CSV 下载成功。测试仅使用 4225 来源内前次创建的 18 秒专注记录。
- 浏览器 error 日志为空。截图：settings-390.png、edge-steps-390.png、edge-full-390.png、safari-steps-390.png。

## 限制与版本控制
没有进行真实 Android Edge / iPhone Safari 安装、本轮手机键盘、安全区域或通知送达实测；模拟视口不代表实机兼容性确认。浏览器版本和菜单以实际设备为准。

按用户要求保留所有 V0.4/V0.5 未提交改动；本轮没有 commit、push、Vercel 部署，也没有修改数据库 v6、备份 v8 或经济规则。原图保留在用户提供的位置，不向仓库额外复制原始大图。
