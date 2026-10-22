// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { getActive, getCategoryState, getRecords, openDatabase, setCategoryArchived } from '../src/storage';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('adds, selects, saves, archives and restores a category without losing the draft duration', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); },
  });
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main');
  const db = await openDatabase();
  const minutes = () => document.querySelector<HTMLInputElement>('#minutes')!;
  const selected = () => document.querySelector<HTMLSelectElement>('#category')!;
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const submit = () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const action = (label: string) => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label)!;

  minutes().value = '42'; minutes().dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('#clock')!.textContent).toBe('42:00');
  click('#manage-categories');
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(input);
  click('.dialog-close');
  expect(minutes().value).toBe('42');
  expect(document.activeElement).toBe(document.querySelector('#manage-categories'));

  click('#manage-categories'); input.value = '  <阅读>  '; submit();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  const categoryId = selected().value;
  expect(selected().selectedOptions[0].textContent).toBe('<阅读>');
  expect(document.querySelector('阅读')).toBeNull();
  expect(minutes().value).toBe('42');
  expect((await getCategoryState(db)).selectedId).toBe(categoryId);

  click('#start');
  await vi.waitFor(() => expect(document.querySelector('#early')).not.toBeNull());
  const active = (await getActive(db))!;
  expect(active).toMatchObject({ categoryId, category: '<阅读>', targetMinutes: 42 });
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(active.startedAt + 30_000);
  click('#early');
  expect(document.querySelector<HTMLDialogElement>('.end-confirmation')!.open).toBe(true);
  click('#end-confirm');
  await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(true));
  click('#summary-done');
  await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(false));
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  nowSpy.mockRestore();
  expect((await getRecords(db))[0]).toMatchObject({ categoryId, category: '<阅读>', durationSeconds: 30 });

  click('#manage-categories'); action('停用<阅读>').click();
  await vi.waitFor(() => expect(action('恢复<阅读>')).toBeDefined());
  expect([...selected().options].some(option => option.value === categoryId)).toBe(false);
  expect(minutes().value).toBe('42');
  input.value = '<阅读>'; submit();
  await vi.waitFor(() => expect(dialog.querySelector('.category-error')!.textContent).toContain('恢复原类别'));
  const restore = [...dialog.querySelectorAll<HTMLButtonElement>('.category-error button')][0];
  expect(restore.textContent).toBe('恢复并选中'); restore.click();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(selected().value).toBe(categoryId);
  expect((await getCategoryState(db)).categories).toHaveLength(5);
  expect((await getRecords(db))[0].categoryId).toBe(categoryId);

  selected().value = 'builtin-computer'; selected().dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(async () => expect((await getCategoryState(db)).selectedId).toBe('builtin-computer'));
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(selected().value).toBe('builtin-computer'));
  expect(minutes().value).toBe('42');

  click('#manage-categories'); action('停用英语').click();
  await vi.waitFor(() => expect(action('恢复英语')).toBeDefined());
  action('停用<阅读>').click();
  await vi.waitFor(() => expect(action('恢复<阅读>')).toBeDefined());
  action('停用健身').click();
  await vi.waitFor(() => expect(action('恢复健身')).toBeDefined());
  action('停用数学').click();
  await vi.waitFor(() => expect(action('恢复数学')).toBeDefined());
  expect(action('停用计算机').disabled).toBe(true);
  click('.dialog-close');

  // Simulate a category being disabled by another page after this page rendered.
  await setCategoryArchived(db, categoryId, false);
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect([...selected().options].some(option => option.value === categoryId)).toBe(true));
  selected().value = categoryId; selected().dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(async () => expect((await getCategoryState(db)).selectedId).toBe(categoryId));
  const other = await openDatabase(db.name);
  await setCategoryArchived(other, categoryId, true);
  click('#start');
  await vi.waitFor(() => expect(document.querySelector('.toast')!.textContent).toContain('已停用'));
  expect(await getActive(db)).toBeUndefined();
  other.close(); db.close();
});
