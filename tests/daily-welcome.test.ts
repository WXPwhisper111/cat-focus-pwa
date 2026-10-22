// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createDailyWelcome } from '../src/daily-welcome';
import { catDefinitions } from '../src/cat-definition';
import { getActive, getDailyCheckins, getRecords, getWallet, openDatabase, startStopwatch } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

it('shows the committed first-day bonus once, never starts a timer, and checks returning foreground dates without interrupting focus', async () => {
  mockDialogs(); vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  vi.useFakeTimers({ toFake: ['Date'] }); const firstDay = new Date(2026, 9, 21, 12).getTime(); vi.setSystemTime(firstDay);
  document.body.innerHTML = '<div id="app"></div>'; await import('../src/main');
  const db = await openDatabase();
  const welcome = () => document.querySelector<HTMLDialogElement>('.daily-welcome')!;
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  expect(welcome().open).toBe(true); expect(welcome().textContent).toContain('今日签到成功！');
  expect((await getWallet(db)).state.balance).toBe(5); expect(await getDailyCheckins(db)).toHaveLength(1);
  click('#welcome-start'); expect(welcome().open).toBe(false); expect(await getActive(db)).toBeUndefined();
  expect(document.querySelector('h1')!.textContent).toBe('专注一会儿吧');
  window.dispatchEvent(new Event('pageshow')); await flush(); expect(welcome().open).toBe(false);
  expect((await getWallet(db)).state.balance).toBe(5);
  click('[data-mode=stopwatch]'); await vi.waitFor(() => expect(document.querySelector('[data-mode=stopwatch]')!.getAttribute('aria-pressed')).toBe('true'));
  click('#start'); await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
  const active = await getActive(db);
  vi.setSystemTime(new Date(2026, 9, 22, 12));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(async () => expect((await getWallet(db)).state.balance).toBe(10));
  expect(welcome().open).toBe(false); expect(await getActive(db)).toEqual(active);
  expect(await getRecords(db)).toEqual([]); await vi.waitFor(() => expect(document.querySelector('.toast')?.textContent).toContain('+5 猫爪币'));
  click('#discard'); click('#end-confirm'); await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect(welcome().open).toBe(false); // No delayed popup after a non-blocking success message.

  vi.setSystemTime(new Date(2026, 9, 23, 12));
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'settings' && key === 'dailyCheckins') throw Error('存储失败'); return put.call(this, value, key);
  });
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(document.querySelector('.toast')!.textContent).toContain('签到暂未完成'));
  expect(welcome().open).toBe(false); expect((await getWallet(db)).state.balance).toBe(10);
  expect(await getDailyCheckins(db)).toHaveLength(2);
  spy.mockRestore(); window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(welcome().open).toBe(true));
  expect((await getWallet(db)).state.balance).toBe(15);
  click('#welcome-close'); expect(welcome().open).toBe(false); expect(await getActive(db)).toBeUndefined();
  expect(document.querySelector('.toast')?.textContent || '').not.toContain('签到暂未完成');
  window.dispatchEvent(new Event('pageshow')); await flush(); expect(welcome().open).toBe(false);
  expect(await getDailyCheckins(db)).toHaveLength(3);
  click('#manage-categories'); vi.setSystemTime(new Date(2026, 9, 24, 12));
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(async () => expect((await getWallet(db)).state.balance).toBe(20));
  expect(welcome().open).toBe(false); // Defer instead of stacking over an existing dialog.
  click('.dialog-close'); await vi.waitFor(() => expect(welcome().open).toBe(true));
  click('#welcome-close'); expect(await getDailyCheckins(db)).toHaveLength(4); db.close();
});

it('uses the chosen companion idle decoration and releases the player on close, Escape and destroy', async () => {
  document.body.innerHTML = '';
  mockDialogs(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } decode() { return Promise.resolve(); } });
  let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  const start = vi.fn(), welcome = createDailyWelcome(start);
  welcome.show(catDefinitions[2]); await flush();
  const dialog = document.querySelector<HTMLDialogElement>('.daily-welcome')!;
  expect(dialog.querySelector('img')!.getAttribute('src')).toContain('cat-03/mobile/idle/');
  expect(callbacks.size).toBe(1); dialog.querySelector<HTMLButtonElement>('#welcome-close')!.click(); expect(callbacks.size).toBe(0);
  expect(start).not.toHaveBeenCalled();
  welcome.show(catDefinitions[1]); await flush();
  dialog.dispatchEvent(new Event('cancel')); dialog.close(); expect(callbacks.size).toBe(0);
  welcome.show(catDefinitions[0]); await flush();
  dialog.querySelector<HTMLButtonElement>('#welcome-start')!.click(); expect(start).toHaveBeenCalledTimes(1); expect(callbacks.size).toBe(0);
  welcome.show(catDefinitions[0]); await flush(); welcome.destroy(); expect(callbacks.size).toBe(0);
  expect(document.querySelector('.daily-welcome')).toBeNull();
});
