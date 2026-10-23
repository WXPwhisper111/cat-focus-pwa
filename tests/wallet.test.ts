import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { localIso, progress, type ActiveSession, type FocusRecord } from '../src/domain';
import { adoptInitialCat, exportBackup, getActive, getCatHouseState, getPendingCompletions, getRecords, getWallet, importBackup, openDatabase, settle, spendCoins, startSession, startStopwatch, togglePause } from '../src/storage';
import { COIN_INTERVAL_MS, DAILY_CHECKIN_COINS, validateWalletSnapshot } from '../src/wallet';

const migrationTime = new Date(2026, 9, 21, 12).getTime();
let clock = migrationTime, db: IDBDatabase | undefined;
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(migrationTime); clock = migrationTime; });
afterEach(() => { db?.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
async function save(ms: number) {
  const session = await startStopwatch(db!, 'builtin-english', clock);
  const result = await settle(db!, 'early', clock + ms, session.id); clock += ms + 1000;
  return result;
}
const historical: FocusRecord = { id: 'legacy-focus-record', categoryId: 'builtin-english', category: '英语', mode: 'countdown', targetMinutes: 120,
  startedAt: localIso(migrationTime - 130 * 60_000), endedAt: localIso(migrationTime - 10 * 60_000), durationSeconds: 7200, completed: true };
async function legacy(active?: ActiveSession) {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('legacy-wallet', 4);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('active'); req.result.createObjectStore('records', { keyPath: 'id' }).add(historical);
      const categories = req.result.createObjectStore('categories', { keyPath: 'id' });
      for (const category of DEFAULT_CATEGORIES) categories.add({ ...category });
      const settings = req.result.createObjectStore('settings');
      settings.put({ ownedCatIds: ['cat-02'], residentCatIds: ['cat-02'], companionCatId: 'cat-02' }, 'catHouse');
      settings.put([{ record: historical, earned: 120, settledAt: migrationTime - 1000 }], 'pendingCompletions');
      settings.put('builtin-computer', 'selectedCategoryId');
      if (active) req.transaction!.objectStore('active').put(active, 'only');
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  old.close(); db = await openDatabase('legacy-wallet'); return db;
}

it('migrates once: preserves history, XP, level and adoption, never exchanges history, and retains new coins on reopen', async () => {
  await legacy();
  expect(db!.version).toBe(6); expect(progress(await getRecords(db!))).toEqual(progress([historical]));
  expect(await getRecords(db!)).toEqual([historical]);
  expect((await getCatHouseState(db!))!.companionCatId).toBe('cat-02');
  expect((await getPendingCompletions(db!))[0]).toMatchObject({ earned: 120, coinsEarned: 0 });
  expect((await getWallet(db!)).state).toMatchObject({ balance: 0, remainderMs: 0, migratedAt: migrationTime });
  expect((await getWallet(db!)).transactions).toEqual([]);
  await save(5 * 60_000); const wallet = await getWallet(db!);
  db!.close(); db = await openDatabase('legacy-wallet');
  expect(await getWallet(db)).toEqual(wallet); expect(wallet.state.balance).toBe(1);
});

it('carries 3 + 2 minutes across sessions and reopen, independently from XP', async () => {
  db = await openDatabase('wallet');
  expect(await save(180_000)).toMatchObject({ earned: 3, coinsEarned: 0 });
  expect((await getWallet(db)).state).toMatchObject({ balance: 0, remainderMs: 180_000 });
  db.close(); db = await openDatabase('wallet');
  expect(await save(120_000)).toMatchObject({ earned: 2, coinsEarned: 1 });
  expect((await getWallet(db)).state).toMatchObject({ balance: 1, remainderMs: 0 });
  expect(progress(await getRecords(db)).experience).toBe(5);
  expect((await getPendingCompletions(db)).map(summary => summary.coinsEarned)).toEqual([0, 1]);
});

it('awards 2 coins for 12 minutes, retains 2 minutes, and carries fractional seconds exactly', async () => {
  db = await openDatabase('wallet'); await save(720_000);
  expect((await getWallet(db)).state).toMatchObject({ balance: 2, remainderMs: 120_000 });
  await save(179_999); expect((await getWallet(db)).state.remainderMs).toBe(299_999);
  await save(1); expect((await getWallet(db)).state).toMatchObject({ balance: 3, remainderMs: 0 });
});

it('repeated and concurrent settlements award once; a recovered duplicate record cannot mint again', async () => {
  db = await openDatabase('wallet'); const other = await openDatabase('wallet');
  const active = await startSession(db, 'builtin-english', 12, clock);
  const result = await Promise.all([settle(db, 'due', clock + 720_000), settle(other, 'early', clock + 720_000)]);
  expect(result.filter(item => item.created)).toHaveLength(1);
  expect(result.reduce((n, item) => n + (item.coinsEarned || 0), 0)).toBe(2);
  await settle(db, 'due', clock + 720_000);
  const before = await getWallet(db);
  const tx = db.transaction('active', 'readwrite'); tx.objectStore('active').put(active, 'only'); await complete(tx);
  await settle(db, 'due', clock + 720_000); expect(await getWallet(db)).toEqual(before);
  expect(before.receipts).toHaveLength(1); expect(before.transactions).toHaveLength(1); other.close();
});

it('cuts off the pre-migration portion of an active running stopwatch without changing the session', async () => {
  const active: ActiveSession = { id: 'migrating-session', categoryId: 'builtin-english', category: '英语', mode: 'stopwatch', targetMinutes: null,
    startedAt: migrationTime - 10 * 60_000, accumulatedMs: 120_000, status: 'running', runSinceMs: migrationTime - 300_000 };
  await legacy(active); expect(await getActive(db!)).toEqual(active);
  expect((await getWallet(db!)).state.baseline).toEqual({ sessionId: active.id, effectiveMs: 420_000 });
  await settle(db!, 'early', migrationTime + 180_000);
  expect((await getRecords(db!)).find(record => record.id === active.id)!.durationSeconds).toBe(600);
  expect((await getWallet(db!)).state).toMatchObject({ balance: 0, remainderMs: 180_000, baseline: null });
  clock = migrationTime + 181_000; await save(120_000);
  expect((await getWallet(db!)).state).toMatchObject({ balance: 1, remainderMs: 0 });
});

it('preserves paused migration sessions and excludes paused time, and caps an already due countdown at its target', async () => {
  const active: ActiveSession = { id: 'paused-legacy-session', categoryId: 'builtin-english', category: '英语', mode: 'stopwatch', targetMinutes: null,
    startedAt: migrationTime - 900_000, accumulatedMs: 420_000, status: 'paused', runSinceMs: null };
  await legacy(active); expect(await getActive(db!)).toEqual(active);
  await togglePause(db!, migrationTime + 600_000); await settle(db!, 'early', migrationTime + 900_000);
  expect((await getWallet(db!)).state).toMatchObject({ balance: 1, remainderMs: 0 });
  expect((await getRecords(db!)).find(record => record.id === active.id)!.durationSeconds).toBe(720);
});

it('does not award a countdown that had already finished before migration, even after reopening much later', async () => {
  const active: ActiveSession = { id: 'due-legacy-session', categoryId: 'builtin-english', category: '英语', mode: 'countdown', targetMinutes: 5,
    startedAt: migrationTime - 600_000, accumulatedMs: 0, status: 'running', runSinceMs: migrationTime - 600_000 };
  await legacy(active); await settle(db!, 'due', migrationTime + 86_400_000);
  expect((await getWallet(db!)).state).toMatchObject({ balance: 0, remainderMs: 0 });
  expect((await getWallet(db!)).receipts[0].eligibleMs).toBe(0);
  expect((await getRecords(db!)).find(record => record.id === active.id)!.endedAt).toBe(localIso(migrationTime - 300_000));
});

it('does not reward discarded time, includes a later countdown only after the migration boundary', async () => {
  const active: ActiveSession = { id: 'crossing-countdown', categoryId: 'builtin-english', category: '英语', mode: 'countdown', targetMinutes: 10,
    startedAt: migrationTime - 300_000, accumulatedMs: 0, status: 'running', runSinceMs: migrationTime - 300_000 };
  await legacy(active); await settle(db!, 'due', migrationTime + 600_000);
  expect((await getWallet(db!)).state.balance).toBe(1);
  clock = migrationTime + 601_000;
  await startStopwatch(db!, 'builtin-english', clock); await settle(db!, 'discard', clock + 600_000);
  expect((await getWallet(db!)).state).toMatchObject({ balance: 1, remainderMs: 0 });
});

it('spends a balance independently of XP with atomic, idempotent and concurrency-safe expenses', async () => {
  db = await openDatabase('wallet'); await save(1_500_000); const other = await openDatabase('wallet');
  const xp = progress(await getRecords(db));
  expect(await spendCoins(db, 'expense-first', 2, '测试支出')).toEqual({ balance: 3, created: true });
  expect(await spendCoins(db, 'expense-first', 2, '测试支出')).toEqual({ balance: 3, created: false });
  await expect(spendCoins(db, 'expense-first', 1, '测试支出')).rejects.toThrow('冲突');
  const outcomes = await Promise.allSettled([spendCoins(db, 'expense-second', 3, '测试支出'), spendCoins(other, 'expense-third', 3, '测试支出')]);
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const wallet = await getWallet(db); expect(wallet.state).toMatchObject({ balance: 0, totalIncome: 5, totalSpent: 5 });
  expect(wallet.transactions.reduce((n, tx) => n + tx.amount, 0)).toBe(0);
  expect(progress(await getRecords(db))).toEqual(xp);
  await expect(spendCoins(db, 'expense-negative', -1, '测试支出')).rejects.toThrow('无效'); other.close();
});

it('rolls back record, receipt, wallet, summary and active changes if ledger storage fails', async () => {
  db = await openDatabase('wallet'); await startStopwatch(db, 'builtin-english', clock);
  const active = await getActive(db), before = await getWallet(db);
  const add = IDBObjectStore.prototype.add;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === 'walletTransactions') throw Error('写入失败');
    return add.apply(this, args);
  });
  await expect(settle(db, 'early', clock + COIN_INTERVAL_MS)).rejects.toThrow('写入失败'); spy.mockRestore();
  expect(await getActive(db)).toEqual(active); expect(await getRecords(db)).toEqual([]);
  expect(await getPendingCompletions(db)).toEqual([]); expect(await getWallet(db)).toEqual(before);
  await settle(db, 'early', clock + COIN_INTERVAL_MS); expect((await getWallet(db)).state.balance).toBe(1);
});

it('backs up and restores wallet v5 without replaying income; imports old records without minting coins', async () => {
  db = await openDatabase('wallet'); await adoptInitialCat(db, 'cat-03'); await save(720_000);
  await spendCoins(db, 'expense-backup', 1, '测试支出'); const wallet = await getWallet(db);
  const raw = await exportBackup(db), backup = JSON.parse(raw);
  expect(backup.version).toBe(9); expect(DAILY_CHECKIN_COINS).toBe(5);
  const target = await openDatabase('target'); await importBackup(target, raw); await importBackup(target, raw);
  expect(await getWallet(target)).toEqual(wallet); expect((await getCatHouseState(target))!.companionCatId).toBe('cat-03');
  await spendCoins(target, 'expense-local', 1, '测试支出'); const local = await getWallet(target);
  await expect(importBackup(target, raw)).rejects.toThrow('钱包'); expect(await getWallet(target)).toEqual(local);
  const empty = await openDatabase('legacy-target');
  for (const version of [1, 2, 3, 4]) {
    const legacyBackup = structuredClone(backup); legacyBackup.version = version; delete legacyBackup.wallet;
    if (version === 1) delete legacyBackup.categories;
    if (version < 3) { for (const record of legacyBackup.records) { record.mode = 'countdown'; record.targetMinutes = 12; record.completed = false; } }
    // Keep IDs distinct when testing legacy mode conversion against v3/v4 stopwatch records.
    legacyBackup.records[0].id = `legacy-backup-${version}`;
    await importBackup(empty, JSON.stringify(legacyBackup));
  }
  expect((await getWallet(empty)).state).toMatchObject({ balance: 0, remainderMs: 0 });
  const invalid = structuredClone(backup); invalid.wallet.state.balance++;
  await expect(importBackup(empty, JSON.stringify(invalid))).rejects.toThrow('钱包');
  const badReceipt = structuredClone(backup); badReceipt.wallet.receipts[0].recordId = 'unknown-record';
  expect(() => validateWalletSnapshot(badReceipt.wallet)).toThrow(); target.close(); empty.close();
});

it('rolls back a staged wallet restore on category conflict and refuses restoration over an active session', async () => {
  db = await openDatabase('source'); await save(720_000);
  const raw = await exportBackup(db), backup = JSON.parse(raw);
  const target = await openDatabase('target');
  const before = await getWallet(target);
  backup.categories.find((category: { id: string }) => category.id === 'builtin-computer').name = '编程';
  await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow('冲突');
  expect(await getWallet(target)).toEqual(before); expect(await getRecords(target)).toEqual([]);
  const active = await startStopwatch(target, 'builtin-english', clock);
  await expect(importBackup(target, raw)).rejects.toThrow('先结束当前专注');
  expect(await getActive(target)).toEqual(active); expect(await getWallet(target)).toEqual(before);
  await settle(target, 'discard', clock + 1000); await importBackup(target, raw);
  expect((await getWallet(target)).state).toMatchObject({ balance: 2, remainderMs: 120_000 }); target.close();
});
