// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { getCatHouseState, getCommerceState, getWallet, openDatabase, settle, startStopwatch } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

it('buys two real cats, renders three residents, shares the companion with focus, and keeps four navigation entries', async () => {
  mockDialogs(); vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  vi.useFakeTimers({ toFake: ['Date'] }); const now = new Date(2026, 9, 21, 12).getTime(); vi.setSystemTime(now);
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } decode() { return Promise.resolve(); } });
  let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  document.body.innerHTML = '<div id="app"></div>'; await import('../src/main');
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  click('#welcome-close'); click('[data-page=room]'); click('#confirm-adoption');
  await vi.waitFor(() => expect(document.querySelector('.room-scene')).not.toBeNull());
  click('[data-page=shop]'); expect(document.querySelectorAll('nav button')).toHaveLength(4);
  expect(document.querySelectorAll('[data-shop-detail]')).toHaveLength(6);
  click('[data-shop-detail=cat-cat-02]'); expect(document.querySelector<HTMLButtonElement>('#shop-buy')!.disabled).toBe(true);
  expect(document.querySelector('.shop-purchase-note')!.textContent).toContain('余额不足'); click('#shop-detail-close');
  const db = await openDatabase();
  await startStopwatch(db, 'builtin-english', now); await settle(db, 'early', now + 160 * 300_000);
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(document.querySelector('.shop-balance')!.textContent).toContain('165'));
  // The pending completion summary takes priority; acknowledge it before purchasing.
  click('#summary-done'); await flush();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  for (const id of ['cat-cat-02', 'cat-cat-03']) {
    click(`[data-shop-detail="${id}"]`); const buy = document.querySelector<HTMLButtonElement>('#shop-buy')!;
    buy.click(); buy.click();
    await vi.waitFor(() => expect(document.querySelector('#shop-buy')!.textContent).toBe('已拥有'));
    click('#shop-detail-close');
  }
  expect((await getWallet(db)).state.balance).toBe(5); expect((await getCommerceState(db)).purchases).toHaveLength(2);
  expect(document.querySelector('.toast')!.textContent).toContain('购买成功');
  click('[data-page=stats]');
  await vi.advanceTimersByTimeAsync(3000);
  expect(document.querySelector('.toast')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.querySelector('.toast')).toBeNull();
  click('[data-page=room]');
  click('[data-page=shop]');
  click('[data-shop-tab=furniture]'); expect(document.querySelectorAll('.shop-furniture .shop-card')).toHaveLength(2);
  expect(document.querySelector('.shop-furniture')!.textContent).toContain('已装备');
  click('#shop-back'); await flush();
  expect(document.querySelectorAll('[data-room-cat]')).toHaveLength(3); expect(callbacks.size).toBe(4);
  click('[data-room-cat-target=cat-02]');
  expect(document.querySelector<HTMLElement>('.room-interaction-panel')!.hidden).toBe(true);
  expect(document.querySelector('[data-room-cat-target=orange-white]')!.getAttribute('aria-pressed')).toBe('true');
  expect((await getCatHouseState(db))!.companionCatId).toBe('orange-white');
  expect(document.querySelectorAll('.room-contact-shadow span')).toHaveLength(9);
  click('[data-action-cat=cat-03]'); expect((await getCatHouseState(db))!.companionCatId).toBe('orange-white');
  expect(document.querySelector('[data-room-cat-target=cat-03]')!.getAttribute('aria-pressed')).toBe('true');
  click('[data-page=focus]'); await flush(); expect(callbacks.size).toBe(1);
  click('#focus-companion');click('[data-pick-companion=cat-03]');
  await vi.waitFor(()=>expect(document.querySelector('.focus-cat-view')!.getAttribute('data-cat-id')).toBe('cat-03'));
  expect((await getCatHouseState(db))!.residentCatIds).toEqual(['orange-white','cat-02','cat-03']);
  click('[data-page=stats]'); await flush(); expect(callbacks.size).toBe(0);
  click('[data-page=room]'); await flush(); expect(callbacks.size).toBe(4);
  expect(document.querySelector('.room-scene')!.getAttribute('data-cat-id')).toBe('orange-white');
  expect(document.querySelector('[data-action-cat=cat-03]')!.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector<HTMLElement>('.room-interaction-panel')!.hidden).toBe(true);
  click('[data-page=settings]'); await flush(); expect(callbacks.size).toBe(0); db.close();
});
