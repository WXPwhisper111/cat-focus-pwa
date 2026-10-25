# Repository 薄适配阶段｜实际验证记录

日期：2026-10-25。分支：`feature/supabase-auth-test`。开始时 HEAD 与审计基线均为 `a306c3a59e91b9d468b921f22f1d0d83cddc8271`，没有已跟踪文件改动。

## 实施范围

- 新增 `src/local-repository.ts`，只适配 focusTasks 的 6 个真实操作；构造函数不做 I/O、不拥有连接生命周期。
- `main.ts` 与 `focus-task-list.ts` 接入专注清单、目标选择/清除、读取刷新和总结完成的调用链。
- 旧存储函数及 `createFocusTaskList(db,...)` 兼容入口保留。任务原存储实现、开始专注/结算/购买/签到/导入等存储实现未修改。
- 新增两份测试，以及 [架构决策](adr-001-local-repository.md)、[全部持久化写入口清单](persistence-write-entrypoints.md) 和本记录。
- 不修改数据库名称、DB v6 schema、JSON v10 格式、奖励/经济公式、认证行为、依赖、发布说明；不接云、不迁移、不操作正式存档。

## 本阶段实际执行结果

以下均为本次代码变更后执行的结果，不引用此前审计测试数量作为验证结果。

| 检查 | 实际结果 |
| --- | --- |
| `npx vitest run tests/local-repository.test.ts tests/local-repository-ui.test.ts tests/focus-task-list.test.ts tests/focus-goal-ui.test.ts tests/focus-list-read-failure.test.ts tests/focus-tasks.test.ts tests/focus-goal-storage.test.ts` | 7 个测试文件、23 项通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run build`（含 tsc、Vite、Service Worker 与发布产物校验） | 通过；914 个文件，54,600,499 字节，构建版本 `f8255feafdcb`，低于既有 100 MB 预算 |
| 构建完成后顺序执行 `npm test` | 68 个测试文件、339 项通过 |
| lint | 项目没有独立 lint script，不额外安装工具；执行已有类型检查和差异检查 |
| `git diff --check` | 通过；保留旧文件未改动行的既有行尾，仅规范新加行 |
| 审计基线对比 | storage.ts、focus-task-storage.ts、domain.ts、wallet.ts、checkin-rewards.ts、shop.ts、认证目录、package.json/package-lock.json 均无实现差异 |
| 生产隔离 | 全量测试中的 auth-test-isolation 检查通过，开发认证页与 Supabase SDK 未进入生产产物 |

新增测试共 7 项：

1. 直连旧存储与 LocalRepository 运行相同任务链，比较全部 8 个 stores 的键和值；包含目标、实际专注结算、重复显式完成、恢复/删除和重新打开连接。
2. 任务完成的写入失败时，任务和目标选择一起回滚。
3. 任务删除失败时，任务和目标选择一起回滚。
4. 总结完成在任务写入后选择清理失败时，整个事务回滚；记录、钱包、凭据与总结不变。
5. 无效标题、两个连接并发旧版本写入、无效目标选择保持原校验/错误行为。
6. 构造无 I/O，连接关闭后错误正常传播，适配器不自行重新打开数据库。
7. 注入 Repository 的真实清单 UI 完成 CRUD/选目标，失败后保留输入且允许重试；原兼容入口及主应用目标/总结测试也继续通过。

测试通过 fake-indexeddb 与 jsdom 使用隔离数据，未打开用户浏览器正式存档。没有将桌面模拟测试描述为 Android 真机验收。

## 差异与 Git 边界

本阶段提交采用明确文件列表，不包含 `.env.local`、旧审计报告或原有美术目录。`.env.local` 仍被忽略且不被跟踪；提交前检查实际配置密钥不在暂存文本和生产输出中，检查 Secret/JWT/私钥模式。推送只针对已确认的 origin 功能分支；远端同名分支不存在时使用 `git push -u origin HEAD`，不 force push、不合并 main、不执行部署/发布命令。提交哈希与实际推送状态以交付时 Git 检查结果为准。

## 剩余工作

目前只有专注清单领域完成薄适配，初始化、类别、计时、经济、猫咪/房间与备份仍使用原兼容存储。它们的真实写入口已列明；尤其读时修复、资格初始化与导入预演不能遗漏。后续逐条迁移，不拆原事务。同步协议、历史奖励边界、离线经济、账号隔离等仍需单独设计和验收，不因本阶段通过而视为已实现。
