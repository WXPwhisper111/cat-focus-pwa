# 三猫素材与页面一致性更新

## 2026-10-21：同步睡眠幅度32px修订

最新素材确认睡眠峰值由52降为32原图像素；32帧、4800ms、每帧150ms不变，idle与眨眼不变。同步前生产目录每猫有29张睡眠移动帧与最新源文件不同，idle全部一致。已重新生成索引并构建；逐张SHA-256核对三猫全部285张移动帧，public与dist完全一致，Service Worker内容哈希版本已更新。92项测试及构建通过，本轮未重新运行浏览器或手机视觉实测。机器核对结果见sleep-32-sync.json。

## 后续修正：动作 V2 已正式接入

检查发现前轮虽然更新了橘白模型，但读取的是 public/cat_01～03 的10／8帧旧动作；增强呼吸及尾尖动作包 public/cat-animation-v2 尚未接入。下方“18帧／54帧”等为前轮历史记录，由本节修正。

当前配置读取 art/cat-animation-v2/runtime-cats.json，路径全部为 public/cat-animation-v2/cat-01～03/mobile。每猫 idle 63帧／9260ms，sleep_loop 32帧／4800ms；每帧按素材 durationMs 播放，不改变眨眼时长。运行 node scripts/index-cat-animation-v2.mjs 可重建索引，不重画素材。生产缓存285张移动WebP，总大小16,520,772字节；旧cat-mobile目录和V2原PNG均不预缓存。

92项自动测试与构建通过，包括帧数、资源路径、脚底锚点及眨眼关键时间点。实际390px桌面浏览器确认喵呜待机由idle_002推进至idle_052，暂停切为V2 sleep_loop_002；猫画布176px，未发现播放器卡帧。截图v2-focus.png。其余两猫资源及播放时序由自动化验证，本轮未重复手机实机测试。循环总长没有缩短，动作改善来自增强呼吸轮廓、尾尖和中间帧；小屋按原布局缩小后仍会比专注卡更细微，未擅自放大场景中的猫。

2026-10-20。

## 改动

- 三只猫均由最新 public/cat_01、cat_02、cat_03/animations.json 生成288px无损透明 WebP。喵呜使用新 cat_01 模型；芒果使用 cat_02；橘宝使用 cat_03。每只 idle 10帧，循环9260ms；sleep_loop 8帧，循环4800ms，按原配置逐帧时长播放。
- 保留稳定 ID orange-white、cat-02、cat-03，因此现有领养、备份关联不变。数据库4、备份4不升级。原计时、记录、经验与猫爪币算法不变。
- 未领养时专注页不创建猫咪播放器，提示“这里还空空的”，提供“去领养猫咪”按钮；计时仍可独立使用。
- 统计页接收当前主陪伴猫配置，右上角使用本猫睡眠首帧，成长头像使用本猫 idle 首帧。未领养时隐藏右上角猫图，成长卡以“尚未领养”代替头像，累计数据继续显示。
- 房间继续沿用既有脚底位置；新模型依据素材锚点[627,1200]换算偏移。未裁切透明画布，也未把猫合成到背景。
- 生产预缓存排除旧款 cat-mobile/idle、sleep_loop，以及所有大尺寸原始猫帧；仅缓存三套最新派生帧（54帧）。旧资源文件保留供历史素材维护，不作为运行时猫咪资源。

## 文件

配置/展示：src/cat-definition.ts、main.ts、statistics-view.ts、room-scene.ts、style.css、statistics.css。

资源：scripts/prepare-adoption-cats.py、scripts/generate-sw.mjs、art/room-v0.1/stage-b/mobile-cats.json、public/cat-mobile/cat_01、cat_02、cat_03。运行装有Pillow的Python执行 scripts/prepare-adoption-cats.py 可重新生成，不修改源PNG。

验证：tests/cat-catalogue.test.ts、room-scene.test.ts、room-assets.test.ts、adoption-ui.test.ts、statistics-ui.test.ts、stopwatch-ui.test.ts。README.md同步更新当前行为；阶段A/B原报告保留历史信息。

派生大小：喵呜1,031,604字节，芒果1,111,444字节，橘宝858,966字节，合计3,002,014字节。源PNG分别17,338,300、20,025,876、15,332,161字节。转换检查透明通道、画布尺寸、WebP逐像素无损回读。

## 验证

- 92项自动测试、18个文件通过，生产构建通过。
- 自动测试覆盖三只猫名称/资源路径/锚点/时长、未领养专注空状态、领养前无播放器、领养后跨页一致、三只猫的统计双头像、旧计时暂停保存及奖励回归、缓存排除旧资源。
- 实际桌面浏览器：独立4191测试源验证未领养提示及直达领养入口、三只新名称、领养喵呜后专注加载cat_01、统计两处分别加载cat_01睡眠及idle首帧；390px无横向溢出。截图见同目录 focus-empty.png、miaow-focus.png、miaow-statistics.png。
- 本轮未实测手机设备、离线停服和操作系统回收；缓存清单由构建与自动测试验证。芒果、橘宝的本轮统计图片更新通过自动测试验证，未另开两个真实浏览器领养环境。
