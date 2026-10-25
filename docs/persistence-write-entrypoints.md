# 持久化写入口清单｜Repository 薄适配阶段

核对日期：2026-10-25。依据：实际工作区 `a306c3a` 加本阶段薄适配。范围覆盖生产源码、开发认证与测试资金入口，以及 Service Worker 的持久化；测试夹具写入不属于业务入口。

本表记录真实写边界，不表示本阶段已迁移全部入口。`src/storage.ts`、`src/focus-task-storage.ts`、`src/data-manager.ts` 及其事务实现本轮未修改。标为“已适配”的调用也继续由原存储函数拥有事务。

## IndexedDB：初始化与连接成功后的隐式写入

| 入口/位置 | 触发 | 持久化效果 / 事务边界 | 本轮状态 |
| --- | --- | --- | --- |
| `openDatabase` / onupgradeneeded，storage.ts:50 | 打开旧版或全新数据库 | 版本升级事务中建 8 stores、写默认类别/选择、补历史记录 categoryId/mode、初始化钱包迁移基线、旧总结币置零；所有升级动作仍归属于同一 versionchange 事务 | 保留原入口，不执行新增迁移 |
| `ensureDefaultCategories`，storage.ts:161 | openDatabase 成功后的内容初始化 | categories + settings，补默认类别、写 defaultCategories-v2 标记 | 保留 |
| `ensureCatExpansion`，storage.ts:117 | 上述默认类别初始化后 | settings，按现有领养状态初始化 catExpansion-v2；已有值不重发资格 | 保留 |

注意：“仅打开数据库”并不严格只读，上述内容初始化可能写入；因此验证只打开 fake-indexeddb 隔离库。

## IndexedDB：任务与选择（首条适配链）

| 原入口 / 位置 | 真实写入 | 关联的同一事务 | Repository 状态 |
| --- | --- | --- | --- |
| `addFocusTask`，focus-task-storage.ts:6 | add 新任务 | focusTasks | add 已适配 |
| `changeFocusTask`，focus-task-storage.ts:10 | 改名、完成/恢复、硬删除任务；完成/删除时清除对应选择；核对 expectedUpdatedAt | focusTasks + settings | change 已适配 |
| `getFocusTaskState`，focus-task-storage.ts:29 | 读取并清理已失效的 selectedFocusTaskId | focusTasks + settings | getState 已适配；不能误标纯读 |
| `selectFocusTask`，focus-task-storage.ts:38 | 选择待办任务或删除选择键 | focusTasks + settings | select 已适配 |
| `completeSummaryTask`，focus-task-storage.ts:47 | 从 pendingCompletions 快照显式完成任务，清理选择；不发奖 | focusTasks + settings | completeSummary 已适配 |

`getFocusTasks` 纯读映射为 list，不列为写入口。旧函数仍可供兼容调用。`main.ts` 的目标选择/清除、刷新、总结完成及清单工厂已迁移；`startFocus` 和 `importBackup` 对任务/选择的操作继续留在各自原事务，见下表。

## IndexedDB：专注、类别与总结

| 入口 / storage.ts 位置 | 触发与写入 | 原事务 stores / 注意事项 |
| --- | --- | --- |
| `getCategoryState`:229 | 读取类别并修复失效的 selectedCategoryId | categories + settings；隐式写，不是纯读 |
| `selectCategory`:241 | 写 selectedCategoryId | categories + settings |
| `addCategory`:249 | 新增或恢复同名归档类别，更新当前选择 | categories + settings |
| `setCategoryArchived`:268 | 归档/恢复类别，必要时改选 | categories + settings；不删历史记录 |
| `selectTimerMode`:224 | 写 timerMode | settings |
| `startSession`:284 / `startStopwatch`:289 → `startFocus`:293 | 写 active/only、类别和模式选择、任务目标快照；必要时删除失效任务选择 | active + categories + settings + focusTasks；不拆出单独选择事务 |
| `togglePause`:312 | 写累计有效时间、状态、运行起点 | active 原生事务，等完成后返回 |
| `settle`:355 → `awardFocusCoins`:448 | 原子写记录、币结算凭据/流水/钱包、总结；清理 active、迁移基线和选择；discard 规则不变 | active + records + settings + wallet + walletTransactions + coinReceipts；关键整体不可拆 |
| `acknowledgeCompletion`:347 | 从 pendingCompletions 移除已确认总结 | settings；不是删除专注记录 |

本表各项本轮均保留直连 storage；清单适配没有接管结算、暂停、开始专注或类别领域。

## IndexedDB：经济、签到、猫咪与房间

| 入口 / storage.ts 位置 | 触发与写入 | 原事务 stores / 约束 |
| --- | --- | --- |
| `checkinToday`:411 | 初始化/校验奖励节点；按本地日期写基础和额外奖励流水、签到历史、领取/免补发标记及钱包 | wallet + walletTransactions + coinReceipts + settings；同日重复也可能补物化历史或奖励标记，不拆事务 |
| `spendCoins`:482 → `spendCoinsIn`:466 | 校验幂等操作后扣款、写支出 | wallet + walletTransactions + coinReceipts；购买须走专用入口 |
| `purchaseProduct`:493 → `spendCoinsIn` | 原子扣款、写购买凭据、猫/家具所有权及自动装备 | settings + wallet + walletTransactions + coinReceipts；禁止“先扣款、再另存库存” |
| `grantDevelopmentCoins`:694 | DEV 检查后固定 ID 测试入账 | wallet + walletTransactions + coinReceipts；仅开发，备份仍可能包含其流水，未来同步不可自动接收铸币 |
| `adoptInitialCat`:203 | 免费首次领养、入住及陪伴设置 | settings；仅一次、目录校验 |
| `claimExpansionCat`:127 | 领取一次扩展免费名额，同时写所有权、入住与资格记录 | settings；资格与猫状态不拆 |
| `manageResidents`:139 | 入住/暂离/替换，校验容量和归属 | settings |
| `setCompanionCat`:529 | 更新主陪伴猫 | settings |
| `renameCat`:191 | 写 catNames | settings；只允许已拥有猫 |
| `equipFurniture`:520 | 更新对应分区装备 | settings；必须已拥有，不再次扣币 |
| `saveRoomLocations`:682 | 保存猫咪稳定锚点位置 | settings；与猫咪已入住约束关联，不是家具自由坐标 |

这些入口本轮均未迁移、未改实现。`awardFocusCoins` / `spendCoinsIn` 是内部事务步骤，不能单独包装为会自行提交的 Repository 方法。

## IndexedDB：导出、导入、恢复和偏好

| 入口 / 位置 | 持久化效果 | 原事务/恢复语义 |
| --- | --- | --- |
| `importBackup`，storage.ts:559 | 解析后合并/恢复钱包和签到/奖励标记、商城、猫咪/资格/名字、任务/选择、类别、专注记录；允许条件下 clear 钱包流水后恢复快照 | records + categories + settings + wallet + walletTransactions + coinReceipts + active + focusTasks，任意晚期冲突整体 abort；不重放历史专注奖励 |
| `previewBackup`，storage.ts:710 → importBackup(preview=true) | 在真实 readwrite 事务中执行预演，再用 BackupPreview 主动 abort，无提交数据 | 同上；不能把预览中的临时写入计入未来同步 outbox |
| `previewImport` 确认按钮，data-manager.ts:76 | 调用 importBackup(raw,false,true)，提交前重新检查冲突、拒绝活动专注 | 不另开替代导入事务 |
| `preferences`，data-manager.ts:5 | 首次创建 backupPreferences | settings；mountDataManager 内有数据时触发 |
| `downloadBackup`，data-manager.ts:21 | 发起 JSON 文件下载后写 lastExportAt 等偏好 | settings；备份导出本身只读，下载记录不保证文件已保存 |
| `mountDataManager` 的备份提醒 change 回调，data-manager.ts:50 | 改 backupPreferences.enabled | settings |

`exportBackup` / `parseBackup` / recordsCsv 本身不写业务库。恢复没有独立“覆盖全库”接口，当前仍由 importBackup 的验证与原子合并实现。UI 的“先导出当前数据”也调用 downloadBackup，因而会写提醒偏好；它不是另一个经济恢复入口。

## 非 IndexedDB 持久化

| 位置 / 入口 | 写入目标与触发 | Repository 策略 |
| --- | --- | --- |
| pwa-install.ts 的 write；构造时 standalone、beforeinstallprompt、appinstalled、environmentChanged、checkReminder/dismissReminder | localStorage 的 cat-focus:installed-v1 / cat-focus:install-reminder-v1，setItem/removeItem | 设备安装偏好，保留现有实现 |
| shop-news.ts 的 viewed | localStorage 的 cat-focus-shop-seen-v1 商品 ID 数组 | 设备展示偏好 |
| update-dialog.ts 的 remember，经关闭/稍后/前往更新流程触发 | localStorage 的 cat-focus-update-dialog-seen 版本 | 设备展示偏好 |
| dev/auth-test.ts 创建 SDK；auth-test-view.ts 的 signInWithOtp / verifyOtp / signOut，以及 SDK 恢复/刷新 | SDK 管理 cat-focus-auth-test-session；发送请求/本地清理、签入和令牌刷新可能改变 SDK 会话存储 | 开发认证独立，业务 Repository 不读写令牌，不改变账号行为 |
| scripts/sw-runtime.js 的 loadAsset / asset、install、WARM_MEDIA | Cache Storage 核心/媒体资源 put，包含复用旧缓存校验后复制 | 静态资源，不属于用户业务同步 |
| scripts/sw-runtime.js 的 rememberVersion / cleanObsolete | 更新元数据 put，按完整版本与活跃客户端引用删除旧缓存/元数据 | 保留更新缓存边界，不清 IndexedDB |
| data-manager.ts 的 download | JSON/CSV 浏览器下载请求 | 设备外文件由用户保存，不自动上传 |

浏览器通知权限、PWA 安装为平台状态，不是另一个可随业务库合并的数据表。BroadcastChannel、运行中的动画和内存选择不持久化。构建脚本生成的 dist/资源索引属于构建产物，不是用户存档入口；本轮 sources/ 只读。

## 清单维护方法

后续改持久化时先复查 `createObjectStore/createIndex`、`put/add/delete/clear`、`setItem/removeItem`、Cache API 和 SDK 存储调用；需要同时追踪封装后的事务和 UI 回调，不应仅搜索“save”命名。新增/迁移入口必须在本表更新覆盖状态；在清单完整覆盖之前，不宣称所有业务已由 Repository 管理。
