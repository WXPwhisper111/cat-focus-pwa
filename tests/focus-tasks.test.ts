import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { addFocusTask, changeFocusTask, getFocusTasks } from '../src/focus-task-storage';
import { exportBackup, getActive, getCatHouseState, getRecords, getWallet, importBackup, openDatabase, startStopwatch } from '../src/storage';
import { taskTitle } from '../src/focus-tasks';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { initialWallet } from '../src/wallet';
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
it('validates Unicode titles, allows duplicates and persists CRUD without clearing at midnight',async()=>{
  const db=await openDatabase(); const first=await addFocusTask(db,'  阅读 📚  ',1000),second=await addFocusTask(db,'阅读 📚',1000);
  expect(first.title).toBe('阅读 📚');expect(first.id).not.toBe(second.id);
  expect(taskTitle('📚'.repeat(100))).toHaveLength(200); for(const value of [' ','a'.repeat(101)])await expect(addFocusTask(db,value)).rejects.toThrow();
  const renamed=(await changeFocusTask(db,first.id,{title:'修改标题'},first.updatedAt,2000))!;
  const completed=(await changeFocusTask(db,first.id,{status:'completed'},renamed.updatedAt,3000))!;expect(completed.completedAt).toBe(3000);
  const pending=(await changeFocusTask(db,first.id,{status:'pending'},completed.updatedAt,86_400_000))!;expect(pending.completedAt).toBeNull();
  db.close();const reopened=await openDatabase();expect(await getFocusTasks(reopened)).toHaveLength(2);
  await changeFocusTask(reopened,first.id,{delete:true},pending.updatedAt);expect((await getFocusTasks(reopened)).map(task=>task.id)).toEqual([second.id]);reopened.close();
});
it('serializes edits, detects stale operations and preserves all non-task state',async()=>{
  const a=await openDatabase(),b=await openDatabase();await startStopwatch(a,'builtin-english',1000);
  const before=await Promise.all([getActive(a),getRecords(a),getWallet(a),getCatHouseState(a)]);const task=await addFocusTask(a,'同一任务');
  const results=await Promise.allSettled([changeFocusTask(a,task.id,{title:'甲'},task.updatedAt),changeFocusTask(b,task.id,{title:'乙'},task.updatedAt)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(await Promise.all([getActive(a),getRecords(a),getWallet(a),getCatHouseState(a)])).toEqual(before);a.close();b.close();
});
it('round-trips v8 tasks, deduplicates import, rejects content conflicts atomically and accepts v6 without clearing local tasks',async()=>{
  const source=await openDatabase('source');const task=await addFocusTask(source,'测试清单',1000);const raw=await exportBackup(source),backup=JSON.parse(raw);
  expect(backup.version).toBe(9);expect(backup.versions.database).toBe(6);
  const target=await openDatabase('target');await importBackup(target,raw);await importBackup(target,raw);expect(await getFocusTasks(target)).toEqual([task]);
  backup.tasks[0].title='冲突标题';await expect(importBackup(target,JSON.stringify(backup))).rejects.toThrow('任务 ID');expect(await getFocusTasks(target)).toEqual([task]);
  backup.version=6;backup.versions.database=5;delete backup.tasks;await importBackup(target,JSON.stringify(backup));expect(await getFocusTasks(target)).toEqual([task]);source.close();target.close();
});
it('upgrades v5 while preserving an active session, wallet and existing stores',async()=>{
  const active={id:'legacy-session',categoryId:'builtin-english',category:'英语',mode:'stopwatch',targetMinutes:null,startedAt:1000,accumulatedMs:0,status:'running',runSinceMs:1000};
  const old=await new Promise<IDBDatabase>(resolve=>{const req=indexedDB.open('legacy-tasks',5);req.onupgradeneeded=()=>{
    const db=req.result;db.createObjectStore('active').put(active,'only');db.createObjectStore('records',{keyPath:'id'});db.createObjectStore('settings');
    const categories=db.createObjectStore('categories',{keyPath:'id'});DEFAULT_CATEGORIES.forEach(category=>categories.put(category));
    db.createObjectStore('wallet').put(initialWallet(1000),'only');db.createObjectStore('walletTransactions',{keyPath:'id'});db.createObjectStore('coinReceipts',{keyPath:'recordId'});
  };req.onsuccess=()=>resolve(req.result);});old.close();const db=await openDatabase('legacy-tasks');expect(db.version).toBe(6);expect(await getActive(db)).toEqual(active);expect((await getWallet(db)).state).toEqual(initialWallet(1000));expect(await getFocusTasks(db)).toEqual([]);db.close();
});

it('rolls back completion and selection together when task storage fails',async()=>{
  const { IDBObjectStore }=await import('fake-indexeddb');const { selectFocusTask,getFocusTaskState }=await import('../src/focus-task-storage');
  const db=await openDatabase();const task=await addFocusTask(db,'不要丢失选择');await selectFocusTask(db,task.id);const original=IDBObjectStore.prototype.put;
  const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name==='focusTasks')throw Error('保存失败');return original.call(this,value,key);});
  await expect(changeFocusTask(db,task.id,{status:'completed'})).rejects.toThrow('保存失败');spy.mockRestore();
  const state=await getFocusTaskState(db);expect(state.selectedId).toBe(task.id);expect(state.tasks[0].status).toBe('pending');db.close();
});
