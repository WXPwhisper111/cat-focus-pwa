// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import * as storage from '../src/storage';
import { mockDialogs } from './dialog-mocks';
vi.mock('../src/storage', async original => {
  const actual = await original<typeof import('../src/storage')>();
  return { ...actual, getRecords: vi.fn(actual.getRecords), openDatabase: vi.fn(actual.openDatabase) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('cleans partially created controllers, retries the existing init path once and preserves a paused session', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  const intervals = vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  mockDialogs();
  const db = await storage.openDatabase();
  await storage.startSession(db, 'builtin-english', 25); await storage.togglePause(db);
  const active = await storage.getActive(db); const records = await storage.getRecords(db);
  vi.mocked(storage.getRecords).mockRejectedValueOnce(Error('storage unavailable'));
  document.body.innerHTML = '<div id="app" hidden inert></div>';
  await import('../src/main');
  expect(document.querySelector('.startup-error')!.hasAttribute('hidden')).toBe(false);
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(intervals).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.startup-error button')!.click();
  await vi.waitFor(() => expect(document.querySelector('.startup-screen')).toBeNull());
  expect(document.querySelector<HTMLElement>('#app')!.hidden).toBe(false);
  expect(document.querySelector('#pause')!.textContent).toBe('继续专注');
  expect(document.querySelectorAll('.focus-task-dialog')).toHaveLength(1); expect(intervals).toHaveBeenCalledOnce();
  expect(await storage.getActive(db)).toEqual(active); expect(await storage.getRecords(db)).toEqual(records);
  const opened = vi.mocked(storage.openDatabase).mock.calls.length;
  document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow'));
  await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
  expect(storage.openDatabase).toHaveBeenCalledTimes(opened); expect(document.querySelector('.startup-screen')).toBeNull();
  db.close();
});
