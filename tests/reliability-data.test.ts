// @vitest-environment jsdom
import { expect, it, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, exportBackup, previewBackup, importBackup, getRecords, startStopwatch, settle, getWallet } from '../src/storage';
import { recordsCsv, backupReminder, previewImport } from '../src/data-manager';
import { notifyCompletion } from '../src/notifications';
import { mockDialogs } from './dialog-mocks';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
it('uses the mobile service worker and reports failures without throwing', async () => {
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('Notification', { permission: 'granted' });
  const send = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'serviceWorker', { configurable:true, value: { getRegistration: async () => ({active: {}, showNotification:send}) } });
  expect(await notifyCompletion('one')).toBe('sent'); expect(send.mock.calls[0][1].tag).toBe('focus-one');
  send.mockRejectedValue(Error('denied')); expect(await notifyCompletion('one')).toBe('failed');
  vi.stubGlobal('Notification', { permission: 'denied' }); expect(await notifyCompletion('one')).toBe('denied');
});
it('previews by rolling back, then imports and rejects active-session restores', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const source = await openDatabase('source'), target = await openDatabase('target');
  try {
    await startStopwatch(source, 'builtin-english', 1000); await settle(source, 'early', 301000);
    const raw = await exportBackup(source), before = await getWallet(target);
    expect((await previewBackup(target, raw)).added).toBe(1);
    expect(await getRecords(target)).toEqual([]); expect(await getWallet(target)).toEqual(before);
    await importBackup(target, raw); expect(await getRecords(target)).toHaveLength(1);
    await startStopwatch(target, 'builtin-english', 400000);
    await expect(previewBackup(target, raw)).rejects.toThrow('结束当前专注');
    await expect(importBackup(target, raw, false, true)).rejects.toThrow('结束当前专注');
  } finally { source.close(); target.close(); }
});
it('requires explicit confirmation in the preview dialog', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); mockDialogs();
  const db = await openDatabase('dialog');
  try {
    const raw = await exportBackup(db), notice = vi.fn();
    await previewImport(db, {text: async () => raw} as File, async () => {}, notice);
    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(document.querySelector('dialog')?.textContent).toContain('确认导入');
    document.querySelectorAll<HTMLButtonElement>('dialog button')[2].click();
    expect(document.querySelector('dialog')).toBeNull(); expect(await getRecords(db)).toEqual([]);
  } finally { db.close(); }
});
it('escapes CSV and only reminds after seven days', () => {
  const csv = recordsCsv([{id:'id',categoryId:'category',startedAt:'start',endedAt:'end',category:'=HYPERLINK("x")',mode:'stopwatch',targetMinutes:null,durationSeconds:60,completed:false}]);
  expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('""x""');
  expect(backupReminder({ firstAt:0, enabled:true }, 7*86400000)).toBe(true);
  expect(backupReminder({ firstAt:0, enabled:false }, 8*86400000)).toBe(false);
  expect(backupReminder({ firstAt:0,lastExportAt:86400000,enabled:true }, 7*86400000)).toBe(false);
});

it('rechecks changed local tasks at commit and preserves the entire state on conflict', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const { addFocusTask, changeFocusTask } = await import('../src/focus-task-storage');
  const db = await openDatabase('recheck');
  try {
    const task = await addFocusTask(db, '原任务'); const raw = await exportBackup(db);
    await previewBackup(db, raw); await changeFocusTask(db, task.id, {title:'修改后的任务'});
    const before = await exportBackup(db);
    await expect(importBackup(db, raw, false, true)).rejects.toThrow('任务 ID');
    const after = JSON.parse(await exportBackup(db)); const expected = JSON.parse(before);
    delete after.exportedAt; delete expected.exportedAt; expect(after).toEqual(expected);
  } finally { db.close(); }
});
