import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adoptInitialCat, exportBackup, getActive, getCatHouseState, getDailyCheckins, getRecords, getWallet, grantDevelopmentCoins, importBackup, openDatabase, startStopwatch } from '../src/storage';
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('credits exactly 1000 once across concurrent connections, without changing focus, adoption, XP or check-ins',async()=>{
  const a=await openDatabase(), b=await openDatabase();
  await adoptInitialCat(a,'cat-02'); await startStopwatch(a,'builtin-english',1000);
  const active=await getActive(a), house=await getCatHouseState(a), before=await getWallet(a);
  const result=await Promise.all([grantDevelopmentCoins(a,2000),grantDevelopmentCoins(b,2000)]);
  expect(result.filter(item=>item.created)).toHaveLength(1);
  const after=await getWallet(a); expect(after.state.balance-before.state.balance).toBe(1000); expect(after.state.totalIncome-before.state.totalIncome).toBe(1000);
  expect(after.transactions.filter(tx=>tx.kind==='test_grant')).toHaveLength(1); expect(await getActive(a)).toEqual(active); expect(await getCatHouseState(a)).toEqual(house);
  expect(await getRecords(a)).toEqual([]); expect(await getDailyCheckins(a)).toEqual([]);
  expect((await grantDevelopmentCoins(b)).created).toBe(false);
  const backup=await exportBackup(a), target=await openDatabase('restore-test'); await importBackup(target,backup);
  expect((await getWallet(target)).state.balance).toBe(1000); expect(JSON.parse(backup).growth.experience).toBe(0);
  a.close();b.close();target.close();
});
it('rejects production grants and rolls back both balance and ledger on storage failure',async()=>{
  const db=await openDatabase(); vi.stubEnv('DEV',false); await expect(grantDevelopmentCoins(db)).rejects.toThrow('开发环境'); vi.stubEnv('DEV',true);
  const original=IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name==='walletTransactions')throw Error('write failed');return original.call(this,value,key);});
  await expect(grantDevelopmentCoins(db)).rejects.toThrow('write failed'); expect((await getWallet(db)).state.balance).toBe(0); expect((await getWallet(db)).transactions).toEqual([]); db.close();
});
