import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { addFocusTask, changeFocusTask, getFocusTaskState, getFocusTasks, selectFocusTask } from '../src/focus-task-storage';
import { exportBackup, getActive, getWallet, importBackup, openDatabase, startStopwatch } from '../src/storage';
import { parseBackup } from '../src/domain';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
it('restores v8 selection, preserves local choices and older imports, and removes invalid references', async () => {
  const source = await openDatabase('source'), target = await openDatabase('target');
  const a = await addFocusTask(source, '备份目标'); await selectFocusTask(source, a.id);
  const backup = JSON.parse(await exportBackup(source)); expect(backup.selectedTaskId).toBe(a.id);
  await importBackup(target, JSON.stringify(backup)); await importBackup(target, JSON.stringify(backup));
  expect((await getFocusTaskState(target)).selectedId).toBe(a.id);
  const b = await addFocusTask(target, '本机目标'); await selectFocusTask(target, b.id);
  await importBackup(target, JSON.stringify(backup)); expect((await getFocusTaskState(target)).selectedId).toBe(b.id);
  const legacy = { ...backup, version: 7 }; delete legacy.selectedTaskId;
  await importBackup(target, JSON.stringify(legacy)); expect((await getFocusTaskState(target)).selectedId).toBe(b.id);
  for (const selectedTaskId of ['missing-task', {}, null]) expect(parseBackup(JSON.stringify({ ...backup, selectedTaskId })).selectedTaskId).toBeNull();
  const completed = { ...backup, tasks: [{ ...a, status: 'completed', completedAt: a.updatedAt }] };
  expect(parseBackup(JSON.stringify(completed)).selectedTaskId).toBeNull();
  source.close(); target.close();
});
it('rejects malformed task fields and rolls back a conflict without changing selection, wallet or active snapshot', async () => {
  const db = await openDatabase(); const task = await addFocusTask(db, '原目标'); await selectFocusTask(db, task.id);
  await startStopwatch(db, 'builtin-english', Date.now());
  const before = await Promise.all([getActive(db), getWallet(db), getFocusTaskState(db)]);
  const backup = JSON.parse(await exportBackup(db));
  for (const patch of [{ id: '!' }, { title: ' ' }, { title: '长'.repeat(101) }, { status: 'unknown' }, { updatedAt: -1 }, { completedAt: 1 }]) {
    await expect(importBackup(db, JSON.stringify({ ...backup, tasks: [{ ...task, ...patch }] }))).rejects.toThrow();
  }
  const newTask = { ...task, id: 'new-task-id' };
  await expect(importBackup(db, JSON.stringify({ ...backup, tasks: [newTask, { ...task, title: '冲突' }] }))).rejects.toThrow('任务 ID');
  expect(await Promise.all([getActive(db), getWallet(db), getFocusTaskState(db)])).toEqual(before); db.close();
});
it('persists burst additions and sequential rapid toggles, edits and selected deletion through reopen', async () => {
  const db = await openDatabase('burst');
  const tasks = await Promise.all(Array.from({ length: 30 }, () => addFocusTask(db, '相同标题')));
  expect(new Set(tasks.map(task => task.id)).size).toBe(30);
  for (let i = 0; i < 10; i++) await changeFocusTask(db, tasks[0].id, { status: i % 2 ? 'pending' : 'completed' });
  await changeFocusTask(db, tasks[0].id, { title: '刷新前保存' }); await selectFocusTask(db, tasks[0].id);
  db.close(); const reopened = await openDatabase('burst');
  expect((await getFocusTasks(reopened)).find(task => task.id === tasks[0].id)?.title).toBe('刷新前保存');
  await changeFocusTask(reopened, tasks[0].id, { delete: true });
  expect((await getFocusTaskState(reopened)).selectedId).toBeNull(); expect(await getFocusTasks(reopened)).toHaveLength(29); reopened.close();
});
