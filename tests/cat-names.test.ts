import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { applyCatNames, catDisplayName, normalizeCatName, validateCatNames } from '../src/cat-names';
import { catDefinitions } from '../src/cat-definition';
import { adoptInitialCat, exportBackup, getActive, getCatHouseState, getCatNames, getWallet, importBackup, openDatabase, renameCat, startStopwatch } from '../src/storage';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); applyCatNames({}); });
it('validates names without modifying IDs or catalogue defaults, and allows duplicate names', () => {
  expect(normalizeCatName('  糖糖  ')).toBe('糖糖');
  expect(normalizeCatName('🐈'.repeat(12))).toBe('🐈'.repeat(12));
  for (const value of ['', '   ', 'a'.repeat(13), 'a\nb', 'a\u0000b']) expect(() => normalizeCatName(value)).toThrow();
  expect(() => validateCatNames({ unknown: '猫' })).toThrow();
  applyCatNames({ 'orange-white': '糖糖', 'cat-02': '糖糖' });
  expect(catDefinitions.slice(0, 2).map(catDisplayName)).toEqual(['糖糖', '糖糖']);
  expect(catDefinitions[0].name).toBe('喵呜');
});
it('persists names across reopen while leaving companion, residents, active timer and wallet unchanged', async () => {
  const db = await openDatabase(); await adoptInitialCat(db, 'orange-white'); await startStopwatch(db, 'builtin-english', 1000);
  const house = await getCatHouseState(db), active = await getActive(db), wallet = await getWallet(db);
  await renameCat(db, 'orange-white', '  糖糖  ');
  await expect(renameCat(db, 'cat-02', '不该保存')).rejects.toThrow('已拥有');
  const reopened = await openDatabase();
  expect(await getCatNames(reopened)).toEqual({ 'orange-white': '糖糖' });
  expect(await getCatHouseState(db)).toEqual(house); expect(await getActive(db)).toEqual(active); expect(await getWallet(db)).toEqual(wallet);
  expect(reopened.version).toBe(6); db.close(); reopened.close();
});
it('roundtrips optional names in v8 backups and preserves local names when importing old or differently named backups', async () => {
  const source = await openDatabase('source'); await adoptInitialCat(source, 'orange-white'); await renameCat(source, 'orange-white', '糖糖');
  const raw = await exportBackup(source); expect(JSON.parse(raw).version).toBe(9);
  const target = await openDatabase('target'); await importBackup(target, raw);
  expect(await getCatNames(target)).toEqual({ 'orange-white': '糖糖' });
  await renameCat(target, 'orange-white', '小布'); await importBackup(target, raw);
  expect(await getCatNames(target)).toEqual({ 'orange-white': '小布' });
  const old = JSON.parse(raw); delete old.catNames; await importBackup(target, JSON.stringify(old));
  expect(await getCatNames(target)).toEqual({ 'orange-white': '小布' });
  source.close(); target.close();
});
