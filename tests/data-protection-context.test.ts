import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataContextManager, PROTECTION_DATABASE, type DataContextManager, type MigrationPreview } from '../src/data-protection/context';
import { captureSnapshot } from '../src/data-protection/snapshot';
import { type OwnershipDecision } from '../src/data-protection/policy';
import { changeFocusTask } from '../src/focus-task-storage';
import { request, startStopwatch, transact } from '../src/storage';
import { protectionFixture } from './data-protection-fixture';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let source: IDBDatabase;
const managers: DataContextManager[] = [], extraConnections: IDBDatabase[] = [];
function manager(uid: string | null = A) {
  const value = createDataContextManager({ guestDatabase: 'isolated-guest' }); value.setIdentity(uid); managers.push(value); return value;
}
function decision(plan: MigrationPreview, replace = false): OwnershipDecision {
  return { ownerUid: plan.ownerUid, snapshotHash: plan.snapshotHash, localEconomyBaseline: 'use-this-snapshot-without-merging',
    cloudEconomyBaseline: 'not-configured', externalBackupConfirmed: true, ...(replace ? { existingAccount: 'keep-existing-as-archive' as const } : {}) };
}
async function rawDatabase(name: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => { req.transaction!.abort(); reject(Error('test database absent')); };
  }); extraConnections.push(db); return db;
}
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); source = await protectionFixture('isolated-guest'); });
afterEach(() => { managers.splice(0).forEach(m => m.destroy()); extraConnections.splice(0).forEach(db => db.close()); source?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not read/open guest data or metadata just because an identity changes', async () => {
  const open = vi.spyOn(indexedDB, 'open'), m = manager(null);
  m.setIdentity(A); m.setIdentity(B); m.setIdentity(null);
  expect(open).not.toHaveBeenCalled();
  await expect(m.prepareGuestMigration(true)).rejects.toThrow('账号上下文');
  await expect(m.prepareGuestMigration(false)).rejects.toThrow('明确操作');
});

it('requires consent, copies every byte of business data, verifies before activation and is idempotent', async () => {
  const m = manager(), before = await captureSnapshot(source), plan = await m.prepareGuestMigration(true);
  expect((await m.status()).databaseName).toBeNull();
  await expect(m.confirmAndActivate(plan.id, {} as never)).rejects.toThrow('明确确认');
  const pointer = await m.confirmAndActivate(plan.id, decision(plan));
  expect(pointer.databaseName).toContain(A);
  const copied = await m.readAccountSnapshot();
  expect(copied.ownerUid).toBe(A); expect(copied.data).toEqual(before.data); expect(copied.contentHash).toBe(before.contentHash);
  expect(await m.confirmAndActivate(plan.id, decision(plan))).toEqual(pointer);
  expect((await captureSnapshot(source)).contentHash).toBe(before.contentHash);
  expect((await m.readAccountSnapshot()).data.walletTransactions).toEqual(before.data.walletTransactions);
});

it('stops when the source changes after preview, or when an activity is still running', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true);
  const task = (await captureSnapshot(source)).data.focusTasks[0].value as { id: string; updatedAt: number };
  await changeFocusTask(source, task.id, { title: '新数据不可丢' }, task.updatedAt);
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('源数据已变化');
  expect((await m.status()).databaseName).toBeNull();
  await startStopwatch(source, 'builtin-english', 3_000_000);
  await expect(m.prepareGuestMigration(true)).rejects.toThrow('活动专注');
});

it('aborts an interrupted copy atomically and resumes from durable snapshot/journal after reopening', async () => {
  const first = manager(), original = await captureSnapshot(source), plan = await first.prepareGuestMigration(true);
  const add = IDBObjectStore.prototype.add;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'walletTransactions') throw Error('quota simulation');
    return add.call(this, value, key);
  });
  await expect(first.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('quota simulation');
  expect((await first.status()).databaseName).toBeNull();
  const target = await rawDatabase(plan.targetDatabase);
  for (const name of Array.from(target.objectStoreNames)) expect(await request(target.transaction(name).objectStore(name).count())).toBe(0);
  failure.mockRestore(); first.destroy();
  const resumed = manager();
  expect((await resumed.migration(plan.id)).phase).toBe('prepared');
  await resumed.confirmAndActivate(plan.id, decision(plan));
  expect((await resumed.readAccountSnapshot()).data).toEqual(original.data);
  expect((await captureSnapshot(source)).contentHash).toBe(original.contentHash);
});

it('recovers an interruption between copying and verification without rewriting copied rows', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true), put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'jobs' && value.phase === 'verified') throw Error('interrupted before verification checkpoint');
    return put.call(this, value, key);
  });
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('checkpoint');
  expect((await m.migration(plan.id)).phase).toBe('copied'); expect((await m.status()).databaseName).toBeNull();
  failure.mockRestore();
  let businessWrites = 0;
  const originalAdd = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (['wallet', 'walletTransactions', 'records', 'focusTasks'].includes(this.name)) businessWrites++;
    return originalAdd.call(this, value, key);
  });
  await m.confirmAndActivate(plan.id, decision(plan));
  expect(businessWrites).toBe(0);
});

it('keeps the pointer unchanged when activation fails, then detects a tampered shadow instead of repairing it', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true), put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'accounts') throw Error('activation failed');
    return put.call(this, value, key);
  });
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('activation failed');
  expect((await m.status()).databaseName).toBeNull(); expect((await m.migration(plan.id)).phase).toBe('verified');
  failure.mockRestore();
  const target = await rawDatabase(plan.targetDatabase);
  const task = (await captureSnapshot(target, A)).data.focusTasks[0].value as { id: string; updatedAt: number };
  await changeFocusTask(target, task.id, { title: '保留冲突副本' }, task.updatedAt);
  const changed = await captureSnapshot(target, A);
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('副本与快照冲突');
  expect((await m.status()).databaseName).toBeNull(); expect((await captureSnapshot(target, A)).contentHash).toBe(changed.contentHash);
});

it('rejects another UID and revokes retained repositories on logout/account switch', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true); await m.confirmAndActivate(plan.id, decision(plan));
  const tasksA = await m.taskRepository(); await tasksA.add('仅 A 可见');
  m.setIdentity(A); expect((await tasksA.list()).some(task => task.title === '仅 A 可见')).toBe(true);
  const accountA = await m.readAccountSnapshot();
  m.setIdentity(B);
  await expect(tasksA.list()).rejects.toThrow('账号上下文'); await expect(tasksA.add('不能写入 A')).rejects.toThrow('账号上下文');
  await expect(m.readAccountSnapshot()).rejects.toThrow('尚未确认');
  await expect(m.migration(plan.id)).rejects.toThrow('没有此迁移');
  await expect(m.exportArchivedBranch(plan.id)).rejects.toThrow('没有此迁移');
  await expect(m.prepareRecovery(accountA)).rejects.toThrow('其他账号');
  await expect(m.prepareGuestMigration(true)).rejects.toThrow('已归属其他账号');
  m.setIdentity(A); expect((await (await m.taskRepository()).list()).some(task => task.title === '仅 A 可见')).toBe(true);
  m.setIdentity(null); await expect(m.readAccountSnapshot()).rejects.toThrow('账号上下文');
});

it('aborts an in-flight A write on identity change instead of returning or applying it as B', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true); await m.confirmAndActivate(plan.id, decision(plan));
  const tasks = await m.taskRepository(), before = await m.readAccountSnapshot(), add = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    const result = add.call(this, value, key);
    if (this.name === 'focusTasks') m.setIdentity(B);
    return result;
  });
  await expect(tasks.add('必须回滚')).rejects.toThrow();
  m.setIdentity(A); expect((await m.readAccountSnapshot()).contentHash).toBe(before.contentHash);
});

it('does not combine independent wallets; explicit replacement archives both branches and rollback preserves new data', async () => {
  const m = manager(), initial = await m.prepareGuestMigration(true); await m.confirmAndActivate(initial.id, decision(initial));
  const oldTasks = await m.taskRepository(); await oldTasks.add('旧分支新增');
  const recovery = await m.prepareGuestMigration(true);
  await expect(m.confirmAndActivate(recovery.id, decision(recovery))).rejects.toThrow('独立钱包');
  await m.confirmAndActivate(recovery.id, decision(recovery, true));
  await expect(oldTasks.list()).rejects.toThrow('账号上下文');
  const newTasks = await m.taskRepository(); await newTasks.add('新分支新增');
  const newSnapshot = await m.readAccountSnapshot();
  await m.rollback(recovery.id);
  const current = await m.readAccountSnapshot();
  expect(current.data.focusTasks.some(row => (row.value as { title: string }).title === '旧分支新增')).toBe(true);
  expect(current.data.focusTasks.some(row => (row.value as { title: string }).title === '新分支新增')).toBe(false);
  expect((await m.exportArchivedBranch(recovery.id)).contentHash).toBe(newSnapshot.contentHash);
  expect(current.data.wallet).toEqual(newSnapshot.data.wallet);
  await expect(newTasks.list()).rejects.toThrow('账号上下文');
});

it('rolls first migration back to an unassigned account, leaving source and the migrated branch intact', async () => {
  const m = manager(), before = await captureSnapshot(source), plan = await m.prepareGuestMigration(true);
  await m.confirmAndActivate(plan.id, decision(plan));
  const tasks = await m.taskRepository(); await tasks.add('回滚也保留');
  await m.rollback(plan.id); await m.rollback(plan.id);
  expect((await m.status()).databaseName).toBeNull();
  expect((await m.exportArchivedBranch(plan.id)).data.focusTasks).toHaveLength(2);
  expect((await captureSnapshot(source)).contentHash).toBe(before.contentHash);
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow('已结束');
});

it('rejects corrupt recovery before allocating a job or shadow', async () => {
  const m = manager(), snapshot = await captureSnapshot(source), before = await m.migrations();
  snapshot.checksum = 'broken';
  await expect(m.prepareRecovery(snapshot)).rejects.toThrow('校验失败');
  expect(await m.migrations()).toEqual(before); expect((await m.status()).databaseName).toBeNull();
});

it('restores a verified external snapshot into a fresh shadow, without re-awarding history', async () => {
  const m = manager(), snapshot = await captureSnapshot(source), plan = await m.prepareRecovery(JSON.parse(JSON.stringify(snapshot)));
  await m.confirmAndActivate(plan.id, decision(plan));
  expect((await m.readAccountSnapshot()).data).toEqual(snapshot.data);
});

it('keeps the current branch when restoring a previous branch fails validation', async () => {
  const m = manager(), first = await m.prepareGuestMigration(true); await m.confirmAndActivate(first.id, decision(first));
  const second = await m.prepareGuestMigration(true); await m.confirmAndActivate(second.id, decision(second, true));
  const active = await m.status(), previous = await rawDatabase(first.targetDatabase);
  await transact(previous, ['wallet'], 'readwrite', async tx => {
    const wallet = await request<Record<string, number>>(tx.objectStore('wallet').get('only')); wallet.balance++;
    tx.objectStore('wallet').put(wallet, 'only');
  });
  await expect(m.rollback(second.id)).rejects.toThrow('钱包');
  expect(await m.status()).toEqual(active);
});

it('resolves competing activations with an atomic pointer comparison', async () => {
  const a = manager(), b = manager(), first = await a.prepareGuestMigration(true), second = await b.prepareGuestMigration(true);
  const outcomes = await Promise.allSettled([a.confirmAndActivate(first.id, decision(first)), b.confirmAndActivate(second.id, decision(second))]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await a.status()).migrationId).toBe((await b.status()).migrationId);
});

it('refuses missing guest databases instead of initializing a new empty guest archive', async () => {
  const m = createDataContextManager({ guestDatabase: 'does-not-exist' }); managers.push(m); m.setIdentity(A);
  await expect(m.prepareGuestMigration(true)).rejects.toThrow('不存在');
  expect((await m.status()).databaseName).toBeNull();
  expect((await indexedDB.databases()).some(db => db.name === 'does-not-exist')).toBe(false);
  expect((await indexedDB.databases()).some(db => db.name === PROTECTION_DATABASE)).toBe(true);
});

it('does not let an account database masquerade as a guest source', async () => {
  expect(() => createDataContextManager({ guestDatabase: `cat-focus-pwa-user-${A}-shadow-${A}` })).toThrow('冒充访客');
  expect(() => createDataContextManager({ guestDatabase: PROTECTION_DATABASE })).toThrow('冒充访客');
});

it('prevents a competing UID from reading a previously prepared guest plan after ownership is assigned', async () => {
  const a = manager(A), b = manager(B), planA = await a.prepareGuestMigration(true), planB = await b.prepareGuestMigration(true);
  await a.confirmAndActivate(planA.id, decision(planA));
  await expect(b.migration(planB.id)).rejects.toThrow('其他账号');
  await expect(b.exportMigrationSnapshot(planB.id)).rejects.toThrow('其他账号');
  await expect(b.confirmAndActivate(planB.id, decision(planB))).rejects.toThrow('其他账号');
  expect((await b.status()).databaseName).toBeNull();
});

it('rolls pointer activation back when the auth context is revoked inside the metadata transaction', async () => {
  const m = manager(), plan = await m.prepareGuestMigration(true), put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const result = put.call(this, value, key);
    if (this.name === 'accounts') m.setIdentity(B);
    return result;
  });
  await expect(m.confirmAndActivate(plan.id, decision(plan))).rejects.toThrow();
  m.setIdentity(A); expect((await m.status()).databaseName).toBeNull();
  expect((await m.migration(plan.id)).phase).toBe('verified');
});

it('refuses a legacy source version without upgrading or initializing its data', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('legacy-v5-readonly', 5);
    req.onupgradeneeded = () => req.result.createObjectStore('sentinel').put({ keep: true }, 'original');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  extraConnections.push(old);
  const m = createDataContextManager({ guestDatabase: 'legacy-v5-readonly' }); managers.push(m); m.setIdentity(A);
  await expect(m.prepareGuestMigration(true)).rejects.toThrow('版本或 stores');
  expect(old.version).toBe(5); expect(Array.from(old.objectStoreNames)).toEqual(['sentinel']);
  expect(await request(old.transaction('sentinel').objectStore('sentinel').get('original'))).toEqual({ keep: true });
});
