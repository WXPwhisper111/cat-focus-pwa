import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseBackup, progress } from '../src/domain';
import { adoptInitialCat, checkinToday, exportBackup, getCatHouseState, getCommerceState, getDailyCheckins, getRecords, getWallet, importBackup, openDatabase, purchaseProduct, setCompanionCat, settle, startStopwatch } from '../src/storage';

let db: IDBDatabase, now: number;
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.useFakeTimers({ toFake: ['Date'] }); now = new Date(2026, 9, 21, 12).getTime(); vi.setSystemTime(now); db = await openDatabase('release'); });
afterEach(() => { db.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function purchasedBackup() {
  await adoptInitialCat(db, 'orange-white'); await checkinToday(db, now);
  await startStopwatch(db, 'builtin-english', now); await settle(db, 'early', now + 160 * 300_000);
  await purchaseProduct(db, 'cat-cat-02'); await purchaseProduct(db, 'cat-cat-03'); await setCompanionCat(db, 'cat-03');
  return JSON.parse(await exportBackup(db));
}

it('restores all v6 fields atomically, reopens offline-ready local data, and deduplicates same-day rewards and repeated import', async () => {
  const backup = await purchasedBackup(), target = await openDatabase('target');
  expect(backup.version).toBe(10); expect(backup.versions).toEqual({ database: 6, wallet: 1, commerce: 1, growth: 'focus-minutes-v1' });
  expect(backup.commerce.purchases).toHaveLength(2); expect(backup.checkins).toHaveLength(1);
  expect(backup.growth).toEqual({ experience: progress(backup.records).experience, level: progress(backup.records).level });
  await checkinToday(target, now + 1000); await importBackup(target, JSON.stringify(backup)); await importBackup(target, JSON.stringify(backup));
  expect(await getWallet(target)).toEqual(await getWallet(db));
  expect(await getCommerceState(target)).toEqual(await getCommerceState(db));
  expect(await getCatHouseState(target)).toEqual(await getCatHouseState(db));
  expect(await getRecords(target)).toEqual(await getRecords(db));
  expect((await checkinToday(target, now + 2000)).created).toBe(false);
  target.close(); const reopened = await openDatabase('target');
  expect((await getWallet(reopened)).state.balance).toBe(5);
  expect((await getCatHouseState(reopened))!.residentCatIds).toHaveLength(3);
  expect(await getDailyCheckins(reopened)).toHaveLength(1); reopened.close();
});

it('accepts older v1–v5 files without resetting local new coins or rewarding imported focus and repeats safely', async () => {
  await adoptInitialCat(db, 'orange-white'); await startStopwatch(db, 'builtin-english', now); await settle(db, 'early', now + 300_000);
  const source = JSON.parse(await exportBackup(db));
  for (const version of [1, 2, 3, 4, 5]) {
    const target = await openDatabase(`legacy-${version}`); await checkinToday(target, now);
    const backup = structuredClone(source); backup.version = version;
    delete backup.commerce; delete backup.checkins; delete backup.versions; delete backup.growth;
    if (version < 5) delete backup.wallet;
    if (version < 3) { for (const record of backup.records) { delete record.mode; record.targetMinutes = 5; } }
    if (version === 1) delete backup.categories;
    await importBackup(target, JSON.stringify(backup)); await importBackup(target, JSON.stringify(backup));
    expect((await getWallet(target)).state.balance).toBe(version < 5 ? 5 : 6);
    expect(progress(await getRecords(target)).experience).toBe(5);
    expect(await getDailyCheckins(target)).toHaveLength(1);
    expect((await checkinToday(target, now + 1000)).created).toBe(false); target.close();
  }
});

it('rejects incomplete or inconsistent v6 ownership, purchases, slots, history, versions and growth without touching data', async () => {
  const source = await purchasedBackup(), target = await openDatabase('target'); await checkinToday(target, now);
  const before = await getWallet(target);
  const mutations: ((value: typeof source) => void)[] = [
    value => { value.commerce.purchases[0].price = 1; },
    value => { value.commerce.purchases = []; },
    value => { value.commerce.inventory.equipped.sleep = 'basic-rug'; },
    value => { value.catHouse.ownedCatIds.pop(); },
    value => { value.catHouse.residentCatIds.push('cat-03'); },
    value => { value.catHouse.companionCatId = 'missing-cat'; },
    value => { value.checkins = []; },
    value => { value.checkins[0].reward = 10; },
    value => { value.versions.wallet = 999; },
    value => { value.growth.experience++; },
  ];
  for (const mutate of mutations) {
    const backup = structuredClone(source); mutate(backup);
    await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow();
    expect(await getWallet(target)).toEqual(before); expect(await getCatHouseState(target)).toBeNull();
    expect((await getCommerceState(target)).purchases).toEqual([]); expect(await getRecords(target)).toEqual([]);
  }
  target.close();
});

it('rolls back restored wallet and commerce if a later local ownership conflict is found', async () => {
  const source = await purchasedBackup(), target = await openDatabase('target');
  await adoptInitialCat(target, 'cat-02'); await checkinToday(target, now);
  const before = await getWallet(target), house = await getCatHouseState(target);
  await expect(importBackup(target, JSON.stringify(source))).rejects.toThrow('领养状态');
  expect(await getWallet(target)).toEqual(before); expect(await getCatHouseState(target)).toEqual(house);
  expect((await getCommerceState(target)).purchases).toEqual([]); target.close();
});

it('accepts reordered JSON history fields and duplicate identical records while keeping growth validation exact', async () => {
  const backup = await purchasedBackup();
  backup.records.push(structuredClone(backup.records[0]));
  backup.checkins = backup.checkins.map((row: { reward: number; date: string; claimedAt: number; transactionId: string }) => ({ transactionId: row.transactionId, reward: row.reward, claimedAt: row.claimedAt, date: row.date }));
  expect(parseBackup(JSON.stringify(backup)).records).toHaveLength(1);
});

it('prepares explicit isolated browser fixtures through public storage APIs, without fabricating user records', async () => {
  // Synthetic calendar days are test data for the shop UI, never real account rewards.
  await adoptInitialCat(db, 'orange-white');
  for (let day = 1; day <= 16; day++) await checkinToday(db, new Date(2026, 8, day, 12).getTime());
  const raw = await exportBackup(db); expect((await getWallet(db)).state.balance).toBe(130);
  expect(await getRecords(db)).toEqual([]);
  const directory = 'art/release-v0.2/fixtures'; await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/shop-130-test-only.json`, raw);
  for (let day = 17; day <= 32; day++) await checkinToday(db, new Date(2026, 8, day, 12).getTime());
  await writeFile(`${directory}/shop-with-checkin-bonuses-test-only.json`, await exportBackup(db));
  await purchaseProduct(db, 'cat-cat-02');
  await writeFile(`${directory}/owned-two-test-only.json`, await exportBackup(db));
  await purchaseProduct(db, 'cat-cat-03');
  await writeFile(`${directory}/owned-three-test-only.json`, await exportBackup(db));
});
