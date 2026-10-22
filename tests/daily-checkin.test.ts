import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { createDailyCheckinRunner, localDayKey } from '../src/daily-checkin';
import { checkinToday, exportBackup, getActive, getDailyCheckins, getRecords, getWallet, importBackup, openDatabase, settle, spendCoins, startStopwatch } from '../src/storage';

let db: IDBDatabase, now: number;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubEnv('TZ', 'Asia/Shanghai');
  vi.useFakeTimers({ toFake: ['Date'] }); now = new Date(2026, 9, 21, 0, 30).getTime(); vi.setSystemTime(now);
  db = await openDatabase('daily-checkin');
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('awards five coins once per local day, retains full history, and does not repeat after reopening or a rolled-back clock', async () => {
  const first = await checkinToday(db, now);
  expect(first).toEqual({ created: true, record: { date: '2026-10-21', claimedAt: now, reward: 5, transactionId: 'daily_checkin:2026-10-21' } });
  const name = db.name; db.close(); db = await openDatabase(name);
  expect((await checkinToday(db, now + 1000)).created).toBe(false);
  const nextDay = new Date(2026, 9, 22, 0, 1).getTime();
  expect((await checkinToday(db, nextDay)).created).toBe(true);
  expect((await checkinToday(db, now)).created).toBe(false);
  const wallet = await getWallet(db);
  expect(wallet.state).toMatchObject({ balance: 10, totalIncome: 10, remainderMs: 0 });
  expect(wallet.transactions).toHaveLength(2); expect(await getRecords(db)).toEqual([]);
  expect((await getDailyCheckins(db)).map(record => record.date)).toEqual(['2026-10-21', '2026-10-22']);
});

it('uses local midnight rather than UTC date for the check-in key', async () => {
  const stamp = Date.parse('2026-10-20T16:30:00.000Z');
  expect(localDayKey(stamp)).toBe('2026-10-21');
  expect((await checkinToday(db, stamp)).record.date).toBe('2026-10-21');
  expect((await checkinToday(db, Date.parse('2026-10-21T15:59:59.000Z'))).created).toBe(false);
  expect((await checkinToday(db, Date.parse('2026-10-21T16:00:00.000Z'))).created).toBe(true);
});

it('serializes simultaneous tabs without duplicate history, income or balance updates', async () => {
  const other = await openDatabase(db.name);
  const results = await Promise.all([checkinToday(db, now), checkinToday(other, now)]);
  expect(results.filter(result => result.created)).toHaveLength(1);
  expect((await getWallet(db)).state.balance).toBe(5);
  expect((await getWallet(db)).transactions).toHaveLength(1);
  expect(await getDailyCheckins(other)).toHaveLength(1); other.close();
});

it.each(['settings', 'wallet', 'walletTransactions'])('rolls back all writes when %s persistence fails, and permits retry', async store => {
  const before = await getWallet(db), put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add;
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === store) throw Error('空间不足'); return put.apply(this, args);
  });
  const addSpy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === store) throw Error('空间不足'); return add.apply(this, args);
  });
  await expect(checkinToday(db, now)).rejects.toThrow('空间不足');
  putSpy.mockRestore(); addSpy.mockRestore();
  expect(await getWallet(db)).toEqual(before); expect(await getDailyCheckins(db)).toEqual([]);
  expect((await checkinToday(db, now)).created).toBe(true); expect((await getWallet(db)).state.balance).toBe(5);
});

it('works offline, preserves a running focus session, and keeps focus remainder and XP untouched', async () => {
  const fetch = vi.fn().mockRejectedValue(Error('offline')); vi.stubGlobal('fetch', fetch);
  await startStopwatch(db, 'builtin-english', now);
  await settle(db, 'early', now + 180_000); // 3 minutes, no focus coin yet.
  const active = await startStopwatch(db, 'builtin-english', now + 181_000);
  const records = await getRecords(db);
  await checkinToday(db, now + 182_000);
  expect(await getActive(db)).toEqual(active); expect(await getRecords(db)).toEqual(records);
  expect((await getWallet(db)).state).toMatchObject({ balance: 5, remainderMs: 180_000 });
  await settle(db, 'early', now + 301_000);
  expect((await getWallet(db)).state).toMatchObject({ balance: 6, remainderMs: 0 });
  expect(fetch).not.toHaveBeenCalled();
});

it('awards the first five-coin check-in after migrating old coins to zero', async () => {
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('pre-wallet', 4);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('active'); req.result.createObjectStore('records', { keyPath: 'id' });
      req.result.createObjectStore('settings'); const categories = req.result.createObjectStore('categories', { keyPath: 'id' });
      for (const category of DEFAULT_CATEGORIES) categories.add(category);
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  legacy.close(); const migrated = await openDatabase('pre-wallet');
  expect((await getWallet(migrated)).state.balance).toBe(0);
  await checkinToday(migrated, now); expect((await getWallet(migrated)).state.balance).toBe(5);
  expect(migrated.version).toBe(6); migrated.close();
});

it('restores check-in history from wallet backups, deduplicates first-launch rewards, and protects spent wallets', async () => {
  await checkinToday(db, now); await startStopwatch(db, 'builtin-english', now);
  await settle(db, 'early', now + 300_000);
  const raw = await exportBackup(db);
  const target = await openDatabase('restore'); await checkinToday(target, now + 1000);
  await importBackup(target, raw); await importBackup(target, raw);
  expect((await getWallet(target)).state.balance).toBe(6);
  expect((await checkinToday(target, now + 2000)).created).toBe(false);
  expect(await getDailyCheckins(target)).toHaveLength(1);
  await checkinToday(target, new Date(2026, 9, 22).getTime()); await importBackup(target, raw);
  expect((await getWallet(target)).state.balance).toBe(11); expect(await getDailyCheckins(target)).toHaveLength(2);
  await spendCoins(target, 'test-checkin-spend', 1, '测试'); const before = await getWallet(target);
  await expect(importBackup(target, raw)).rejects.toThrow('钱包'); expect(await getWallet(target)).toEqual(before); target.close();
});

it('preserves a first-launch reward when restoring a pre-check-in M1 wallet and does not double it on repeated import', async () => {
  await startStopwatch(db, 'builtin-english', now); await settle(db, 'early', now + 300_000);
  const raw = await exportBackup(db), target = await openDatabase('m1-restore');
  await checkinToday(target, now); await importBackup(target, raw); await importBackup(target, raw);
  expect((await getWallet(target)).state.balance).toBe(6);
  expect(await getDailyCheckins(target)).toHaveLength(1); target.close();
});

it('shows success only after a committed claim and retries failures without repeated per-tick writes', async () => {
  const success = vi.fn(), error = vi.fn(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const claim = vi.fn(async (stamp: number) => { await gate; return checkinToday(db, stamp); });
  const runner = createDailyCheckinRunner({ claim, onSuccess: success, onError: error, now: () => now });
  const first = runner.check(), repeated = runner.check();
  expect(success).not.toHaveBeenCalled(); expect(claim).toHaveBeenCalledTimes(1);
  release(); await Promise.all([first, repeated]); expect(success).toHaveBeenCalledTimes(1);
  await runner.check(true); expect(success).toHaveBeenCalledTimes(1);
  const fail = vi.fn().mockRejectedValueOnce(Error('写入失败')).mockImplementation(stamp => checkinToday(db, stamp));
  now = new Date(2026, 9, 22).getTime();
  const retry = createDailyCheckinRunner({ claim: fail, onSuccess: success, onError: error, now: () => now });
  await retry.check(); expect(error).toHaveBeenCalledTimes(1); expect(success).toHaveBeenCalledTimes(1);
  await retry.check(); expect(fail).toHaveBeenCalledTimes(1);
  await retry.check(true); expect(success).toHaveBeenCalledTimes(2);
  now = new Date(2026, 9, 23).getTime(); await retry.check(); expect(success).toHaveBeenCalledTimes(3);
});
