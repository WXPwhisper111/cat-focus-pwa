# 三只猫交互动画 V1

这批资源独立存放在 `public/cat-interactions-v1/`，没有替换应用当前使用的 idle、sleep 资源，也没有接入业务逻辑。

每只猫有吃饭、喝水、抓挠的进入、循环、退出各一段，以及一次性的抚摸反应，共 10 段；三只猫共 30 段。原始帧为 1254 × 1254 真透明 PNG，手机衍生帧为 288 × 288 无损透明 WebP。画布与脚底基准 `[627,1200]` 在同一只猫的各帧中固定，未逐帧裁切或自动居中。帧不含家具、地面阴影、文字或 UI。

每猫 `animations.json` 给出帧顺序、逐帧 `durationMs`、循环标记、起止姿势、朝向和脚底锚点。吃饭、喝水和抓挠的 `loop.contact` 另有素材坐标 `spritePoint`、物品 `targetItem`、相对于物品在房间中显示矩形的接触坐标 `itemDisplayPoint`，以及当前 1024 × 768 房间的预览坐标 `targetRoomPoint`、`roomSpriteRect`。接触坐标仅供放置参考，不画在帧里。手机侧缩放素材坐标时，应按 `288/1254` 同比例换算。

| 动作 | 播放 | 帧数与时间（每猫） | 接触 |
| --- | --- | --- | --- |
| 吃饭 | enter → loop（按需循环）→ exit | 8 × 100 ms、16 × 150 ms、8 × 100 ms | 嘴部对食盆 |
| 喝水 | enter → loop（按需循环）→ exit | 8 × 100 ms、20 × 150 ms、8 × 100 ms | 嘴部对水盆 |
| 抓挠 | enter → loop（按需循环）→ exit | 8 × 100 ms、16 × 120 ms、8 × 100 ms | 前爪对猫抓板 |
| 抚摸反应 | once，播放一次后回 idle | 16 × 150 ms，共 2.4 s | 无物品接触 |

从仓库根目录启动静态文件服务（例如 `python -m http.server 8000`），再打开 `http://localhost:8000/art/cat-interactions-v1/preview.html`，可选择猫与动作，查看房间、176 像素专注卡和放大视图。前三种动作在预览中连续播放两轮循环。标记开关只影响开发预览。关键姿势参考图保存在 `design-references/`；`previews/` 有每段动画 WebP；`validation/` 有帧边界与时长记录。

`build.py` 从已确认的原型 idle 帧和关键姿势生成上述资源。重建依赖 Pillow、NumPy 与本地关键姿势源图。打包脚本 `package.py` 检查交付结构，生成单猫包、三猫总包与便于手机查看的轻量包。

当前是美术素材基准版：进入和退出采用分段关键姿势，供后续接入时确认角色朝向与放置方式。开发时播放循环必须以清单的帧时长为准，不能将整个 enter/loop/exit 误当一个循环。
