// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createFocusTaskList } from '../src/focus-task-list';
import { addFocusTask, getFocusTasks } from '../src/focus-task-storage';
import { openDatabase } from '../src/storage';
import { mockDialogs } from './dialog-mocks';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
it('limits completion to the independent checkbox label and keeps all other actions separate',async()=>{
  mockDialogs();vi.stubGlobal('indexedDB',new IDBFactory());const db=await openDatabase();
  const task=await addFocusTask(db,'不会误完成');const choose=vi.fn(async()=>{});
  const list=createFocusTaskList(db,async()=>{},choose);document.body.append(list.element);await list.open();
  const dialog=document.querySelector<HTMLDialogElement>('.focus-task-dialog')!;
  const row=()=>dialog.querySelector<HTMLElement>('.focus-task-row')!;
  const click=(text:string)=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!.click();
  row().querySelector<HTMLElement>('.focus-task-check span')!.click();row().click();
  expect((await getFocusTasks(db))[0].status).toBe('pending');
  expect(row().querySelector('.focus-task-check')!.tagName).toBe('DIV');
  expect(row().querySelector('.focus-task-toggle')!.children).toHaveLength(1);
  click('编辑');expect(dialog.querySelector('.focus-task-editor')).not.toBeNull();click('取消');
  click('删除');expect(dialog.querySelector('.focus-task-delete')).not.toBeNull();click('保留');
  expect((await getFocusTasks(db))[0].status).toBe('pending');click('设为目标');
  await vi.waitFor(()=>expect(choose).toHaveBeenCalledWith(task.id));await vi.waitFor(()=>expect(dialog.open).toBe(false));
  expect((await getFocusTasks(db))[0].status).toBe('pending');await list.open();
  row().querySelector<HTMLElement>('.focus-task-toggle')!.click();
  await vi.waitFor(async()=>expect((await getFocusTasks(db))[0].status).toBe('completed'));
  await vi.waitFor(()=>expect(dialog.querySelector('[data-completed-list] input')).not.toBeNull());
  dialog.querySelector<HTMLElement>('[data-completed-list] .focus-task-toggle')!.click();
  await vi.waitFor(async()=>expect((await getFocusTasks(db))[0].status).toBe('pending'));
  list.destroy();db.close();
});
it('provides safe task CRUD in a compact dialog and retains unfinished inputs across updates',async()=>{
  mockDialogs();vi.stubGlobal('indexedDB',new IDBFactory());const db=await openDatabase();const list=createFocusTaskList(db,async()=>{});document.body.append(list.element);await list.open();
  const dialog=document.querySelector<HTMLDialogElement>('.focus-task-dialog')!,input=dialog.querySelector<HTMLInputElement>('#new-focus-task')!;
  const submit=()=>dialog.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  input.value='<img src=x onerror=alert(1)>';submit();await vi.waitFor(async()=>expect(await getFocusTasks(db)).toHaveLength(1));await vi.waitFor(()=>expect(dialog.querySelectorAll('.focus-task-row')).toHaveLength(1));
  expect(dialog.querySelector('img')).toBeNull();expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>');
  input.value='尚未添加';list.update(await getFocusTasks(db));expect(input.value).toBe('尚未添加');
  const click=(text:string)=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!.click();
  click('编辑');const editor=dialog.querySelector<HTMLFormElement>('.focus-task-editor')!;const editInput=editor.querySelector('input')!;editInput.value='修改成功';editInput.dispatchEvent(new Event('input'));editor.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(async()=>expect((await getFocusTasks(db))[0].title).toBe('修改成功'));await vi.waitFor(()=>expect(dialog.querySelector('.focus-task-editor')).toBeNull());
  const checkbox=dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!;checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));
  await vi.waitFor(async()=>expect((await getFocusTasks(db))[0].status).toBe('completed'));await vi.waitFor(()=>expect(dialog.querySelector('[data-completed-list] .focus-task-row')).not.toBeNull());
  click('删除');expect(await getFocusTasks(db)).toHaveLength(1);click('保留');expect(await getFocusTasks(db)).toHaveLength(1);click('删除');click('确认删除');
  await vi.waitFor(async()=>expect(await getFocusTasks(db)).toEqual([]));list.destroy();expect(document.querySelector('dialog')).toBeNull();db.close();
});

it('keeps unchanged rows and editor focus, reports failed writes and recovers without duplicate submission',async()=>{
  mockDialogs();vi.stubGlobal('indexedDB',new IDBFactory());const db=await openDatabase();
  const list=createFocusTaskList(db,async()=>{});document.body.append(list.element);await list.open();
  const input=document.querySelector<HTMLInputElement>('#new-focus-task')!, form=document.querySelector<HTMLFormElement>('.focus-task-add')!;
  const original=IDBObjectStore.prototype.add;
  const failure=vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name==='focusTasks')throw Error('磁盘写入失败');return original.call(this,value,key);});
  input.value='保留输入';form.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(document.querySelector('.focus-task-feedback')!.textContent).toContain('磁盘写入失败'));
  expect(input.value).toBe('保留输入');expect(await getFocusTasks(db)).toEqual([]);failure.mockRestore();
  form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(input.disabled).toBe(false));expect(await getFocusTasks(db)).toHaveLength(1);
  const row=document.querySelector('.focus-task-row');list.update(await getFocusTasks(db));list.update(await getFocusTasks(db));
  expect(document.querySelector('.focus-task-row')).toBe(row);
  list.close();db.close();await list.open();expect(document.querySelector('.focus-task-feedback')!.textContent).toContain('无法读取清单');list.destroy();
});

it('returns focus without scrolling and follows the visual viewport while the keyboard changes available height',async()=>{
  mockDialogs();vi.stubGlobal('indexedDB',new IDBFactory());
  const previous=Object.getOwnPropertyDescriptor(window,'visualViewport');const viewport=Object.assign(new EventTarget(),{height:350,offsetTop:0});
  Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  const db=await openDatabase();const list=createFocusTaskList(db,async()=>{});const trigger=document.createElement('button');document.body.append(trigger,list.element);trigger.focus();
  const focus=vi.spyOn(trigger,'focus');await list.open();const dialog=document.querySelector<HTMLDialogElement>('.focus-task-dialog')!;
  expect(dialog.style.getPropertyValue('--task-available-height')).toBe('350px');viewport.height=280;viewport.dispatchEvent(new Event('resize'));expect(dialog.style.getPropertyValue('--task-available-height')).toBe('280px');
  dialog.close();expect(focus).toHaveBeenCalledWith({preventScroll:true});list.destroy();viewport.height=200;viewport.dispatchEvent(new Event('resize'));expect(dialog.style.getPropertyValue('--task-available-height')).toBe('280px');
  focus.mockRestore();if(previous)Object.defineProperty(window,'visualViewport',previous);else Reflect.deleteProperty(window,'visualViewport');db.close();
});
