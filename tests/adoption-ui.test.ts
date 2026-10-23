// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { acknowledgeCompletion, getActive, getCatHouseState, getPendingCompletions, getRecords, openDatabase, settle, startSession } from '../src/storage';
import { createCatAdoption } from '../src/cat-adoption';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

it('lets old users choose once, previews one cat, persists confirmation and shares the companion across pages', async () => {
  mockDialogs(); vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  vi.useFakeTimers({ toFake: ['Date'] }); const now = new Date(2026, 9, 20, 12).getTime(); vi.setSystemTime(now);
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } decode() { return Promise.resolve(); } });
  let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  const db = await openDatabase();
  await startSession(db, 'builtin-english', 25, now - 61_000); await settle(db, 'early', now);
  for (const pending of await getPendingCompletions(db)) await acknowledgeCompletion(db, pending.record.id);
  const records = await getRecords(db);
  document.body.innerHTML = '<div id="app"></div>'; await import('../src/main'); await flush();
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  expect(document.querySelector('#cat')).toBeNull();
  expect(document.querySelector('.focus-cat-empty')!.textContent).toContain('领养');
  expect(callbacks.size).toBe(0);
  click('[data-page=stats]'); await flush();
  expect(document.querySelector('.stats-header-cat')).toBeNull();
  click('[data-stats-range=today]');
  expect(document.querySelector('.stats-growth img')).toBeNull();
  expect(document.querySelector('.stats-unadopted')).not.toBeNull();
  click('[data-page=focus]'); click('.focus-cat-empty button'); await flush();
  expect(document.querySelector('h1')!.textContent).toBe('领养一位小伙伴');
  expect(document.querySelectorAll('[data-cat-choice]')).toHaveLength(6); expect(callbacks.size).toBe(1);
  expect(await getCatHouseState(db)).toBeNull();
  for (const id of ['cat-02', 'cat-03', 'orange-white', 'cat-03']) {
    click(`[data-cat-choice="${id}"]`); await flush();
    expect(document.querySelector('[data-cat-choice][aria-pressed=true]')!.getAttribute('data-cat-choice')).toBe(id);
    expect(document.querySelectorAll('.adoption-preview[data-animation=idle]')).toHaveLength(1);
    expect(callbacks.size).toBe(1); expect(await getCatHouseState(db)).toBeNull();
  }
  const confirm = document.querySelector<HTMLButtonElement>('#confirm-adoption')!; confirm.click(); confirm.click();
  await vi.waitFor(() => expect(document.querySelector('.room-scene')).not.toBeNull()); await flush();
  const saved = { ownedCatIds: ['cat-03'], residentCatIds: ['cat-03'], companionCatId: 'cat-03' };
  expect(await getCatHouseState(db)).toEqual(saved);
  expect(document.querySelector('.room-scene')!.getAttribute('data-cat-id')).toBe('cat-03');
  expect(document.querySelector('#cat')!.getAttribute('src')).toContain('cat-03/mobile/idle/');
  expect(document.querySelectorAll('[data-room-object=cat]')).toHaveLength(1); expect(callbacks.size).toBe(1);
  click('[data-page=focus]'); await flush();
  expect(document.querySelector('.focus-cat-view')!.getAttribute('data-cat-id')).toBe('cat-03');
  click('[data-mode=stopwatch]'); await vi.waitFor(() => expect(document.querySelector('[data-mode=stopwatch]')!.getAttribute('aria-pressed')).toBe('true'));
  click('#start'); await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
  vi.setSystemTime(now + 30_000); click('#pause'); await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注')); await flush();
  expect(document.querySelector('#cat')!.getAttribute('src')).toContain('cat-03/mobile/sleep_loop/');
  const paused = await getActive(db);
  for (let count = 0; count < 3; count++) {
    click('[data-page=room]'); await flush();
    expect(document.querySelector('#confirm-adoption')).toBeNull(); expect(document.querySelector('#cat')!.getAttribute('data-animation')).toBe('idle');
    expect(callbacks.size).toBe(1);
    click('[data-page=focus]'); await flush(); expect(callbacks.size).toBe(1);
    expect(document.querySelector('#cat')!.getAttribute('src')).toContain('cat-03/mobile/sleep_loop/');
  }
  expect(await getActive(db)).toEqual(paused); expect(await getRecords(db)).toEqual(records);
  const reopened = await openDatabase(); expect(await getCatHouseState(reopened)).toEqual(saved); expect(reopened.version).toBe(6); reopened.close();
  click('[data-page=stats]'); await flush(); expect(callbacks.size).toBe(0);
  expect(document.querySelector('[data-stat=today]')!.getAttribute('data-milliseconds')).toBe('61000');
  expect(document.querySelector('.stats-header-cat')!.getAttribute('src')).toContain('cat-03/mobile/sleep_loop/');
  expect(document.querySelector('.stats-growth img')!.getAttribute('src')).toContain('cat-03/mobile/idle/');
  expect(document.querySelector('.stats-growth img')!.getAttribute('alt')).toBe('橘宝');
  click('[data-page=settings]'); await flush(); expect(document.querySelector('#export')).not.toBeNull(); expect(callbacks.size).toBe(0); db.close();
});

it('keeps the selected card and permits retry when confirming cannot be saved', async () => {
  document.body.innerHTML = '';
  const save = vi.fn(async () => { throw Error('存储空间不足，未保存'); });
  const adoption = createCatAdoption(save); document.body.append(adoption.element);
  adoption.element.querySelector<HTMLButtonElement>('[data-cat-choice=cat-02]')!.click();
  adoption.element.querySelector<HTMLButtonElement>('#confirm-adoption')!.click(); await flush();
  expect(save).toHaveBeenCalledWith('cat-02');
  expect(adoption.element.querySelector('[data-cat-choice=cat-02]')!.getAttribute('aria-pressed')).toBe('true');
  expect(adoption.element.querySelector('.adoption-error')!.textContent).toContain('未保存');
  expect(adoption.element.querySelector<HTMLButtonElement>('#confirm-adoption')!.disabled).toBe(false); adoption.destroy();
});
