import type { SupabaseClient } from '@supabase/supabase-js';
import { createDataContextManager, type MigrationPreview } from '../data-protection/context';
import { snapshotSummary } from '../data-protection/snapshot';
import type { OwnershipDecision } from '../data-protection/policy';

export function mountDataProtectionPanel(root: HTMLElement, auth: SupabaseClient['auth'], options: { guestDatabase?: string } = {}) {
  const manager = createDataContextManager(options);
  root.classList.add('data-protection-panel');
  root.setAttribute('aria-label', '本地数据保护开发测试');
  root.innerHTML = `<hr><h2>V0.2.3 本地数据保护（仅开发测试）</h2>
    <p>正式 PWA 始终使用访客库。登录不归属、不上传数据。仅在下面明确操作后读取访客库、创建副本；原库不删除。</p>
    <p>请先关闭其他专注页面、结束活动计时，再预览。此工具复制的是你确认的时间点，不保证包含其他页面后续新增内容。</p>
    <p data-context-identity role="status"></p>
    <button type="button" data-context-status>检查当前账号上下文和迁移日志</button>
    <p data-context-status-text></p>
    <button type="button" data-context-preview>我确认读取访客存档，生成迁移预览</button>
    <label>恢复完整迁移快照（不是旧版 JSON 备份）<input type="file" accept="application/json,.json" data-context-file></label>
    <label>本账号的迁移日志<select data-context-jobs><option value="">先检查迁移日志</option></select></label>
    <button type="button" data-context-load>读取选中迁移预览／继续中断流程</button>
    <pre data-context-plan style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
    <button type="button" data-context-download>导出预览的完整快照</button>
    <label><input type="checkbox" data-context-backup style="width:auto;min-height:24px">我已确认完整快照保存到设备外或可靠下载位置</label>
    <label><input type="radio" name="context-economy" data-context-economy style="width:auto;min-height:24px">明确选择本快照的独立钱包作为本地基线，不与其他钱包相加；云端基线尚未配置</label>
    <label><input type="checkbox" data-context-replace style="width:auto;min-height:24px">若账号已有独立存档，明确选择新分支；原账号分支仅归档保留，不覆盖、不合并</label>
    <button type="button" data-context-activate>确认归属、复制并验证后切换</button>
    <button type="button" data-context-read>读取当前账号副本摘要</button>
    <label><input type="checkbox" data-context-rollback-confirm style="width:auto;min-height:24px">确认回滚当前迁移指针；新分支与其中的新增数据仍保留，回滚不会合并两份数据</label>
    <button type="button" data-context-rollback>回滚当前迁移</button>
    <button type="button" data-context-archive>导出选中分支的最新完整快照（含回滚后保留数据）</button>
    <p data-context-message role="status" aria-live="polite"></p>
    <p>共享经济购买尚未接云，当前不可用。时区变更与补签只有预留策略，不补发历史奖励。快照是明文；不含 Auth 会话或本地密钥。</p>`;
  const el = <T extends HTMLElement>(attribute: string) => root.querySelector<T>(`[data-context-${attribute}]`)!;
  const field = (name: string) => el<HTMLInputElement>(name);
  let uid: string | null = null, epoch = 0, busy = false, disposed = false;
  let plan: MigrationPreview | null = null, activeMigration: string | null = null;
  function controls() {
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(node => { node.disabled = busy || !uid; });
    el<HTMLButtonElement>('activate').disabled = busy || !uid || !plan || plan.ownerUid !== uid || !field('backup').checked || !field('economy').checked;
    el<HTMLButtonElement>('download').disabled = busy || !uid || !plan;
    el<HTMLButtonElement>('archive').disabled = busy || !uid || !plan || plan.phase === 'prepared';
    el<HTMLButtonElement>('rollback').disabled = busy || !uid || !activeMigration || !field('rollback-confirm').checked;
  }
  function clear() {
    plan = null; activeMigration = null;
    el('plan').textContent = ''; el('status-text').textContent = ''; el('message').textContent = '';
    field('backup').checked = false; field('economy').checked = false; field('replace').checked = false;
    field('rollback-confirm').checked = false; field('file').value = '';
    el<HTMLSelectElement>('jobs').replaceChildren(new Option('先检查当前账号迁移日志', ''));
  }
  function identify(next: string | null) {
    if (disposed) return;
    if (next === uid) return;
    epoch++; uid = next; manager.setIdentity(next); clear(); busy = false;
    el('identity').textContent = next ? `当前 UID：${next}。尚未自动读取或切换任何业务数据。` : '未登录或上下文已暂停。账号数据不可访问。';
    controls();
  }
  async function action(task: (stillCurrent: () => boolean) => Promise<void>) {
    if (busy || !uid || disposed) return;
    const captured = epoch;
    const stillCurrent = () => !disposed && captured === epoch;
    busy = true; el('message').textContent = '处理中…'; controls();
    try { await task(stillCurrent); if (stillCurrent()) el('message').textContent = '操作完成。'; }
    catch (error) { if (stillCurrent()) el('message').textContent = error instanceof Error ? error.message : '操作失败，原存档保留'; }
    finally { if (stillCurrent()) { busy = false; controls(); } }
  }
  function show(next: MigrationPreview) {
    plan = next; field('backup').checked = false; field('economy').checked = false; field('replace').checked = false;
    el('plan').textContent = `账号：${next.ownerUid}\n迁移：${next.id}\n阶段：${next.phase}\n目标：${next.targetDatabase}\n内容 SHA-256：${next.snapshotHash}\n副本摘要：${JSON.stringify(next.summary)}\n已有账号存档：${next.replacesExisting ? '是，默认拒绝替换' : '否'}\n点击激活前请下载快照并明确选择基线。`;
    controls();
  }
  function download(snapshot: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `cat-focus-full-snapshot-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  el('status').onclick = () => void action(async current => {
    const status = await manager.status(), jobs = await manager.migrations();
    if (!current()) return;
    activeMigration = status.migrationId;
    el('status-text').textContent = status.databaseName ? `当前账号副本：${status.databaseName}；修订 ${status.revision}` : '账号尚未归属任何本地存档，访客库保持原样。';
    const select = el<HTMLSelectElement>('jobs'); select.replaceChildren(new Option('选择本账号迁移', ''));
    for (const job of jobs) select.append(new Option(`${job.id} · ${job.phase}`, job.id));
  });
  el('preview').onclick = () => void action(async current => { const next = await manager.prepareGuestMigration(true); if (current()) show(next); });
  el('load').onclick = () => void action(async current => {
    const id = el<HTMLSelectElement>('jobs').value; if (!id) throw Error('请先选择迁移记录');
    const next = await manager.migration(id); if (current()) show(next);
  });
  field('file').onchange = () => void action(async current => {
    const file = field('file').files?.[0]; if (!file) return;
    if (file.size > 32 * 1024 * 1024) throw Error('快照超过开发测试工具的 32 MB 文件限制，请先评估容量');
    const raw = JSON.parse(await file.text()); if (!current()) return;
    const next = await manager.prepareRecovery(raw); if (current()) show(next);
  });
  el('download').onclick = () => void action(async current => {
    const snapshot = await manager.exportMigrationSnapshot(plan!.id); if (current()) download(snapshot);
  });
  el('archive').onclick = () => void action(async current => {
    const snapshot = await manager.exportArchivedBranch(plan!.id); if (current()) download(snapshot);
  });
  el('activate').onclick = () => void action(async current => {
    if (!plan || !field('backup').checked || !field('economy').checked) throw Error('请先确认备份和钱包基线');
    const decision: OwnershipDecision = { ownerUid: uid!, snapshotHash: plan.snapshotHash,
      localEconomyBaseline: 'use-this-snapshot-without-merging', cloudEconomyBaseline: 'not-configured', externalBackupConfirmed: true,
      ...(field('replace').checked ? { existingAccount: 'keep-existing-as-archive' as const } : {}) };
    const result = await manager.confirmAndActivate(plan.id, decision); if (!current()) return;
    activeMigration = result.migrationId; plan = { ...plan, phase: 'active' };
    el('status-text').textContent = `已切换开发工具上下文：${result.databaseName}。正式 PWA 未切换。`;
  });
  el('read').onclick = () => void action(async current => {
    const snapshot = await manager.readAccountSnapshot(); if (current()) el('status-text').textContent = `UID ${snapshot.ownerUid}：${JSON.stringify(snapshotSummary(snapshot))}`;
  });
  el('rollback').onclick = () => void action(async current => {
    if (!activeMigration || !field('rollback-confirm').checked) throw Error('请明确确认回滚');
    const result = await manager.rollback(activeMigration); if (!current()) return;
    activeMigration = result.migrationId; plan = null; field('rollback-confirm').checked = false; el('plan').textContent = '';
    el('status-text').textContent = result.databaseName ? `已回到保留分支：${result.databaseName}` : '账号已恢复未归属状态。访客原库和新分支均保留，可从迁移日志导出。';
  });
  ['backup', 'economy', 'replace', 'rollback-confirm'].forEach(name => { field(name).onchange = controls; });
  let authRevision = 0;
  el('identity').textContent = '未登录或正在恢复认证状态。未读取业务数据。';
  const { data: { subscription } } = auth.onAuthStateChange((_event, session) => { authRevision++; identify(session?.user.id ?? null); });
  const initialRevision = authRevision;
  void auth.getSession().then(({ data, error }) => {
    if (!disposed && authRevision === initialRevision) { if (error) identify(null); else identify(data.session?.user.id ?? null); }
  }).catch(() => { if (!disposed) identify(null); });
  controls();
  return {
    suspend() { authRevision++; identify(null); },
    destroy() { disposed = true; epoch++; subscription.unsubscribe(); manager.destroy(); root.replaceChildren(); },
  };
}
