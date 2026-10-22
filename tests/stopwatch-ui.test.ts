// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { adoptInitialCat, addCategory, getActive, getRecords, getTimerMode, openDatabase, togglePause } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('switches modes, counts upward, restores paused state, saves effective time and confirms discard', async () => {
  mockDialogs();
  vi.stubGlobal('indexedDB', new IDBFactory());
  let channel!: { onmessage: (() => void) | null };
  const messages: unknown[] = [];
  vi.stubGlobal('BroadcastChannel', class {
    onmessage = null;
    constructor() { channel = this; }
    postMessage(value: unknown) { messages.push(value); }
    close() {}
  });
  let tick = () => {};
  vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => { tick = callback as () => void; return 0 as never; });
  const start = Date.parse('2026-10-19T10:00:00+08:00');
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main');
  const db = await openDatabase();
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const clock = () => document.querySelector('#clock')!.textContent;
  const minutes = () => document.querySelector<HTMLInputElement>('#minutes')!;
  const switchMode = async (mode: 'stopwatch' | 'countdown') => {
    click(`[data-mode=${mode}]`);
    await vi.waitFor(() => expect(document.querySelector(`[data-mode=${mode}]`)!.getAttribute('aria-pressed')).toBe('true'));
  };

  minutes().value = '47'; minutes().dispatchEvent(new Event('input', { bubbles: true }));
  await switchMode('stopwatch');
  expect(document.querySelector('#minutes')).toBeNull();
  expect(clock()).toBe('00:00');
  expect(await getTimerMode(db)).toBe('stopwatch');
  await switchMode('countdown');
  expect(minutes().value).toBe('47');
  expect(clock()).toBe('47:00');
  minutes().value = ''; minutes().dispatchEvent(new Event('input', { bubbles: true }));
  await switchMode('stopwatch');

  await adoptInitialCat(db, 'orange-white');
  const category = await addCategory(db, '写作');
  channel.onmessage!();
  await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>('#category')!.value).toBe(category.id));
  const roomView = document.querySelector('.focus-cat-view');
  expect(document.querySelectorAll('.cat-card #cat')).toHaveLength(1);
  expect(document.querySelector('.room-scene')).toBeNull();
  expect(document.querySelectorAll('.room-hotspot')).toHaveLength(0);
  click('#start');
  await vi.waitFor(() => expect(document.querySelector('#early')?.textContent).toBe('结束并保存'));
  expect((await getActive(db))!).toMatchObject({ mode: 'stopwatch', targetMinutes: null, categoryId: category.id });
  expect(document.querySelector('[data-mode]')).toBeNull();
  now.mockReturnValue(start + 999); tick(); expect(clock()).toBe('00:00');
  now.mockReturnValue(start + 1_001); tick(); expect(clock()).toBe('00:01');
  now.mockReturnValue(start + 30_000); click('#pause');
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注'));
  expect(clock()).toBe('00:30');
  expect(document.querySelector('#cat')!.getAttribute('alt')).toContain('睡觉');
  expect(document.querySelector('.focus-cat-view')).toBe(roomView);

  now.mockReturnValue(start + 3_600_000); tick();
  window.dispatchEvent(new Event('pageshow'));
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注'));
  expect(clock()).toBe('00:30');
  expect(await getRecords(db)).toHaveLength(0);
  click('#pause');
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('暂停'));
  now.mockReturnValue(start + 3_661_000); tick(); expect(clock()).toBe('01:31');

  // A pause in a second page is reflected when its state broadcast arrives.
  await togglePause(db, start + 3_661_000);
  channel.onmessage!();
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注'));
  now.mockReturnValue(start + 7_200_000); tick(); expect(clock()).toBe('01:31');
  click('#early');
  await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(true));
  expect(document.querySelector('#summary-duration')!.textContent).toBe('1 分钟 31 秒');
  expect(document.querySelector('#summary-experience')!.textContent).toBe('+1');
  click('#summary-done');
  await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(false));
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect((await getRecords(db))[0]).toMatchObject({ mode: 'stopwatch', targetMinutes: null, durationSeconds: 91, category: '写作' });
  expect(document.querySelector('[data-mode=stopwatch]')!.getAttribute('aria-pressed')).toBe('true');
  expect(messages.length).toBeGreaterThan(0);

  click('#start'); await vi.waitFor(() => expect(document.querySelector('#discard')).not.toBeNull());
  click('#discard');
  expect(document.querySelector<HTMLDialogElement>('.end-confirmation')!.open).toBe(true);
  click('#end-cancel');
  expect(await getActive(db)).toBeDefined();
  now.mockReturnValue(start + 7_260_000); tick(); click('#discard'); click('#end-confirm');
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect(await getActive(db)).toBeUndefined();
  expect(await getRecords(db)).toHaveLength(1);
  db.close();
});
