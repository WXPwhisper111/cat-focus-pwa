# 窗户素材 V0.1

素材位于 `public/room/`，四张均为 1024 × 768 PNG，使用最近邻缩放；原始生成图保留在 Codex generated_images 中。

- `window_outside_day.png`：白天，不透明 RGB。
- `window_outside_night.png`：以白天原图为输入转换夜景，保持景物构图，不透明 RGB。
- `window_frame.png`：真实 Alpha 透明；只有中央竖向分隔条，两侧开口透明，无窗台。
- `window_curtains.png`：真实 Alpha 透明；窗帘杆与左右布帘，中间开放。

## 叠放参考

在局部 1024 × 768 坐标中，景色先绘制到矩形 `(x=100,y=110,width=824,height=560)`，然后窗框和窗帘分别按完整画布从 `(0,0)` 叠放。景色需限制在该矩形，避免从窗框外沿露出。昼夜使用完全相同的目标矩形。整体窗口可按统一比例缩放；此处局部坐标不规定或改变房间布局。

`window-stack-day-preview.png` 和 `window-stack-night-preview.png` 仅为叠放检查图，米色底不属于透明素材。应用应使用四张独立 PNG。

## 生成与检查

使用内置 imagegen。现有 `public/cat/idle/idle_01.png` 为最高优先级风格参考，房间底图辅助确定木色。实际生成提示词归档于 `window-generation-prompts.json`。

检查了成品尺寸、PNG 格式、景色不透明性、窗框两侧开口透明性、窗帘中央透明性和叠放预览。Alpha 与尺寸检查结果见 `window-validation.json`；昼夜景物位置通过目视核对，未宣称逐像素几何验证。未修改或接入应用计时、统计、存储、成长逻辑。
