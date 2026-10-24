import { catDefinitions } from '../src/cat-definition';
// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { dateKey, progress, type FocusRecord } from '../src/domain';
import { statisticsMarkup, bindStatisticsEvents } from '../src/statistics-view';
import { acknowledgeCompletion, getWallet, addCategory, getActive, getPendingCompletions, getRecords, openDatabase, setCategoryArchived, settle, startStopwatch } from '../src/storage';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses stored records for working range controls, chart details, growth and preserved history', async () => {
  mockDialogs();
  vi.stubEnv('TZ', 'Asia/Shanghai');
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = new Date('2026-10-21T15:00:00+08:00');
  vi.setSystemTime(now);
  const db = await openDatabase();
  const reading = await addCategory(db, '阅读');
  for (const [day, minutes, category] of [
    ['2026-10-21', 60, 'builtin-english'], ['2026-10-20', 30, 'builtin-computer'], ['2026-10-19', 40, reading.id],
    ['2026-10-12', 20, 'builtin-english'], ['2026-10-01', 10, 'builtin-english'], ['2026-09-30', 15, 'builtin-english'],
  ] as const) {
    const end = Date.parse(`${day}T14:00:00+08:00`);
    await startStopwatch(db, category, end - minutes * 60_000);
    await settle(db, 'early', end);
  }
  await setCategoryArchived(db, reading.id, true);
  for (const pending of await getPendingCompletions(db)) await acknowledgeCompletion(db, pending.record.id);
  const original = await getRecords(db);
  const originalJson = JSON.stringify(original);
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main');
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  click('[data-page=stats]');
  expect(document.querySelector('.stats-header h1')!.textContent).toBe('专注统计');
  expect(document.querySelector('[data-page=stats]')!.classList.contains('active')).toBe(true);
  expect(document.querySelector('[data-stats-range=week]')!.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelectorAll('[data-stats-bucket]')).toHaveLength(7);
  const core = () => Array.from(document.querySelectorAll('.stats-metric')).map(element => element.textContent);
  const originalCore = core();
  expect(document.querySelector('.stats-growth')).toBeNull();
  for (const rect of document.querySelectorAll('.stats-column-hit')) {
    expect(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))).toBe(160);
    expect(Number(rect.getAttribute('y'))).toBe(12);
  }
  expect(document.querySelector('[data-stat=today]')!.getAttribute('data-milliseconds')).toBe(String(60 * 60_000));
  expect(document.querySelector('[data-stat=week]')!.getAttribute('data-milliseconds')).toBe(String(130 * 60_000));
  expect(document.querySelector('[data-stat=streak] strong')!.textContent).toBe('3 天');
  expect(document.querySelector(`[data-stats-category="${reading.id}"]`)).toBeNull();
  expect(document.querySelector('.stats-analysis-total')!.getAttribute('data-milliseconds')).toBe(String(90 * 60_000));
  expect(document.querySelectorAll('[data-stats-week]')).toHaveLength(4);
  const originalWeeks = Array.from(document.querySelectorAll('[data-stats-week]')).map(element => element.getAttribute('data-milliseconds'));
  document.querySelector('[data-stats-bucket=day-2026-10-19]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.querySelector('.stats-bucket-detail')!.textContent).not.toContain('阅读');
  expect(document.querySelector('.stats-bucket-detail')!.textContent).toContain('0 分钟');

  click('[data-stats-range=today]');
  expect(document.querySelector('.stats-trend')).toBeNull();
  expect(document.querySelector('.stats-chart-help')).toBeNull();
  expect(document.querySelector('.stats-growth')!.compareDocumentPosition(document.querySelector('[aria-labelledby=stats-distribution-heading]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('.stats-analysis-total')!.getAttribute('data-milliseconds')).toBe(String(60 * 60_000));
  expect(document.querySelectorAll('[data-stats-bucket]')).toHaveLength(0);
  expect(document.querySelector('[data-stats-category=builtin-english]')!.textContent).toContain('100%');
  expect(core()).toEqual(originalCore);

  click('[data-stats-range=month]');
  expect(document.querySelector('#stats-trend-heading')!.textContent).toBe('月内每周趋势');
  expect(document.querySelectorAll('[data-stats-bucket]')).toHaveLength(5);
  expect(document.querySelector('.stats-analysis-total')!.getAttribute('data-milliseconds')).toBe(String(120 * 60_000));
  const month = document.querySelector<HTMLInputElement>('#stats-month')!;
  month.value = '2026-09'; month.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('.stats-analysis-total')!.getAttribute('data-milliseconds')).toBe(String(15 * 60_000));
  document.querySelector('[data-stats-bucket=week-2026-09-28]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(document.querySelector('.stats-bucket-detail')!.textContent).toContain('15 分钟');
  expect(core()).toEqual(originalCore);
  expect(Array.from(document.querySelectorAll('[data-stats-week]')).map(element => element.getAttribute('data-milliseconds'))).toEqual(originalWeeks);
  expect(document.querySelector('.stats-growth')).toBeNull();
  click('[data-stats-range=today]');
  const growth = progress(original);
  expect(document.querySelector('.stats-level')!.textContent).toBe(`等级 ${growth.level}`);
  expect(document.querySelector('.stats-growth-body')!.textContent).toContain(`${growth.experience} 经验`);
  expect(document.querySelector('.stats-growth-body')!.textContent).toContain(`${(await getWallet(db)).state.balance} 猫爪币`);
  expect(document.querySelector('.stats-growth [data-stats-icon=star]')).not.toBeNull();
  expect(document.querySelector('.stats-growth [data-stats-icon=paw-coin]')).not.toBeNull();
  expect(document.querySelector('.stats-growth progress')!.getAttribute('value')).toBe(String(growth.experience - growth.current));
  expect(JSON.stringify(await getRecords(db))).toBe(originalJson);
  const reopened = await openDatabase(db.name);
  expect(JSON.stringify(await getRecords(reopened))).toBe(originalJson);
  reopened.close();

  // Verify the existing timer and settings flows still work after using statistics.
  click('[data-page=focus]');
  click('[data-mode=stopwatch]');
  await vi.waitFor(() => expect(document.querySelector('[data-mode=stopwatch]')!.getAttribute('aria-pressed')).toBe('true'));
  click('#start'); await vi.waitFor(() => expect(document.querySelector('#early')).not.toBeNull());
  const activeSession = (await getActive(db))!;
  expect(activeSession.mode).toBe('stopwatch');
  vi.setSystemTime(new Date(activeSession.startedAt + 61_000));
  click('#early'); await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(true));
  click('#summary-done'); await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.completion-summary')!.open).toBe(false));
  click('[data-page=stats]'); click('[data-stats-range=today]');
  expect(document.querySelector('[data-stat=today]')!.getAttribute('data-milliseconds')).toBe(String(60 * 60_000 + 61_000));
  click('[data-page=settings]');
  expect(document.querySelector('#export')).not.toBeNull();
  expect(document.body.textContent).toContain('手动备份');
  expect(document.body.textContent).not.toContain('安装与离线');
  expect(document.querySelector('#diagnostics')?.closest('section')?.getAttribute('aria-label')).toBe('应用更新');
  expect(document.querySelector<HTMLDetailsElement>('.settings-details')?.open).toBe(false);
  db.close();
});

it('renders empty states and escaped long category names with no invalid numeric output', () => {
  const state = { range: 'week' as 'today' | 'week' | 'month', month: '2026-10', selectedBucket: null as string | null };
  const now = new Date(2026, 9, 19, 15);
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = statisticsMarkup([], [...DEFAULT_CATEGORIES], state, now); bindStatisticsEvents(host, state, render); };
  render();
  expect(host.textContent).toContain('还没有专注记录');
  expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(host.querySelectorAll('[data-stats-bucket]')).toHaveLength(7);
  expect(host.querySelectorAll('[aria-valuenow="0"]')).toHaveLength(4);
  host.querySelector<HTMLButtonElement>('[data-stats-range=month]')!.click();
  expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(host.querySelectorAll('[data-stats-bucket]')).toHaveLength(5);

  const day = dateKey(now);
  const category = { id: 'custom-safely-escaped', name: '<img src=x>', archived: false, order: 2 };
  const record: FocusRecord = { id: 'stats-escape-record', categoryId: category.id, category: category.name, mode: 'stopwatch', targetMinutes: null,
    startedAt: `${day}T10:00:00.000+08:00`, endedAt: `${day}T10:01:00.000+08:00`, durationSeconds: 60, completed: false };
  host.innerHTML = statisticsMarkup([record], [...DEFAULT_CATEGORIES, category], state, now);
  expect(host.querySelectorAll('img')).toHaveLength(0);
  expect(host.textContent).toContain('<img src=x>');
  expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
});


it('assigns all ten custom icons stably across ranges, order changes and repeated renders', () => {
  const now = new Date(2026, 9, 19, 15);
  const day = dateKey(now);
  const categories = [...DEFAULT_CATEGORIES, ...Array.from({ length: 100 }, (_, index) => ({
    id: `custom-icon-${index}`, name: `类别${index}`, order: index + 2, archived: false,
  }))];
  const records: FocusRecord[] = categories.map(category => ({
    id: `record-${category.id}`, categoryId: category.id, category: category.name, mode: 'stopwatch', targetMinutes: null,
    startedAt: `${day}T10:00:00.000+08:00`, endedAt: `${day}T10:01:00.000+08:00`, durationSeconds: 60, completed: false,
  }));
  const host = document.createElement('div');
  const assignments = (range: 'today' | 'week' | 'month', reverse = false) => {
    host.innerHTML = statisticsMarkup(reverse ? [...records].reverse() : records, reverse ? [...categories].reverse() : categories,
      { range, month: '2026-10', selectedBucket: null }, now);
    return new Map([...host.querySelectorAll('[data-stats-category]')].map(row => [row.getAttribute('data-stats-category'), row.querySelector('svg')!.outerHTML]));
  };
  const initial = assignments('today');
  expect(new Set([...initial].filter(([id]) => id!.startsWith('custom-')).map(([, svg]) => svg)).size).toBe(10);
  expect(initial.get('builtin-english')).toContain('data-stats-icon="book"');
  expect(initial.get('builtin-computer')).toContain('data-stats-icon="computer"');
  for (const result of [assignments('week'), assignments('month', true), assignments('today')]) {
    for (const [id, svg] of initial) expect(result.get(id)).toBe(svg);
  }
});


it('uses each companion in both statistics images without changing growth values', () => {
  const state = { range: 'today' as const, month: '2026-10', selectedBucket: null };
  const host = document.createElement('div');
  for (const cat of catDefinitions) {
    host.innerHTML = statisticsMarkup([], [...DEFAULT_CATEGORIES], state, new Date(2026, 9, 20), cat);
    expect(host.querySelector('.stats-header-cat')!.getAttribute('src')).toBe(cat.animations.sleep_loop!.frames[0].file);
    expect(host.querySelector('.stats-growth img')!.getAttribute('src')).toBe(cat.preview);
    expect(host.querySelector('.stats-growth img')!.getAttribute('alt')).toBe(cat.name);
    expect(host.querySelector('.stats-growth-rewards')!.textContent).toContain('0 经验');
  }
});
