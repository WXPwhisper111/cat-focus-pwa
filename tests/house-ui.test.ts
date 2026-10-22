// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { adoptInitialCat, getActive, getRecords, openDatabase } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

it('keeps four-page navigation, one player, paused focus recovery, and single settlement while visiting the house', async () => {
  mockDialogs();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.useFakeTimers({ toFake: ['Date'] });
  const started = new Date(2026, 9, 20, 12).getTime(); vi.setSystemTime(started);
  let tick = () => {};
  vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => { tick = callback as () => void; return 0 as never; });
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    decode() { return Promise.resolve(); }
  });
  let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  document.body.innerHTML = '<div id="app"></div>'; await import('../src/main'); await flush();
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const db = await openDatabase();
  await adoptInitialCat(db, 'orange-white');
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(document.querySelector('.focus-cat-view')).not.toBeNull());
  expect([...document.querySelectorAll('nav button span')].map(el => el.textContent)).toEqual(['专注', '统计', '猫咪小屋', '设置']);
  expect(document.querySelector('.cat-card')).not.toBeNull(); expect(document.querySelector('.room-scene')).toBeNull();
  expect(callbacks.size).toBe(1);
  click('[data-mode=stopwatch]'); await vi.waitFor(() => expect(document.querySelector('[data-mode=stopwatch]')!.getAttribute('aria-pressed')).toBe('true'));
  click('#start'); await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
  vi.setSystemTime(started + 30_000); click('#pause');
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注')); await flush();
  const paused = await getActive(db);
  expect(document.querySelector('#cat')!.getAttribute('alt')).toContain('睡觉');
  for (let count = 0; count < 3; count++) {
    click('[data-page=room]'); await flush();
    expect(document.querySelector('h1')!.textContent).toBe('猫咪小屋');
    expect(document.querySelector('#cat')!.getAttribute('data-animation')).toBe('idle');
    expect(document.querySelectorAll('.room-scene')).toHaveLength(1); expect(callbacks.size).toBe(1);
    expect(document.querySelectorAll('.room-item-hit')).toHaveLength(5);
    expect(document.querySelectorAll('.room-cat-hit')).toHaveLength(1);
    click('[data-room-cat-target="orange-white"]');
    expect(document.querySelector<HTMLElement>('.room-interaction-panel')!.hidden).toBe(true);
    expect(document.querySelector('[data-room-cat-target="orange-white"]')!.getAttribute('aria-pressed')).toBe('true');
    click('[data-page=stats]'); await flush(); expect(callbacks.size).toBe(0);
    click('[data-page=settings]'); await flush(); expect(document.querySelector('#export')).not.toBeNull(); expect(callbacks.size).toBe(0);
    click('[data-page=focus]'); await flush(); expect(callbacks.size).toBe(1);
    expect(document.querySelector('#cat')!.getAttribute('alt')).toContain('睡觉');
    expect(document.querySelector('.room-scene')).toBeNull();
  }
  expect(await getActive(db)).toEqual(paused); expect(await getRecords(db)).toHaveLength(0);
  click('#discard'); click('#end-confirm'); await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  click('[data-mode=countdown]'); await vi.waitFor(() => expect(document.querySelector('#minutes')).not.toBeNull());
  const minutes = document.querySelector<HTMLInputElement>('#minutes')!; minutes.value = '1'; minutes.dispatchEvent(new Event('input'));
  click('#start'); await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
  const countdown = (await getActive(db))!;
  click('[data-page=room]'); await flush();
  vi.setSystemTime(countdown.startedAt + 60_000); tick();
  await vi.waitFor(async () => expect(await getRecords(db)).toHaveLength(1));
  tick(); tick(); await flush(); expect(await getRecords(db)).toHaveLength(1);
  expect(document.querySelector('h1')!.textContent).toBe('猫咪小屋');
  expect(document.querySelector('#cat')!.getAttribute('data-animation')).toBe('idle');
  expect(callbacks.size).toBe(1); expect(db.version).toBe(6);
  click('[data-page=settings]'); await flush(); expect(callbacks.size).toBe(0); db.close();
});
