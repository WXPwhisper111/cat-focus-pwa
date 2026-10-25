import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLocalRepository, type FocusTaskRepository } from '../src/local-repository';
import { addFocusTask, changeFocusTask, completeSummaryTask, getFocusTaskState, getFocusTasks, selectFocusTask } from '../src/focus-task-storage';
import { getActive, getPendingCompletions, getRecords, getWallet, openDatabase, request, settle, startStopwatch, transact } from '../src/storage';

const taskId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const connections: IDBDatabase[] = [];
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(() => { connections.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function database(name: string) { const db = await openDatabase(name); connections.push(db); return db; }
async function snapshot(db: IDBDatabase) {
  const stores = Array.from(db.objectStoreNames);
  return transact(db, stores, 'readonly', async tx => Promise.all(stores.map(async name => ({
    name,
    keys: await request(tx.objectStore(name).getAllKeys()),
    values: await request(tx.objectStore(name).getAll()),
  }))));
}

it('matches the legacy task chain across all stores, settlement, summary completion and reopen', async () => {
  const a = await database('legacy'), b = await database('adapted');
  const legacy: FocusTaskRepository = {
    list: () => getFocusTasks(a), add: (...args) => addFocusTask(a, ...args),
    change: (...args) => changeFocusTask(a, ...args), getState: () => getFocusTaskState(a),
    select: (...args) => selectFocusTask(a, ...args), completeSummary: (...args) => completeSummaryTask(a, ...args),
  };
  const adapted = createLocalRepository(b).focusTasks;
  const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(taskId);
  const parity = async () => expect(await snapshot(b)).toEqual(await snapshot(a));
  await parity();
  const first = await legacy.add('  阅读  ', 1000), second = await adapted.add('  阅读  ', 1000);
  expect(second).toEqual(first); await parity();
  for (const driver of [legacy, adapted]) {
    await driver.select(taskId);
    await driver.change(taskId, { title: '新的标题' }, 1000, 2000);
  }
  expect(await adapted.getState()).toEqual(await legacy.getState()); await parity();
  uuid.mockReturnValue(sessionId);
  await startStopwatch(a, 'builtin-english', 3000); await startStopwatch(b, 'builtin-english', 3000);
  await settle(a, 'early', 303000, sessionId); await settle(b, 'early', 303000, sessionId);
  await parity();
  const wallet = await getWallet(b), records = await getRecords(b), summaries = await getPendingCompletions(b);
  expect(await adapted.completeSummary(sessionId, 304000)).toBe(await legacy.completeSummary(sessionId, 304000));
  expect(await adapted.completeSummary(sessionId, 305000)).toBe(await legacy.completeSummary(sessionId, 305000));
  expect(await getWallet(b)).toEqual(wallet); expect(await getRecords(b)).toEqual(records);
  expect(await getPendingCompletions(b)).toEqual(summaries); await parity();
  for (const driver of [legacy, adapted]) {
    const task = (await driver.list())[0];
    await driver.change(taskId, { status: 'pending' }, task.updatedAt, 306000);
    await driver.select(taskId);
    const pending = (await driver.list())[0];
    await driver.change(taskId, { delete: true }, pending.updatedAt, 307000);
  }
  await parity(); expect((await adapted.getState()).selectedId).toBeNull();
  b.close();
  const reopened = createLocalRepository(await database('adapted')).focusTasks;
  expect(await reopened.list()).toEqual([]); expect(await reopened.completeSummary(sessionId)).toBe('missing');
  expect(await getActive(await database('adapted'))).toBeUndefined();
});

it.each(['complete', 'delete'] as const)('rolls back selection and task together when %s persistence fails', async operation => {
  const db = await database(operation), tasks = createLocalRepository(db).focusTasks;
  const task = await tasks.add('保持原数据', 1000); await tasks.select(task.id);
  const before = await snapshot(db);
  if (operation === 'complete') {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'focusTasks') throw Error('task write failed');
      return original.call(this, value, key);
    });
  } else {
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'focusTasks') throw Error('task write failed');
      return original.call(this, key);
    });
  }
  await expect(tasks.change(task.id, operation === 'complete' ? { status: 'completed' } : { delete: true }, task.updatedAt, 2000)).rejects.toThrow('task write failed');
  expect(await snapshot(db)).toEqual(before);
});

it('rolls back summary completion if selection cleanup fails after the task write', async () => {
  const db = await database('summary-rollback'), tasks = createLocalRepository(db).focusTasks;
  const task = await tasks.add('显式完成', 1000); await tasks.select(task.id);
  const session = await startStopwatch(db, 'builtin-english', 2000); await settle(db, 'early', 62000);
  await tasks.select(task.id);
  const before = await snapshot(db), original = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'settings' && key === 'selectedFocusTaskId') throw Error('selection cleanup failed');
    return original.call(this, key);
  });
  await expect(tasks.completeSummary(session.id, 63000)).rejects.toThrow('selection cleanup failed');
  expect(await snapshot(db)).toEqual(before);
});

it('preserves validation and stale-edit errors and serializes competing connections', async () => {
  const db = await database('concurrent'), a = createLocalRepository(db).focusTasks;
  const b = createLocalRepository(await database('concurrent')).focusTasks;
  const before = await snapshot(db);
  await expect(a.add('   ')).rejects.toThrow('不能为空'); expect(await snapshot(db)).toEqual(before);
  const task = await a.add('原始任务', 1000);
  const results = await Promise.allSettled([
    a.change(task.id, { title: '甲' }, task.updatedAt, 2000),
    b.change(task.id, { title: '乙' }, task.updatedAt, 2000),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.message).toContain('其他页面更新');
  await expect(a.select('missing-task')).rejects.toThrow('尚未完成');
  expect(await a.list()).toEqual(await b.list());
});

it('does no I/O on construction and never reopens a closed connection', async () => {
  const db = await database('lifecycle'), transaction = vi.spyOn(db, 'transaction');
  const tasks = createLocalRepository(db).focusTasks;
  expect(transaction).not.toHaveBeenCalled(); db.close();
  await expect(tasks.list()).rejects.toThrow();
});
