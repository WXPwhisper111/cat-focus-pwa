# V0.3 阶段2A：动画资源接入与通用播放器

日期：2026-10-21。完成后停止，未开始阶段2B。

## 真实资源核对

**按最新V2接入：12段、204张原始PNG + 204张移动WebP。** 旧V1的30段/348帧仍保留，但没有进入当前运行配置。V2不存在enter/exit，不补造映射。每猫eat/loop、drink/loop、scratch/loop、pet/once四段。

逐帧文件路径、时长、锚点、接触信息及检查结果见 [resource-audit.json](resource-audit.json)。下表路径相对于 `public/cat-interactions-v2/`；`once`即one-shot单次。

| 猫咪／稳定ID | 行为／阶段 | 实际WebP路径及序号 | 帧数 | 每帧／总时长 | 核对 |
| --- | --- | --- | --- | --- | --- |
| 喵呜／`orange-white` | eat／loop | `cat-01/mobile/eat/loop/loop_001.webp` … `loop_016.webp` | 16 | [150] ms／2400 ms | 完整 |
| 喵呜／`orange-white` | drink／loop | `cat-01/mobile/drink/loop/loop_001.webp` … `loop_020.webp` | 20 | [150] ms／3000 ms | 完整 |
| 喵呜／`orange-white` | scratch／loop | `cat-01/mobile/scratch/loop/loop_001.webp` … `loop_016.webp` | 16 | [120] ms／1920 ms | 完整 |
| 喵呜／`orange-white` | pet／once | `cat-01/mobile/pet/once/once_001.webp` … `once_016.webp` | 16 | [150] ms／2400 ms | 完整 |
| 芒果／`cat-02` | eat／loop | `cat-02/mobile/eat/loop/loop_001.webp` … `loop_016.webp` | 16 | [150] ms／2400 ms | 完整 |
| 芒果／`cat-02` | drink／loop | `cat-02/mobile/drink/loop/loop_001.webp` … `loop_020.webp` | 20 | [150] ms／3000 ms | 完整 |
| 芒果／`cat-02` | scratch／loop | `cat-02/mobile/scratch/loop/loop_001.webp` … `loop_016.webp` | 16 | [120] ms／1920 ms | 完整 |
| 芒果／`cat-02` | pet／once | `cat-02/mobile/pet/once/once_001.webp` … `once_016.webp` | 16 | [150] ms／2400 ms | 完整 |
| 橘宝／`cat-03` | eat／loop | `cat-03/mobile/eat/loop/loop_001.webp` … `loop_016.webp` | 16 | [150] ms／2400 ms | 完整 |
| 橘宝／`cat-03` | drink／loop | `cat-03/mobile/drink/loop/loop_001.webp` … `loop_020.webp` | 20 | [150] ms／3000 ms | 完整 |
| 橘宝／`cat-03` | scratch／loop | `cat-03/mobile/scratch/loop/loop_001.webp` … `loop_016.webp` | 16 | [120] ms／1920 ms | 完整 |
| 橘宝／`cat-03` | pet／once | `cat-03/mobile/pet/once/once_001.webp` … `once_016.webp` | 16 | [150] ms／2400 ms | 完整 |

原始帧位于对应猫目录的行为/阶段目录中，文件名与移动帧对应，扩展名为PNG；完整路径已逐条记录在JSON，未依赖猜测。

实际解码检查：全部PNG为1254×1254 RGBA；全部WebP为288×288透明图，检查透明/不透明像素、帧数和时长，无错误。原始PNG共193,996,294字节，移动WebP共10,662,056字节。没有重绘、压缩重生成或修改任何原素材。

## 接触点含义与处理

- `feetAnchor`是1254坐标系中的脚底基准`[627,1200]`，不是动作接触点。移动画布换算为约`[144,275.59809]`。
- `contact.spritePoint`是嘴部或前爪的接触参考位置，位于原始1254素材坐标系；`kind`区分muzzle/front-paw。
- `contactFrame`来自生成器的数组中间帧索引，为**从0开始**的参考帧；不是每一帧都应强制锁定的点。
- `itemDisplayPoint`相对于物品**房间显示矩形**，使用房间显示尺寸单位；不是1254像素源图坐标。
- `targetRoomPoint`是当前1024×768房间中的校准目标，`roomSpriteRect`是对齐该参考接触点的放置建议。两者仅保留为元数据，不由播放器决定去向。
- V2帧项仅提供文件和durationMs，没有逐帧接触点或offset。没有将静态接触参考伪装成逐帧位移，亦没有强制抵消嘴部/前爪的正常动作。
- 新增纯函数`pointOnCanvas`和`rectAtAnchor`，显式换算素材锚点/接触点；调用方选择目标位置，播放器不移动猫、不选择功能区。各段参考点与提供矩形的投影误差在0.02逻辑像素以内。

## 修改文件与接口

| 文件 | 职责 |
| --- | --- |
| src/cat-animation.ts（新增） | 通用逐帧Clip类型、校验、时长及锚点换算；不含状态机或功能区决策 |
| src/cat-interactions.ts（新增） | 读取由实际V2清单生成的运行索引，按稳定猫ID、行为、阶段定位WebP；保留接触元数据 |
| src/cat-player.ts | 扩展原播放器，共用原预加载/解码缓存和同一个RAF入口；原updateState兼容 |
| src/room-scene.ts | 仅增加按猫播放已配置交互Clip和停止的资源接口，不启用行为按钮、不移动或重画房间 |
| scripts/index-cat-interactions.mjs、art/cat-interactions-v2/runtime-interactions.json、package.json | 从原清单生成运行索引；dev/test/build先刷新索引，避免直接导入public JSON的Vite兼容警告 |
| scripts/generate-sw.mjs | 新素材只缓存V2移动帧及清单，排除V1和原始大PNG |
| scripts/audit-cat-interactions.py | 使用Pillow检查所有真实PNG/WebP并输出核对JSON，不写素材 |
| tests/generic-cat-player.test.ts、tests/interaction-resources.test.ts | 单次/循环/取消/失败/时长/前后台/资源隔离/接触几何 |
| tests/room-assets.test.ts | 扩展生产缓存清单回归 |
| 本目录player-check.html/ts | 开发专用验证页，使用同一正式播放器，不读写数据库，不进入生产构建 |

主要接口：

- `getInteractionClip(catId, behavior, phase?)`：behavior为eat/drink/scratch/pet，phase为loop/once；缺少资源返回undefined。现有交互系统的play行为名与素材scratch的映射留待2B接入。
- `player.play(clip, { onComplete })`：异步返回started/cancelled/failed，返回表示开始结果，不表示整段播放结束；单次结束以onComplete为准。
- `player.preload(clip)`、`stop()`、`cancel()`、`getState()`；原`updateState(idle|sleep_loop)`保持兼容。
- `onClipFrame(clip,index)`提供当前资源及帧元数据；原onFrame只用于旧动画，不让旧房间定位逻辑误读新动作ID。
- `room.playCatInteraction(catId, behavior, phase?, options?)`及`stopCatAnimation(catId)`不涉及功能区定位或业务奖励。

单次按全部帧时长结束，末帧停留，完成回调一次；循环按逐帧时长重复，停止/取消冻结当前画面，不触发完成回调。切换前先加载、解码全部目标帧，失败保留旧画面；旧异步结果不能覆盖新请求。后台暂停播放时间，前台恢复剩余时长；销毁清理RAF、监听及播放器持有的资源引用。

## 实际验证结果

- 全量`npm test`：**29个文件、153项通过**。包含旧计时、统计、钱包、签到、商城、备份和idle/sleep回归。
- `npm run build`：**通过**，TypeScript、Vite及缓存生成成功。
- 使用带Pillow的现有运行时实际执行`audit-cat-interactions.py`：408张文件全部解码，12段/204帧完整，无错误。
- 自动测试覆盖真实抚摸2400ms准确结束、回调一次、真实循环边界、变时长探针、长时间跨周期、停止/取消、异步竞态、失败重试、三猫隔离、隐藏暂停和销毁不复活。变时长探针仅用于测试，未添加到正式资源清单。
- 独立电脑浏览器开发检查页实际通过原Image.decode机制加载全部12段/204张WebP。
- 三猫抚摸均观察到“已完成·回调1次”；逐猫检查eat/drink/scratch文件来自各自目录，停止后帧号保持不变；恢复待机返回原cat-animation-v2目录。
- 390、430宽度检查页均无横向溢出；预览图为176×176 CSS像素，脚底和接触参考可核对。
- 构建缓存检查：新交互204张WebP+4份JSON；旧idle/sleep 285张WebP；V1资源0、交互原始PNG 0。原始文件仍保留在public用于维护，dist静态目录也会包含public副本，但不会被预缓存或由播放器请求。

截图：[390宽度](screenshots/player-390.png)、[430宽度](screenshots/player-430.png)。

## 运行与维护

正常运行命令不变。开发检查页：运行`npm run dev`，打开终端地址后的`/art/interaction-v0.3/stage-2a/player-check.html`。该页只验证资源与播放器；素材交付自带的其他自主行为预览未引入应用。

重新核对资源时，使用安装Pillow的Python运行`python scripts/audit-cat-interactions.py`；本轮使用Codex现有依赖运行时，无新增npm依赖。public索引和三猫清单为资源来源，运行索引为派生文件；增加/替换素材先更新真实清单，再运行`node scripts/index-cat-interactions.mjs`、核对和构建，不能仅更改组件路径。

## 未完成或未实测

- Android/iPhone实机、真实后台回收及移动端内存占用：未实测；电脑窄屏不是手机实测。
- 新动作的生产版本断网重开：本轮只验证缓存生成清单与既有缓存机制测试，未声称完成手机离线验收。
- 没有启用阶段1行为按钮，没有自主调度、随机动作、跨区淡出换位、家具容量管理或交互属性/奖励。交付素材中的behavior-rules.json仅作为素材说明阅读，未接入调度器。
- 缺少enter/exit是用户确认的V2调整，不是缺帧；不补造。现有sleep_loop继续复用，睡下/起身、行走未实现。
- 数据库仍v5、备份仍v6，所有权、钱包、签到和商城规则不变。

本阶段结束，等待确认后再考虑2B。

## Git提交与推送状态

本阶段收尾按新提供的Git规范检查了`D:\MyDesktopPet\cat-focus-pwa`：`git rev-parse --show-toplevel`、status、当前分支、remote和上游查询均返回“not a git repository”。因此没有可用的git diff、暂存区、commit hash或已确认上游；**未提交、未推送**。未自行初始化仓库或配置远程。修改范围按本报告逐项核对，未新增凭据或用户业务数据；资源核对JSON和截图仅包含素材及独立测试页。
