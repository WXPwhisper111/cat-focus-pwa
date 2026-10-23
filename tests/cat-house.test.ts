import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { adoptInitialCat, addCategory, exportBackup, getActive, getCatHouseState, getCategoryState, getRecords, importBackup, openDatabase, settle, startSession } from '../src/storage';
import { catHouseSignature, validateCatHouseState } from '../src/cat-house-state';
import { parseBackup, progress } from '../src/domain';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
const owned = (id: string) => ({ ownedCatIds: [id], residentCatIds: [id], companionCatId: id });

it('validates catalogue IDs, ownership, uniqueness, companion and capacity without mutating input', () => {
  const state = { ownedCatIds: ['orange-white', 'cat-02', 'cat-03'], residentCatIds: ['cat-02', 'cat-03'], companionCatId: 'cat-03' };
  const original = JSON.stringify(state);
  expect(validateCatHouseState(state)).toEqual(state); expect(JSON.stringify(state)).toBe(original);
  expect(catHouseSignature(state)).toBe(catHouseSignature({ ...state, ownedCatIds: [...state.ownedCatIds].reverse() }));
  for (const invalid of [null, {}, { ...state, ownedCatIds: ['missing-cat'] },
    { ...state, ownedCatIds: ['cat-02', 'cat-02'] }, { ...state, residentCatIds: ['cat-02', 'cat-02'] },
    { ...state, residentCatIds: ['cat-02', 'cat-03', 'orange-white', 'cat-02'] },
    { ...owned('cat-02'), residentCatIds: ['cat-03'] }, { ...owned('cat-02'), companionCatId: 'cat-03' },
    { ...owned('cat-02'), companionCatId: null }]) expect(() => validateCatHouseState(invalid)).toThrow();
  expect(validateCatHouseState({ ownedCatIds: [], residentCatIds: [], companionCatId: null }).ownedCatIds).toEqual([]);
});

it('adopts once in settings v4 and preserves an existing active timer, records, categories and rewards', async () => {
  const db = await openDatabase();
  await startSession(db, 'builtin-english', 25, 1000);
  const active = await getActive(db), categories = await getCategoryState(db);
  expect(await getCatHouseState(db)).toBeNull();
  expect(await adoptInitialCat(db, 'cat-02')).toEqual(owned('cat-02'));
  expect(await adoptInitialCat(db, 'cat-02')).toEqual(owned('cat-02'));
  await expect(adoptInitialCat(db, 'cat-03')).rejects.toThrow('已经完成');
  await expect(adoptInitialCat(db, 'unknown-cat')).rejects.toThrow();
  expect(await getActive(db)).toEqual(active); expect(await getCategoryState(db)).toEqual(categories);
  expect(await getRecords(db)).toEqual([]); expect(progress(await getRecords(db)).experience).toBe(0);
  const reopened = await openDatabase(); expect(reopened.version).toBe(6);
  expect(await getCatHouseState(reopened)).toEqual(owned('cat-02'));
  db.close(); reopened.close();
});

it('serializes two concurrent initial adoptions across connections', async () => {
  const a = await openDatabase(), b = await openDatabase();
  const result = await Promise.allSettled([adoptInitialCat(a, 'cat-02'), adoptInitialCat(b, 'cat-03')]);
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const state = (await getCatHouseState(a))!;
  expect(state.ownedCatIds).toHaveLength(1); expect(state.residentCatIds).toEqual([state.companionCatId]);
  expect(await getCatHouseState(b)).toEqual(state); a.close(); b.close();
});

async function sourceBackup() {
  const db = await openDatabase('source');
  const category = await addCategory(db, '写作');
  await startSession(db, category.id, 1, 1_000_000); await settle(db, 'early', 1_015_000);
  await adoptInitialCat(db, 'cat-03');
  const backup = JSON.parse(await exportBackup(db)); db.close(); return backup;
}

it('round-trips house state with backup v4 and skips repeated import without exporting other settings', async () => {
  const backup = await sourceBackup(), target = await openDatabase('target');
  const tx = target.transaction('settings', 'readwrite'); tx.objectStore('settings').put('keep-local', 'test-setting');
  await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
  expect(backup.version).toBe(9); expect(backup.catHouse).toEqual(owned('cat-03')); expect(backup.settings).toBeUndefined();
  expect((await importBackup(target, JSON.stringify(backup))).added).toBe(1);
  expect((await importBackup(target, JSON.stringify(backup))).skipped).toBe(1);
  expect(await getCatHouseState(target)).toEqual(owned('cat-03'));
  expect(JSON.parse(await exportBackup(target)).catHouse).toEqual(owned('cat-03'));
  const value = target.transaction('settings').objectStore('settings').get('test-setting');
  expect(await new Promise(resolve => { value.onsuccess = () => resolve(value.result); })).toBe('keep-local');
  target.close();
});

it('imports versions 1–3 and optional-house v4 without resetting local adoption', async () => {
  const source = await sourceBackup();
  for (const version of [1, 2, 3, 4]) {
    const target = await openDatabase(`target-${version}`); await adoptInitialCat(target, 'cat-02');
    const backup = structuredClone(source); backup.version = version; delete backup.catHouse;
    if (version < 3) for (const record of backup.records) delete record.mode;
    if (version === 1) {
      delete backup.categories;
      for (const record of backup.records) { record.category = '英语'; delete record.categoryId; }
    }
    await importBackup(target, JSON.stringify(backup));
    expect(await getCatHouseState(target)).toEqual(owned('cat-02')); expect(await getRecords(target)).toHaveLength(1);
    target.close();
  }
});

it('rejects house conflicts and invalid house IDs before changing any local data', async () => {
  const backup = await sourceBackup(), target = await openDatabase('target');
  await adoptInitialCat(target, 'cat-02'); const categories = await getCategoryState(target);
  await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow('领养状态与本机冲突');
  expect(await getRecords(target)).toEqual([]); expect(await getCategoryState(target)).toEqual(categories);
  expect(await getCatHouseState(target)).toEqual(owned('cat-02'));
  backup.catHouse = owned('missing-cat');
  expect(() => parseBackup(JSON.stringify(backup))).toThrow('未知');
  await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow();
  expect(await getRecords(target)).toEqual([]); target.close();
});

it('rolls back a staged house restore if a later record conflict rejects the import', async () => {
  const backup = await sourceBackup(), target = await openDatabase('target');
  const old = structuredClone(backup); old.version = 3; delete old.catHouse;
  await importBackup(target, JSON.stringify(old));
  backup.records[0].durationSeconds--;
  await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow('冲突');
  expect(await getCatHouseState(target)).toBeNull();
  expect((await getRecords(target))[0].durationSeconds).toBe(old.records[0].durationSeconds); target.close();
});
