// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalRepository } from '../src/local-repository';
import { createFocusTaskListWithRepository } from '../src/focus-task-list';
import { openDatabase } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('runs UI CRUD through the injected repository, retaining a failed input for retry', async () => {
  mockDialogs(); vi.stubGlobal('indexedDB', new IDBFactory());
  const db = await openDatabase('repository-ui'), tasks = createLocalRepository(db).focusTasks;
  const changed = vi.fn(async () => {}), add = vi.spyOn(tasks, 'add'), change = vi.spyOn(tasks, 'change');
  const select = vi.fn(async (id: string | null) => tasks.select(id));
  const list = createFocusTaskListWithRepository(tasks, changed, select);
  document.body.append(list.element);
  try {
    await list.open();
    const dialog = document.querySelector<HTMLDialogElement>('.focus-task-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('#new-focus-task')!;
    const submit = () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const click = (label: string) => [...dialog.querySelectorAll('button')].find(button => button.textContent === label)!.click();
    const original = IDBObjectStore.prototype.add;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'focusTasks') throw Error('存储写入失败');
      return original.call(this, value, key);
    });
    input.value = '从页面添加'; submit();
    await vi.waitFor(() => expect(dialog.querySelector('.focus-task-feedback')!.textContent).toContain('存储写入失败'));
    expect(changed).not.toHaveBeenCalled(); expect(input.value).toBe('从页面添加');
    expect(await tasks.list()).toEqual([]); failure.mockRestore();
    submit(); await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const task = (await tasks.list())[0]; expect(add).toHaveBeenCalledWith('从页面添加');
    click('设为目标'); await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(select).toHaveBeenCalledWith(task.id); expect((await tasks.getState()).selectedId).toBe(task.id);
    await list.open(); click('编辑');
    const editor = dialog.querySelector<HTMLFormElement>('.focus-task-editor')!, field = editor.querySelector('input')!;
    field.value = '从页面编辑'; field.dispatchEvent(new Event('input')); editor.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('.focus-task-editor')).toBeNull());
    expect(change).toHaveBeenCalledWith(task.id, { title: '从页面编辑' }, task.updatedAt);
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(dialog.querySelector('[data-completed-list] .focus-task-row')).not.toBeNull());
    expect((await tasks.getState()).selectedId).toBeNull();
    click('删除'); click('确认删除');
    await vi.waitFor(() => expect(dialog.querySelectorAll('.focus-task-row')).toHaveLength(0));
    expect(await tasks.list()).toEqual([]);
  } finally { list.destroy(); db.close(); }
});
