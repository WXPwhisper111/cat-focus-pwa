import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { dueAt, formatClock, isDue, parseBackup, progress, sessionClock } from '../src/domain';
import { addCategory, exportBackup, getActive, getCategoryState, getRecords, getTimerMode, importBackup, openDatabase, selectTimerMode, settle, startSession, startStopwatch, togglePause } from '../src/storage';

const categoryId = DEFAULT_CATEGORIES[0].id;
const start = Date.parse('2026-10-19T10:00:00+08:00');
let db: IDBDatabase;
beforeEach(async () => { db = await openDatabase(`stopwatch-${crypto.randomUUID()}`); });
afterEach(() => db.close());

describe('stopwatch timing', () => {
  it('runs beyond 180 minutes without any automatic settlement', async () => {
    const active = await startStopwatch(db, categoryId, start);
    expect(active).toMatchObject({ mode: 'stopwatch', targetMinutes: null });
    expect(dueAt(active)).toBeNull();
    expect(isDue(active, start + 20_000_000)).toBe(false);
    expect((await settle(db, 'due', start + 20_000_000)).created).toBe(false);
    expect(await getActive(db)).toBeDefined();
    const result = await settle(db, 'early', start + 20_000_000);
    expect(result.record).toMatchObject({ mode: 'stopwatch', targetMinutes: null, durationSeconds: 20_000, completed: false });
    expect(progress(await getRecords(db)).experience).toBe(333);
  });

  it('restores a running stopwatch after reopening and excludes every paused segment', async () => {
    const category = await addCategory(db, '阅读');
    await startStopwatch(db, category.id, start);
    const name = db.name;
    db.close(); db = await openDatabase(name);
    expect(sessionClock((await getActive(db))!, start + 10_900)).toBe('00:10');
    await togglePause(db, start + 30_000);
    db.close(); db = await openDatabase(name);
    expect(sessionClock((await getActive(db))!, start + 3_600_000)).toBe('00:30');
    expect((await settle(db, 'due', start + 3_600_000)).created).toBe(false);
    await togglePause(db, start + 3_600_000);
    await togglePause(db, start + 3_620_000);
    await togglePause(db, start + 7_200_000);
    const result = await settle(db, 'early', start + 7_210_500);
    expect(result.record).toMatchObject({ categoryId: category.id, category: '阅读', durationSeconds: 60.5 });
    expect(progress(await getRecords(db))).toMatchObject({ experience: 1 });
  });

  it('formats whole elapsed seconds, hour boundaries and long sessions without wrapping', () => {
    expect(formatClock(999, 'stopwatch')).toBe('00:00');
    expect(formatClock(1001, 'stopwatch')).toBe('00:01');
    expect(formatClock(3_599_999, 'stopwatch')).toBe('59:59');
    expect(formatClock(3_600_000, 'stopwatch')).toBe('01:00:00');
    expect(formatClock(100 * 3_600_000 + 61_000, 'stopwatch')).toBe('100:01:01');
    expect(formatClock(1, 'countdown')).toBe('00:01');
  });

  it('saves only once when two pages finish the same stopwatch', async () => {
    await startStopwatch(db, categoryId, start);
    const other = await openDatabase(db.name);
    const results = await Promise.all([settle(db, 'early', start + 90_000), settle(other, 'early', start + 90_000)]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(await getRecords(db)).toHaveLength(1);
    expect(await getActive(db)).toBeUndefined();
    other.close();
  });

  it('keeps a single active session across both modes and concurrent pages', async () => {
    const other = await openDatabase(db.name);
    const results = await Promise.allSettled([startSession(db, categoryId, 25, start), startStopwatch(other, categoryId, start)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await getActive(db)).toBeDefined();
    other.close();
  });

  it('does not let stale page controls stop, discard or pause a newer session', async () => {
    const previous = await startStopwatch(db, categoryId, start);
    await settle(db, 'early', start + 60_000);
    const next = await startStopwatch(db, categoryId, start + 61_000);
    expect((await settle(db, 'early', start + 62_000, previous.id)).created).toBe(false);
    await settle(db, 'discard', start + 62_000, previous.id);
    await togglePause(db, start + 62_000, previous.id);
    expect(await getActive(db)).toMatchObject({ id: next.id, status: 'running', accumulatedMs: 0 });
    expect(await getRecords(db)).toHaveLength(1);
  });

  it('discards an old running stopwatch without saving or earning rewards, and skips zero time', async () => {
    await startStopwatch(db, categoryId, start);
    await settle(db, 'discard', start + 86_400_000);
    expect(await getRecords(db)).toHaveLength(0);
    await startStopwatch(db, categoryId, start + 86_400_000);
    await settle(db, 'early', start + 86_400_000);
    expect(await getRecords(db)).toHaveLength(0);
    expect(await getActive(db)).toBeUndefined();
  });

  it('uses the manual end time even if the stopwatch is paused', async () => {
    await startStopwatch(db, categoryId, start);
    await togglePause(db, start + 60_000);
    const result = await settle(db, 'early', start + 86_400_000);
    expect(result.record!.durationSeconds).toBe(60);
    expect(Date.parse(result.record!.endedAt)).toBe(start + 86_400_000);
  });

  it('remembers the selected mode and preserves active session mode when preferences change', async () => {
    expect(await getTimerMode(db)).toBe('countdown');
    await selectTimerMode(db, 'stopwatch');
    const name = db.name;
    db.close(); db = await openDatabase(name);
    expect(await getTimerMode(db)).toBe('stopwatch');
    await startStopwatch(db, categoryId, start);
    await selectTimerMode(db, 'countdown');
    expect((await getActive(db))!.mode).toBe('stopwatch');
    await settle(db, 'discard', start);
    await startSession(db, categoryId, 1, start);
    expect(await getTimerMode(db)).toBe('countdown');
  });
});

describe('stopwatch backup compatibility', () => {
  it('round-trips stopwatch records with categories and skips duplicate imports', async () => {
    const category = await addCategory(db, '编程');
    await startStopwatch(db, category.id, start);
    await settle(db, 'early', start + 12_000_000);
    const raw = await exportBackup(db);
    expect(JSON.parse(raw).version).toBe(9);
    expect(parseBackup(raw).records[0].mode).toBe('stopwatch');
    const target = await openDatabase(`target-${crypto.randomUUID()}`);
    expect(await importBackup(target, raw)).toEqual({ added: 1, skipped: 0 });
    expect(await importBackup(target, raw)).toEqual({ added: 0, skipped: 1 });
    expect((await getRecords(target))[0]).toMatchObject({ mode: 'stopwatch', category: '编程', durationSeconds: 12_000 });
    expect(await getTimerMode(target)).toBe('countdown');
    target.close();
  });

  it('rejects invalid mode, target, completion and duration combinations', async () => {
    await startStopwatch(db, categoryId, start);
    await settle(db, 'early', start + 60_000);
    const original = JSON.parse(await exportBackup(db));
    for (const mutation of [{ mode: 'unknown' }, { targetMinutes: 25 }, { completed: true }, { durationSeconds: 61 }]) {
      const backup = structuredClone(original);
      Object.assign(backup.records[0], mutation);
      expect(() => parseBackup(JSON.stringify(backup))).toThrow('无效');
    }
    delete original.records[0].mode;
    expect(() => parseBackup(JSON.stringify(original))).toThrow('无效');
  });

  it('treats a changed record mode as a conflict and leaves existing data intact', async () => {
    await startSession(db, categoryId, 1, start);
    await settle(db, 'early', start + 30_000);
    const backup = JSON.parse(await exportBackup(db));
    Object.assign(backup.records[0], { mode: 'stopwatch', targetMinutes: null });
    await expect(importBackup(db, JSON.stringify(backup))).rejects.toThrow('冲突');
    expect((await getRecords(db))[0].mode).toBe('countdown');
  });
});

it('upgrades populated version 3 categories, active sessions and records, and imports version 2', async () => {
  const name = `v3-${crypto.randomUUID()}`;
  const category = { id: 'custom-legacy-category', name: '阅读', archived: false, order: 2 };
  const record = { id: 'legacy-countdown-record', categoryId: category.id, category: category.name,
    targetMinutes: 1, startedAt: '2026-10-19T10:00:00.000+08:00', endedAt: '2026-10-19T10:01:00.000+08:00', durationSeconds: 60, completed: true };
  const active = { id: 'legacy-active-session', categoryId: category.id, category: category.name,
    targetMinutes: 25, startedAt: start, status: 'paused', accumulatedMs: 20_000, runSinceMs: null };
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 3);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('active').put(active, 'only');
      req.result.createObjectStore('records', { keyPath: 'id' }).add(record);
      req.result.createObjectStore('settings').put(category.id, 'selectedCategoryId');
      const categories = req.result.createObjectStore('categories', { keyPath: 'id' });
      [...DEFAULT_CATEGORIES, category].forEach(item => categories.add(item));
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  old.close();
  const upgraded = await openDatabase(name);
  expect(upgraded.version).toBe(6);
  expect(await getActive(upgraded)).toEqual({ ...active, mode: 'countdown' });
  expect((await getRecords(upgraded))[0]).toEqual({ ...record, mode: 'countdown' });
  expect((await getCategoryState(upgraded)).selectedId).toBe(category.id);
  expect(progress(await getRecords(upgraded)).experience).toBe(1);
  const backup = JSON.stringify({ format: 'cat-focus-pwa', version: 2, categories: [...DEFAULT_CATEGORIES, category], records: [record] });
  expect(await importBackup(upgraded, backup)).toEqual({ added: 0, skipped: 1 });
  upgraded.close();
});
