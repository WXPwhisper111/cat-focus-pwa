# 六只猫伸懒腰 V1 · 独立素材

本批交付喵呜、芒果、橘宝、吉吉、珍珠、简州狸花白的伸懒腰。每猫 18 个播放位置、3.6 秒、单次动作；首尾均使用正式 idle 基准图经过一次统一配准后的同一张图。现有应用、正式 idle/sleep 和其他动作未替换。

橘白使用用户于 2026-10-24 明确选中的第一张 4×4 姿态表。保留该表的动作、表情和花色，不采用随后生成的两张试验表。其他五猫以各自正式形象为角色参考，以已确认橘白表为动作参考，由内置 ImageGen 绘制，提示词见 production.json。未使用 API/CLI 生图。

## 查看

- `gallery.html` 可直接用浏览器打开，不依赖脚本服务器；每猫提供 176 px、288 px、390/430 房间动画，以及两轮完整交替的 44.24 秒 WebP。
- `motion-reel.webp` 为六猫同屏伸展总览，循环播放便于观察。单猫 `previews/cat-XX/stretch.webp` 则只播放一次。
- 交互预览：在本目录运行 `python serve_preview.py --port 8848`，打开 `http://127.0.0.1:8848/preview.html`。提供待机交替、立即伸展、暂停、半速和逐帧检查。
- 浏览器限制 file:// 加载 ES 模块时，请使用上述服务，或直接打开无需服务的 gallery.html。

## 配准与尺寸

- 原始导出帧为 1254×1254 真透明 PNG；手机图为 288×288 无损透明 WebP。画布、逻辑脚底基准 `[627,1200]` 和同组比例固定。
- 原图的姿态没有严格落在等分网格内，因此按整只猫的连通轮廓分离，保留跨网格的耳尖、爪子、尾巴和胡须，避免切格造成新增裁切。无法从源图恢复原本已在整张图外的细节。
- 每组只采用一个缩放比例，并按逐帧人工标记的后脚横坐标和对应接触线进行平移。`sources/*/landmarks.json` 记录源区域及落点；不使用整图坐标扭曲、逐帧缩放或自动居中。
- 伸展比坐姿更宽，所以统一增加透明留白。正式 idle 的预览拷贝采用同一参考变换，以免切换时大小跳变；原 idle 文件完全保留。`referenceScale`、`previewAnchor` 和 `previewDisplayScale` 记录留白及房间显示补偿；房间预览按正式 idle 的体型显示。176 px 专注卡按完整画布展示，优先保证完整轮廓。
- 动作表单格原始像素分辨率低于 1254；1254 导出采用最近邻放大，不宣称每帧为原生 1254 精度。两帧之间保留绘制的姿态变化，不用图像融化或交叉淡化伪造中间动作。
- 黑猫保持短毛修长；芒果保留深色爪子；橘宝保留浅毛、长毛和嘴周不对称黄斑；珍珠保留灰褐面罩与米白毛色；狸花白保留头背虎斑及白腿。

## 清单和交替语义

各猫 `resources/*/animations.json` 的 `actions.stretch` 包含 `loop:false`、`frames[].durationMs`、`sourceCanvas`、`feetAnchor` 和固定的 `rearContact`。首尾标记为 `approved-idle-registered`。预览入口清单为 manifest.json。

独立预览每次回待机抽取 10–20 秒阈值，达到阈值后等待当前 9.26 秒 idle 循环结束，保留完整眨眼，因此实际等待可超过 20 秒（额外等待小于一轮 idle）。各猫初始相位随机错开；伸展 3.6 秒后从 idle 基准帧继续。页面隐藏和手动暂停均停止预览计时。素材全部预加载成功才开始交替，失败保持待机并提示。

手机轻量包只包含手机帧，其清单 `file` 指向 WebP，保留 1254 逻辑坐标并注明 `encodedCanvas:[288,288]`。`originalFile` 仅为来源说明，不是轻量包文件引用。轻量包保留交互预览所需的配准 idle，省略未使用的原 idle 拷贝及较大的两轮离线影片；两轮影片在完整版中。

## 重建与验证

在完整项目根目录，使用 requirements.txt 对应 Pillow、NumPy 环境执行：

```text
python art/cat-stretch-v1/register.py
python art/cat-stretch-v1/build.py
python art/cat-stretch-v1/validate.py
node art/cat-stretch-v1/check_timeline.mjs
python art/cat-stretch-v1/render_review.py
python art/cat-stretch-v1/validate_previews.py
python art/cat-stretch-v1/package.py
npm test
npm run build
```

源码归档、配准参数和生图提示词均保存在本目录。`setup_sources.py` 仅用于首次归档，重建不应运行它覆盖已记录的保护哈希。重新生成姿态表仍需内置 ImageGen；其余导出可离线复现。素材包中的预览可独立使用；完整重建依赖项目中被引用的正式 idle 源帧。

校验包括 PNG/WebP 解码、无损像素一致、透明与边缘余量、时长、首尾一致、后脚标记配准误差不超过 0.5 源像素，以及 3128 个既有应用文件未改变。程序校验不替代观感检查：浏览器截图和逐帧图另存 validation/。390/430 为电脑浏览器模拟视口，不代表实体手机实测。

压缩包保存在 packages/，索引包含大小与 SHA256。ZIP 不提交 Git；源文件、清单、预览和重建脚本提交。
