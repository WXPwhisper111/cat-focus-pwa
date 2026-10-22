// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { getActive, getPendingCompletions, getRecords, openDatabase, settle, startStopwatch } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('confirms early ending, preserves pause, shows saved rewards, handles expiry and protects a newer session', async () => {
  mockDialogs();
  vi.stubGlobal('indexedDB', new IDBFactory());
  let channel!: { onmessage: (() => void) | null };
  vi.stubGlobal('BroadcastChannel', class {
    onmessage = null;
    constructor() { channel = this; }
    postMessage() {} close() {}
  });
  let tick = () => {};
  vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => { tick = callback as () => void; return 0 as never; });
  const initial = Date.parse('2026-10-19T10:00:00+08:00');
  const now = vi.spyOn(Date, 'now').mockReturnValue(initial);
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main');
  const db = await openDatabase();
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const confirmation = () => document.querySelector<HTMLDialogElement>('.end-confirmation')!;
  const summary = () => document.querySelector<HTMLDialogElement>('.completion-summary')!;
  const acknowledge = async () => { click('#summary-done'); await vi.waitFor(() => expect(summary().open).toBe(false)); };
  const start = async () => { click('#start'); await vi.waitFor(() => expect(document.querySelector('#early')).not.toBeNull()); return (await getActive(db))!; };

  const minutes = document.querySelector<HTMLInputElement>('#minutes')!;
  minutes.value = '1'; minutes.dispatchEvent(new Event('input', { bubbles: true }));
  const first = await start();
  now.mockReturnValue(first.startedAt + 20_000); tick(); click('#early');
  expect(confirmation().open).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('#end-cancel'));
  expect(document.querySelector('#end-duration')!.textContent).toBe('20 秒');
  expect(await getRecords(db)).toHaveLength(0);
  expect((await getActive(db))!.status).toBe('running');
  now.mockReturnValue(first.startedAt + 25_000); tick();
  expect(document.querySelector('#end-duration')!.textContent).toBe('25 秒');
  click('#end-cancel');
  expect(confirmation().open).toBe(false);
  expect((await getActive(db))!.status).toBe('running');

  now.mockReturnValue(first.startedAt + 30_000); click('#pause');
  await vi.waitFor(() => expect(document.querySelector('#pause')!.textContent).toBe('继续专注'));
  click('#early');
  expect(document.querySelector('#end-cancel')!.textContent).toBe('返回专注');
  now.mockReturnValue(first.startedAt + 100_000); tick();
  expect(document.querySelector('#end-duration')!.textContent).toBe('30 秒');
  click('#end-confirm'); click('#end-confirm');
  await vi.waitFor(() => expect(summary().open).toBe(true));
  expect(confirmation().open).toBe(false);
  expect(document.querySelector('#summary-category')!.textContent).toBe('英语');
  expect(document.querySelector('#summary-duration')!.textContent).toBe('30 秒');
  expect(document.querySelector('#summary-experience')!.textContent).toBe('+0');
  expect(document.querySelector('#summary-reward-note')!.textContent).toContain('满 1 分钟');
  expect(document.activeElement).toBe(document.querySelector('#summary-done'));
  expect(await getPendingCompletions(db)).toHaveLength(1);
  window.dispatchEvent(new Event('pageshow'));
  await vi.waitFor(() => expect(summary().open).toBe(true));
  expect(await getRecords(db)).toHaveLength(1);
  await acknowledge();
  expect(await getPendingCompletions(db)).toHaveLength(0);

  const second = await start();
  now.mockReturnValue(second.startedAt + 20_000); tick(); click('#early');
  expect(confirmation().open).toBe(true);
  now.mockReturnValue(second.startedAt + 90_000); tick();
  await vi.waitFor(() => expect(summary().open).toBe(true));
  expect(confirmation().open).toBe(false);
  expect(document.querySelector('#summary-title')!.textContent).toBe('专注完成！');
  expect(document.querySelector('#summary-duration')!.textContent).toBe('1 分钟');
  expect(document.querySelector('#summary-coins')!.textContent).toBe('+0');
  const secondRecord = (await getRecords(db)).find(item => item.id === second.id)!;
  expect(Date.parse(secondRecord.endedAt)).toBe(second.startedAt + 60_000);
  await acknowledge();

  const third = await start();
  now.mockReturnValue(third.startedAt + 10_000); tick(); click('#early');
  const staleConfirm = document.querySelector<HTMLButtonElement>('#end-confirm')!;
  const other = await openDatabase(db.name);
  await settle(other, 'early', third.startedAt + 20_000, third.id);
  const newer = await startStopwatch(other, 'builtin-english', third.startedAt + 21_000);
  now.mockReturnValue(third.startedAt + 21_000); channel.onmessage!();
  await vi.waitFor(() => expect(summary().open).toBe(true));
  expect(confirmation().open).toBe(false);
  staleConfirm.click();
  expect((await getActive(db))!.id).toBe(newer.id);
  await acknowledge();

  click('#discard'); expect(confirmation().open).toBe(true);
  click('#end-cancel'); expect((await getActive(db))!.id).toBe(newer.id);
  click('#discard'); click('#end-confirm');
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect(await getActive(db)).toBeUndefined();
  expect(await getPendingCompletions(db)).toHaveLength(0);
  expect(summary().open).toBe(false);

  await start(); click('#early');
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect(summary().open).toBe(false);
  expect(await getRecords(db)).toHaveLength(3);
  other.close(); db.close();
});
