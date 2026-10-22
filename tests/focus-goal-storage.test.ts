import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { addFocusTask, changeFocusTask, completeSummaryTask, getFocusTaskState, selectFocusTask } from '../src/focus-task-storage';
import { getActive, getRecords, getWallet, exportBackup, importBackup, openDatabase, settle, startSession, startStopwatch, togglePause } from '../src/storage';
import { progress } from '../src/domain';
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
it('persists a single pending selection and cleans completed, deleted or stale choices',async()=>{
  const db=await openDatabase();const a=await addFocusTask(db,'甲'),b=await addFocusTask(db,'乙');await selectFocusTask(db,a.id);await selectFocusTask(db,b.id);expect((await getFocusTaskState(db)).selectedId).toBe(b.id);
  await selectFocusTask(db,null);expect((await getFocusTaskState(db)).selectedId).toBeNull();await selectFocusTask(db,a.id);
  await changeFocusTask(db,a.id,{status:'completed'});expect((await getFocusTaskState(db)).selectedId).toBeNull();await expect(selectFocusTask(db,a.id)).rejects.toThrow('未完成');
  await selectFocusTask(db,b.id);await changeFocusTask(db,b.id,{delete:true});expect((await getFocusTaskState(db)).selectedId).toBeNull();
  const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put('deleted-task-id','selectedFocusTaskId');await new Promise<void>(resolve=>tx.oncomplete=()=>resolve());
  expect((await getFocusTaskState(db)).selectedId).toBeNull();db.close();
});
it('freezes session snapshots through rename, future selection, pause, reopen, deletion and backup round-trip',async()=>{
  const db=await openDatabase();const a=await addFocusTask(db,'原始目标'),b=await addFocusTask(db,'下次目标');await selectFocusTask(db,a.id);await startStopwatch(db,'builtin-english',1000);
  const context={taskId:a.id,titleSnapshot:'原始目标'};await changeFocusTask(db,a.id,{title:'修改后的标题'});await selectFocusTask(db,b.id);await togglePause(db,11000);expect((await getActive(db))?.taskContext).toEqual(context);
  const reopened=await openDatabase();expect((await getActive(reopened))?.taskContext).toEqual(context);await togglePause(reopened,21000);await changeFocusTask(db,a.id,{delete:true});
  const ended=await settle(db,'early',31000);expect(ended.record?.taskContext).toEqual(context);expect(ended.record?.durationSeconds).toBe(20);expect((await getFocusTaskState(db)).selectedId).toBe(b.id);
  const raw=await exportBackup(db),target=await openDatabase('target');await importBackup(target,raw);expect((await getRecords(target))[0].taskContext).toEqual(context);
  expect(await completeSummaryTask(db,ended.record!.id)).toBe('missing');db.close();reopened.close();target.close();
});
it('never auto-completes goals or grants task rewards; explicit summary completion is idempotent',async()=>{
  const db=await openDatabase();const task=await addFocusTask(db,'读书');await selectFocusTask(db,task.id);await startSession(db,'builtin-english',5,1000);const result=await settle(db,'due',301000);
  expect(result.record?.completed).toBe(true);expect((await getFocusTaskState(db)).tasks[0].status).toBe('pending');expect((await getFocusTaskState(db)).selectedId).toBeNull();
  const before=await getWallet(db),experience=progress(await getRecords(db));await completeSummaryTask(db,result.record!.id,302000);await completeSummaryTask(db,result.record!.id,303000);
  expect((await getFocusTaskState(db)).tasks[0].status).toBe('completed');expect(await getWallet(db)).toEqual(before);expect(progress(await getRecords(db))).toEqual(experience);db.close();
});
it('preserves pending tasks on early save and discard, and supports sessions without goals',async()=>{
  const db=await openDatabase();const task=await addFocusTask(db,'未完成任务');await selectFocusTask(db,task.id);await startStopwatch(db,'builtin-english',1000);await settle(db,'early',31000);
  expect((await getFocusTaskState(db)).tasks[0].status).toBe('pending');await selectFocusTask(db,task.id);await startSession(db,'builtin-english',25,32000);await settle(db,'discard',33000);expect((await getFocusTaskState(db)).tasks[0].status).toBe('pending');
  await startStopwatch(db,'builtin-english',34000);expect((await getActive(db))?.taskContext).toBeUndefined();await settle(db,'early',35000);db.close();
});

it('rejects conflicting historical target snapshots without rewriting records',async()=>{
  const db=await openDatabase();const task=await addFocusTask(db,'任务标题');await selectFocusTask(db,task.id);await startStopwatch(db,'builtin-english',1000);await settle(db,'early',11000);
  const backup=JSON.parse(await exportBackup(db));backup.records[0].taskContext.titleSnapshot='另一个历史标题';
  await expect(importBackup(db,JSON.stringify(backup))).rejects.toThrow('冲突');expect((await getRecords(db))[0].taskContext?.titleSnapshot).toBe('任务标题');db.close();
});
