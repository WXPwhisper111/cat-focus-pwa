import { exportBackup, getRecords, importBackup, previewBackup, request, transact } from './storage';
import { parseBackup, type FocusRecord } from './domain';
const KEY = 'backupPreferences';
type Preferences = { firstAt: number; lastExportAt?: number; enabled: boolean };
async function preferences(db: IDBDatabase): Promise<Preferences> {
  return transact(db, ['settings'], 'readwrite', async tx => {
    const store = tx.objectStore('settings');
    const value = await request<Preferences | undefined>(store.get(KEY));
    if (value) return value;
    const initial = { firstAt: Date.now(), enabled: true }; store.put(initial, KEY); return initial;
  });
}
export function backupReminder(value: Preferences, now: number) {
  return value.enabled && now - (value.lastExportAt ?? value.firstAt) >= 7 * 86400000;
}
function download(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadBackup(db: IDBDatabase) {
  const raw = await exportBackup(db);
  download(raw, 'application/json', `猫咪专注备份-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await transact(db, ['settings'], 'readwrite', async tx => {
    const store = tx.objectStore('settings');
    const value = await request<Preferences | undefined>(store.get(KEY));
    store.put({ firstAt: Date.now(), enabled: true, ...value, lastExportAt: Date.now() }, KEY);
  });
}
export function recordsCsv(records: FocusRecord[]) {
  const cell = (value: unknown) => {
    let text = String(value); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [['记录 ID', '开始时间', '结束时间', '类别', '模式', '时长（秒）', '正常完成'], ...records.map(r => [r.id, r.startedAt, r.endedAt, r.category, r.mode, r.durationSeconds, r.completed])].map(row => row.map(cell).join(',')).join('\r\n');
}
export async function mountDataManager(db: IDBDatabase, notice: (message: string) => void) {
  const host = document.querySelector<HTMLElement>('#data-manager'); if (!host) return;
  try {
    const data = parseBackup(await exportBackup(db));
    const count = data.records.length + (data.tasks?.length ?? 0);
    const prefs = count ? await preferences(db) : undefined;
    if (!host.isConnected) return;
    const pending = data.tasks?.filter(t => t.status === 'pending').length ?? 0;
    host.innerHTML = `<p class="data-counts">记录 ${data.records.length} · 待办 ${pending} · 已完成 ${(data.tasks?.length ?? 0) - pending} · 分类 ${data.categories.length}</p><p data-backup-time class="hint"></p><div class="settings-actions" data-data-actions><button data-csv>导出统计 CSV</button></div><div class="backup-preferences"><label><input type="checkbox" data-backup-reminder>每七天提醒备份</label><p data-reminder role="status"></p></div><p class="hint">数据只在当前浏览器来源中。换设备、换域名或清除网站数据不会自动转移存档；浏览器内副本不能代替设备外备份。</p>`;
    const actions = document.querySelector('#backup-actions'); if (actions) host.querySelector('[data-data-actions]')!.prepend(actions);
    host.querySelector('[data-backup-time]')!.textContent = prefs?.lastExportAt ? `上次发起备份导出：${new Date(prefs.lastExportAt).toLocaleString()}（请自行确认文件已保存）` : '尚未发起备份导出';
    const checkbox = host.querySelector<HTMLInputElement>('[data-backup-reminder]')!; checkbox.checked = prefs?.enabled ?? true;
    host.querySelector('[data-reminder]')!.textContent = prefs && backupReminder(prefs, Date.now()) ? '有一段时间没有导出备份了，建议保存一份 JSON。' : '';
    checkbox.addEventListener('change', async () => {
      try { await transact(db, ['settings'], 'readwrite', async tx => {
        const store = tx.objectStore('settings'), current = await request<Preferences | undefined>(store.get(KEY));
        store.put({ firstAt: Date.now(), ...current, enabled: checkbox.checked }, KEY);
      }); host.querySelector('[data-reminder]')!.textContent = ''; } catch { checkbox.checked = !checkbox.checked; notice('提醒设置保存失败'); }
    });
    host.querySelector('[data-csv]')!.addEventListener('click', async () => {
      try { download(recordsCsv(await getRecords(db)), 'text/csv;charset=utf-8', '专注记录.csv'); } catch { notice('CSV 导出失败'); }
    });
  } catch { if (host.isConnected) host.textContent = '数据读取失败，请重新打开设置。'; }
}
export async function previewImport(db: IDBDatabase, file: File, changed: () => Promise<void>, notice: (message: string) => void) {
  let dialog: HTMLDialogElement | undefined;
  try {
    const raw = await file.text(), parsed = parseBackup(raw), preview = await previewBackup(db, raw);
    document.querySelector('dialog.backup-preview')?.remove();
    dialog = document.createElement('dialog'); dialog.className = 'backup-preview';
    const title = document.createElement('h2'); title.textContent = '确认合并备份';
    const summary = document.createElement('p'); summary.textContent = `版本 ${JSON.parse(raw).version} · 记录 ${parsed.records.length} · 任务 ${parsed.tasks?.length ?? 0} · 新增记录 ${preview.added} · 重复记录 ${preview.skipped}。确认时会重新检查冲突，钱包不直接相加。有活动专注时不能导入。`;
    const error = document.createElement('p'); error.setAttribute('role', 'status');
    dialog.append(title, summary, error);
    const buttons = ['先导出当前数据', '确认导入', '取消'].map(text => { const button = document.createElement('button'); button.textContent = text; dialog!.append(button); return button; });
    const opener = document.activeElement as HTMLElement | null;
    let importing=false;
    const close = () => { if(importing)return; dialog?.close(); dialog?.remove(); if (opener?.isConnected) opener.focus(); }; dialog.addEventListener('cancel', event=>{if(importing)event.preventDefault();else close();}); buttons[2].onclick = close;
    buttons[0].onclick = async () => { try { await downloadBackup(db); error.textContent = '已发起下载，请确认文件已保存。'; } catch { error.textContent = '导出失败，请重试。'; } };
    buttons[1].onclick = async () => {
      importing=true;buttons.forEach(button=>button.disabled=true);
      try { const result = await importBackup(db, raw, false, true); importing=false;close(); await changed(); notice(`导入完成：新增 ${result.added} 条，跳过 ${result.skipped} 条。`); }
      catch (cause) { error.textContent = cause instanceof Error ? cause.message : '导入失败，原数据已保留'; importing=false;buttons.forEach(button=>button.disabled=false); }
    };
    document.body.append(dialog); dialog.showModal();
  } catch (error) { dialog?.remove(); notice(error instanceof Error ? error.message : '无法读取备份'); }
}
