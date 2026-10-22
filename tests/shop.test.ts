import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catDefinitions } from '../src/cat-definition';
import { defaultCommerce, shopProducts } from '../src/shop';
import { progress } from '../src/domain';
import { adoptInitialCat, getActive, getCatHouseState, getCommerceState, getRecords, getWallet, openDatabase, purchaseProduct, setCompanionCat, settle, startStopwatch } from '../src/storage';

let db: IDBDatabase, now: number;
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.useFakeTimers({ toFake: ['Date'] }); now = new Date(2026, 9, 21, 12).getTime(); vi.setSystemTime(now); db = await openDatabase('shop'); });
afterEach(() => { db.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fund(coins: number) {
  await startStopwatch(db, 'builtin-english', now);
  now += coins * 300_000; await settle(db, 'early', now); vi.setSystemTime(++now);
}

it('uses three real cat definitions at 80 coins and four default-owned one-per-zone furniture slots', async () => {
  const cats = shopProducts.filter(product => product.kind === 'cat');
  expect(cats.map(product => product.price)).toEqual([80, 80, 80]);
  expect(cats.map(product => product.kind === 'cat' && product.catId)).toEqual(catDefinitions.map(cat => cat.id));
  const shop = await getCommerceState(db); expect(shop.inventory.ownedFurnitureIds).toHaveLength(4);
  expect(Object.keys(shop.inventory.equipped)).toEqual(['sleep', 'food', 'activity', 'play']);
  for (const id of shop.inventory.ownedFurnitureIds) expect(await purchaseProduct(db, id)).toMatchObject({ created: false, balance: 0 });
  expect((await getWallet(db)).transactions).toEqual([]); expect(await getCommerceState(db)).toEqual(defaultCommerce());
});

it('protects initial adoption and balance, refuses unknown goods and insufficient balances, never repurchases owned cats', async () => {
  await expect(purchaseProduct(db, 'cat-cat-02')).rejects.toThrow('先完成');
  await expect(purchaseProduct(db, 'fake-product')).rejects.toThrow('不存在');
  await adoptInitialCat(db, 'orange-white');
  expect(await purchaseProduct(db, 'cat-orange-white')).toEqual({ created: false, balance: 0 });
  await expect(purchaseProduct(db, 'cat-cat-02')).rejects.toThrow('余额不足');
  expect((await getCatHouseState(db))!.ownedCatIds).toEqual(['orange-white']);
  expect((await getCommerceState(db)).purchases).toEqual([]); expect((await getWallet(db)).state.balance).toBe(0);
});

it('unlocks and auto-resides both cats, spends exactly 160, preserves XP and timers, and persists after reopen', async () => {
  await adoptInitialCat(db, 'orange-white'); await fund(160);
  const xp = progress(await getRecords(db));
  await startStopwatch(db, 'builtin-english', now); const active = await getActive(db);
  await purchaseProduct(db, 'cat-cat-02'); await purchaseProduct(db, 'cat-cat-03');
  expect((await getWallet(db)).state).toMatchObject({ balance: 0, totalSpent: 160 });
  expect(progress(await getRecords(db))).toEqual(xp); expect(await getActive(db)).toEqual(active);
  expect((await getCatHouseState(db))!.residentCatIds).toEqual(['orange-white', 'cat-02', 'cat-03']);
  expect((await getCommerceState(db)).purchases).toHaveLength(2);
  await setCompanionCat(db, 'cat-03');
  db.close(); db = await openDatabase('shop');
  expect((await getCatHouseState(db))!.companionCatId).toBe('cat-03');
  expect((await getCatHouseState(db))!.ownedCatIds).toHaveLength(3);
  expect((await purchaseProduct(db, 'cat-cat-03')).created).toBe(false);
  expect((await getWallet(db)).state.balance).toBe(0);
  expect((await getCommerceState(db)).purchases).toHaveLength(2);
  await expect(setCompanionCat(db, 'missing-cat')).rejects.toThrow('已拥有');
});

it('serializes duplicate clicks and concurrent tabs for the same purchase', async () => {
  await adoptInitialCat(db, 'orange-white'); await fund(80); const other = await openDatabase('shop');
  const results = await Promise.all([purchaseProduct(db, 'cat-cat-02'), purchaseProduct(other, 'cat-cat-02')]);
  expect(results.filter(result => result.created)).toHaveLength(1);
  expect((await getWallet(db)).state.balance).toBe(0);
  expect((await getWallet(db)).transactions.filter(entry => entry.kind === 'spend')).toHaveLength(1);
  expect((await getCommerceState(db)).purchases).toHaveLength(1);
  expect((await getCatHouseState(db))!.residentCatIds).toHaveLength(2); other.close();
});

it('cannot overspend when different cats are purchased concurrently', async () => {
  await adoptInitialCat(db, 'orange-white'); await fund(80); const other = await openDatabase('shop');
  const results = await Promise.allSettled([purchaseProduct(db, 'cat-cat-02'), purchaseProduct(other, 'cat-cat-03')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await getWallet(db)).state.balance).toBe(0);
  expect((await getCatHouseState(db))!.ownedCatIds).toHaveLength(2); other.close();
});

it('rolls back money, ownership and receipts together if purchase persistence fails', async () => {
  await adoptInitialCat(db, 'orange-white'); await fund(80);
  const wallet = await getWallet(db), house = await getCatHouseState(db);
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'settings' && key === 'commerce') throw Error('购买写入失败'); return put.call(this, value, key);
  });
  await expect(purchaseProduct(db, 'cat-cat-02')).rejects.toThrow('写入失败'); spy.mockRestore();
  expect(await getWallet(db)).toEqual(wallet); expect(await getCatHouseState(db)).toEqual(house);
  expect((await getCommerceState(db)).purchases).toEqual([]);
  expect((await purchaseProduct(db, 'cat-cat-02')).created).toBe(true);
});
