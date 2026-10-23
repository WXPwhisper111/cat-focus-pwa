import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { adoptInitialCat,openDatabase,getCatExpansion,claimExpansionCat,getCatHouseState,purchaseProduct,getWallet,startStopwatch,settle,manageResidents,exportBackup,importBackup,request,transact } from '../src/storage';
import { EXPANSION_KEY } from '../src/cat-expansion-state';
import { parseBackup } from '../src/domain';
let db:IDBDatabase;
beforeEach(async()=>{vi.stubGlobal('indexedDB',new IDBFactory());db=await openDatabase('six');});
afterEach(()=>{db.close();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function legacy(){await adoptInitialCat(db,'orange-white');await transact(db,['settings'],'readwrite',async tx=>{await request(tx.objectStore('settings').delete(EXPANSION_KEY));});const name=db.name;db.close();db=await openDatabase(name);}
async function funded(){await startStopwatch(db,'builtin-english',1000);await settle(db,'early',180001000);}
it('gives new users six choices but no extra entitlement, and recognizes legacy adoption exactly once',async()=>{
  await adoptInitialCat(db,'cat-06');expect((await getCatHouseState(db))?.companionCatId).toBe('cat-06');expect((await getCatExpansion(db)).eligible).toBe(false);
  await expect(claimExpansionCat(db,'cat-04')).rejects.toThrow('名额');
  db.close();db=await openDatabase('legacy');await legacy();expect((await getCatExpansion(db)).eligible).toBe(true);
  await expect(claimExpansionCat(db,'cat-02')).rejects.toThrow('新增');
});
it('serializes concurrent free claims and keeps wallet untouched across reopen and backup restore',async()=>{
  await legacy();const wallet=await getWallet(db);const second=await openDatabase('six');
  try{const results=await Promise.allSettled([claimExpansionCat(db,'cat-04',1000),claimExpansionCat(second,'cat-05',1001)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);}finally{second.close();}
  expect(await getWallet(db)).toEqual(wallet);const grant=await getCatExpansion(db);expect(grant.claimed).not.toBeNull();
  const raw=await exportBackup(db);expect(JSON.parse(raw).version).toBe(9);expect(parseBackup(raw).expansion).toEqual(grant);
  db.close();db=await openDatabase('six');expect(await getCatExpansion(db)).toEqual(grant);
  const target=await openDatabase('restore');try{await importBackup(target,raw);await importBackup(target,raw);expect(await getCatExpansion(target)).toEqual(grant);await expect(claimExpansionCat(target,'cat-06')).rejects.toThrow('名额');}finally{target.close();}
});
it('buys six permanent cats with three residents, manages replacements without changing companion, rejects the last departure',async()=>{
  await adoptInitialCat(db,'orange-white');await funded();
  for(const id of ['cat-02','cat-03','cat-04','cat-05','cat-06'])await purchaseProduct(db,`cat-${id}`);
  const house=(await getCatHouseState(db))!;expect(house.ownedCatIds).toHaveLength(6);expect(house.residentCatIds).toEqual(['orange-white','cat-02','cat-03']);
  const before=await getWallet(db);expect((await purchaseProduct(db,'cat-cat-04')).created).toBe(false);expect(await getWallet(db)).toEqual(before);
  await manageResidents(db,'cat-04','in','orange-white');expect((await getCatHouseState(db))?.companionCatId).toBe('orange-white');
  await manageResidents(db,'cat-02','out');await manageResidents(db,'cat-03','out');await expect(manageResidents(db,'cat-04','out')).rejects.toThrow('至少');
  expect(await getWallet(db)).toEqual(before);
});
it('restores old backups with eligibility on a fresh device, never regrants locally, and rolls back conflicting v9 claims',async()=>{
  await legacy();const raw=JSON.parse(await exportBackup(db));raw.version=8;delete raw.expansion;
  const target=await openDatabase('old-restore');try{await importBackup(target,JSON.stringify(raw));expect((await getCatExpansion(target)).eligible).toBe(true);}finally{target.close();}
  await claimExpansionCat(db,'cat-04',1000);const grant=await getCatExpansion(db);await expect(importBackup(db,JSON.stringify(raw))).rejects.toThrow();expect(await getCatExpansion(db)).toEqual(grant);
  const incoming=JSON.parse(await exportBackup(db));incoming.expansion.claimed.claimedAt=1001;await expect(importBackup(db,JSON.stringify(incoming))).rejects.toThrow('领取记录冲突');expect(await getCatExpansion(db)).toEqual(grant);
});
it('rolls back ownership when the free-claim record fails to save',async()=>{
  await legacy();const before=await getCatHouseState(db);const original=IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){if(key===EXPANSION_KEY)throw Error('disk');return original.call(this,value,key!);});
  await expect(claimExpansionCat(db,'cat-04')).rejects.toThrow('disk');expect(await getCatHouseState(db)).toEqual(before);expect((await getCatExpansion(db)).claimed).toBeNull();
});

it('claims into a full house without replacing residents or changing companion',async()=>{
  await legacy();await funded();await purchaseProduct(db,'cat-cat-02');await purchaseProduct(db,'cat-cat-03');
  const before=(await getCatHouseState(db))!;await claimExpansionCat(db,'cat-06',1000);
  const after=(await getCatHouseState(db))!;expect(after.ownedCatIds).toContain('cat-06');expect(after.residentCatIds).toEqual(before.residentCatIds);expect(after.companionCatId).toBe(before.companionCatId);
  expect(parseBackup(await exportBackup(db)).expansion?.claimed?.catId).toBe('cat-06');
});

it('rejects malformed entitlement metadata and eligibility without an adopted owner',async()=>{
  const data=JSON.parse(await exportBackup(db));
  data.expansion={version:1,eligible:true,claimed:null};expect(()=>parseBackup(JSON.stringify(data))).toThrow();
  data.expansion={version:1,eligible:false};expect(()=>parseBackup(JSON.stringify(data))).toThrow('领取记录');
});
