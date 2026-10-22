import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArchivedCategoryError, DEFAULT_CATEGORIES } from '../src/categories';
import { parseBackup, progress } from '../src/domain';
import { addCategory, exportBackup, getActive, getCategoryState, getRecords, importBackup, openDatabase, selectCategory, setCategoryArchived, settle, startSession, togglePause } from '../src/storage';

const english = DEFAULT_CATEGORIES[0].id;
const computer = DEFAULT_CATEGORIES[1].id;
const start = Date.parse('2026-10-19T10:00:00+08:00');
let db: IDBDatabase;
beforeEach(async () => { db = await openDatabase(`categories-${crypto.randomUUID()}`); });
afterEach(() => db.close());

describe('category management', () => {
  it.each([['builtin-fitness', '健身'], ['builtin-math', '数学']])('saves focus records and rewards for %s', async (id, name) => {
    await selectCategory(db, id); await startSession(db, id, 1, start);
    await settle(db, 'due', start + 60_000);
    expect((await getRecords(db))[0]).toMatchObject({ categoryId: id, category: name, durationSeconds: 60 });
    expect(progress(await getRecords(db))).toMatchObject({ experience: 1 });
  });
  it('adds missing defaults to an existing v4 database without changing selection or active focus', async () => {
    await selectCategory(db, computer);
    await startSession(db, computer, 25, start);
    const active = await getActive(db), name = db.name;
    const tx = db.transaction(['settings', 'categories'], 'readwrite');
    tx.objectStore('settings').delete('defaultCategories-v2');
    for (const id of ['builtin-fitness', 'builtin-math']) tx.objectStore('categories').delete(id);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    db.close(); db = await openDatabase(name);
    expect(db.version).toBe(6); expect(await getActive(db)).toEqual(active);
    expect((await getCategoryState(db)).selectedId).toBe(computer);
    expect((await getCategoryState(db)).categories.map(item => item.name)).toEqual(['英语', '计算机', '健身', '数学']);
    await setCategoryArchived(db, 'builtin-fitness', true);
    db.close(); db = await openDatabase(name);
    expect((await getCategoryState(db)).categories.find(item => item.id === 'builtin-fitness')!.archived).toBe(true);
  });

  it('reuses existing same-name custom categories without changing IDs, archives or history', async () => {
    const name = db.name;
    const tx = db.transaction(['settings', 'categories'], 'readwrite');
    tx.objectStore('settings').delete('defaultCategories-v2');
    for (const id of ['builtin-fitness', 'builtin-math']) tx.objectStore('categories').delete(id);
    tx.objectStore('categories').add({ id: 'legacy-fitness-id', name: '健身', archived: true, order: 5 });
    tx.objectStore('categories').add({ id: 'legacy-math-id', name: '数学', archived: false, order: 6 });
    tx.objectStore('settings').put('legacy-math-id', 'selectedCategoryId');
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    await startSession(db, 'legacy-math-id', 1, start); await settle(db, 'due', start + 60_000);
    const records = await getRecords(db);
    db.close(); db = await openDatabase(name);
    const state = await getCategoryState(db);
    expect(state.categories).toHaveLength(4); expect(state.selectedId).toBe('legacy-math-id');
    expect(state.categories.find(item => item.name === '健身')).toMatchObject({ id: 'legacy-fitness-id', archived: true });
    expect(await getRecords(db)).toEqual(records);
    expect(progress(await getRecords(db))).toMatchObject({ experience: 1 });
  });
  it('seeds defaults, adds a trimmed name, selects it, and persists order and selection', async () => {
    expect((await getCategoryState(db)).categories.map(item => item.name)).toEqual(['英语', '计算机', '健身', '数学']);
    const category = await addCategory(db, '  阅读  ');
    expect(category.name).toBe('阅读');
    const name = db.name;
    db.close(); db = await openDatabase(name);
    const state = await getCategoryState(db);
    expect(state.selectedId).toBe(category.id);
    expect(state.categories.map(item => item.name)).toEqual(['英语', '计算机', '健身', '数学', '阅读']);
    await selectCategory(db, computer);
    expect((await getCategoryState(db)).selectedId).toBe(computer);
  });

  it.each(['', '   ', 'a'.repeat(21), '阅读\n数学', 'test\u0000name'])('rejects invalid name %j without adding data', async name => {
    await expect(addCategory(db, name)).rejects.toThrow('1–20');
    expect((await getCategoryState(db)).categories).toHaveLength(4);
  });

  it('compares English names without case and restores an archived identity', async () => {
    const category = await addCategory(db, 'Reading');
    await expect(addCategory(db, ' reading ')).rejects.toThrow('同名');
    await setCategoryArchived(db, category.id, true);
    await expect(addCategory(db, 'READING')).rejects.toBeInstanceOf(ArchivedCategoryError);
    expect((await getCategoryState(db)).selectedId).toBe(english);
    await setCategoryArchived(db, category.id, false);
    await selectCategory(db, category.id);
    const state = await getCategoryState(db);
    expect(state.categories).toHaveLength(5);
    expect(state.selectedId).toBe(category.id);
    expect(state.categories[4].name).toBe('Reading');
  });

  it('serializes duplicate additions from two pages', async () => {
    const other = await openDatabase(db.name);
    const results = await Promise.allSettled([addCategory(db, 'Work'), addCategory(other, 'work')]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((await getCategoryState(db)).categories).toHaveLength(5);
    other.close();
  });

  it('protects the last available category even when two pages archive concurrently', async () => {
    await setCategoryArchived(db, 'builtin-fitness', true);
    await setCategoryArchived(db, 'builtin-math', true);
    const other = await openDatabase(db.name);
    const results = await Promise.allSettled([setCategoryArchived(db, english, true), setCategoryArchived(other, computer, true)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const state = await getCategoryState(db);
    expect(state.categories.filter(item => !item.archived)).toHaveLength(1);
    expect(state.categories.find(item => item.id === state.selectedId)?.archived).toBe(false);
    other.close();
  });

  it('rejects archived categories for new sessions while retaining an existing session and its snapshot', async () => {
    const category = await addCategory(db, '<阅读>');
    await startSession(db, category.id, 1, start);
    const other = await openDatabase(db.name);
    await setCategoryArchived(other, category.id, true);
    expect((await getActive(db))?.category).toBe('<阅读>');
    await settle(db, 'due', start + 60_000);
    expect((await getRecords(db))[0]).toMatchObject({ category: '<阅读>', categoryId: category.id, completed: true });
    await expect(startSession(db, category.id, 1, start + 61_000)).rejects.toThrow('已停用');
    await expect(selectCategory(db, category.id)).rejects.toThrow('已停用');
    other.close();
  });

  it('keeps custom categories through pause, reload, early save and discard', async () => {
    const category = await addCategory(db, '物理');
    await startSession(db, category.id, 1, start);
    await togglePause(db, start + 30_000);
    const name = db.name;
    db.close(); db = await openDatabase(name);
    expect((await getActive(db))!.categoryId).toBe(category.id);
    await settle(db, 'early', start + 90_000);
    expect((await getRecords(db))[0]).toMatchObject({ categoryId: category.id, category: '物理', durationSeconds: 30 });
    await startSession(db, category.id, 1, start + 100_000);
    await settle(db, 'discard', start + 110_000);
    expect(await getRecords(db)).toHaveLength(1);
  });
});

describe('category backup compatibility', () => {
  it('merges the same name with different IDs and preserves local status and selection', async () => {
    const category = await addCategory(db, '阅读');
    await startSession(db, category.id, 1, start);
    await settle(db, 'due', start + 60_000);
    const raw = await exportBackup(db);
    const target = await openDatabase(`target-${crypto.randomUUID()}`);
    const local = await addCategory(target, '阅读');
    await setCategoryArchived(target, local.id, true);
    await selectCategory(target, computer);
    expect(await importBackup(target, raw)).toEqual({ added: 1, skipped: 0 });
    expect(await importBackup(target, raw)).toEqual({ added: 0, skipped: 1 });
    const state = await getCategoryState(target);
    expect(state.categories).toHaveLength(5);
    expect(state.categories[4]).toMatchObject({ id: local.id, archived: true });
    expect(state.selectedId).toBe(computer);
    expect((await getRecords(target))[0].categoryId).toBe(local.id);
    target.close();
  });

  it('round-trips an archive-only category with no records', async () => {
    const category = await addCategory(db, '历史');
    await setCategoryArchived(db, category.id, true);
    const raw = await exportBackup(db);
    const target = await openDatabase(`target-${crypto.randomUUID()}`);
    await importBackup(target, raw);
    expect((await getCategoryState(target)).categories[4]).toMatchObject({ name: '历史', archived: true });
    target.close();
  });

  it('rolls back newly added categories and records on a later record conflict', async () => {
    await startSession(db, english, 1, start);
    await settle(db, 'due', start + 60_000);
    const original = (await getRecords(db))[0];
    const backup = JSON.parse(await exportBackup(db));
    backup.categories.push({ id: 'custom-new-id', name: '新类别', archived: false, order: 2 });
    backup.records = [{ ...original, id: 'brand-new-record', categoryId: 'custom-new-id', category: '新类别' }, { ...original, categoryId: computer, category: '计算机' }];
    backup.growth = { experience: 2, level: 1 };
    await expect(importBackup(db, JSON.stringify(backup))).rejects.toThrow('冲突');
    expect((await getCategoryState(db)).categories).toHaveLength(4);
    expect(await getRecords(db)).toEqual([original]);
  });

  it('rejects category ID conflicts and malformed category references before changing data', async () => {
    const data = JSON.parse(await exportBackup(db));
    data.categories[0].name = '被修改的英语';
    await expect(importBackup(db, JSON.stringify(data))).rejects.toThrow('冲突');
    await startSession(db, english, 1, start);
    await settle(db, 'due', start + 60_000);
    const broken = JSON.parse(await exportBackup(db));
    broken.records[0].categoryId = 'non-existent-id';
    expect(() => parseBackup(JSON.stringify(broken))).toThrow('不匹配');
    broken.records = []; broken.categories[0].name = 'x'.repeat(21);
    await expect(importBackup(db, JSON.stringify(broken))).rejects.toThrow('无效');
    expect((await getCategoryState(db)).categories[0].name).toBe('英语');
  });
});

describe('version 2 database migration', () => {
  it('migrates populated records and the active session atomically and still imports version 1', async () => {
    const name = `legacy-${crypto.randomUUID()}`;
    const legacyRecord = { id: 'legacy-record-1', category: '英语', targetMinutes: 1,
      startedAt: '2026-10-19T10:00:00.000+08:00', endedAt: '2026-10-19T10:01:00.000+08:00', durationSeconds: 60, completed: true };
    const legacyActive = { id: 'legacy-active-1', category: '计算机', targetMinutes: 25, startedAt: start, accumulatedMs: 30_000, status: 'paused', runSinceMs: null };
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('active').put(legacyActive, 'only');
        req.result.createObjectStore('records', { keyPath: 'id' }).add(legacyRecord);
        req.result.createObjectStore('settings').put('keep', 'unrelated-setting');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    old.close();
    const upgraded = await openDatabase(name);
    expect((await getRecords(upgraded))[0]).toEqual({ ...legacyRecord, categoryId: english, mode: 'countdown' });
    expect(await getActive(upgraded)).toEqual({ ...legacyActive, categoryId: computer, mode: 'countdown' });
    expect(progress(await getRecords(upgraded))).toMatchObject({ experience: 1 });
    expect(await importBackup(upgraded, JSON.stringify({ format: 'cat-focus-pwa', version: 1, records: [legacyRecord] }))).toEqual({ added: 0, skipped: 1 });
    const setting = await new Promise(resolve => {
      const req = upgraded.transaction('settings').objectStore('settings').get('unrelated-setting');
      req.onsuccess = () => resolve(req.result);
    });
    expect(setting).toBe('keep');
    upgraded.close();
  });
});
