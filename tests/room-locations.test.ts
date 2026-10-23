// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { adoptInitialCat, exportBackup, getActive, getRoomLocations, getWallet, openDatabase, saveRoomLocations, startStopwatch } from '../src/storage';
import { validateRoomLocations } from '../src/room-locations';
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
it('persists only known stable anchors across reopen and preserves timer, ownership and wallet', async () => {
  const db = await openDatabase(); await adoptInitialCat(db, 'cat-02'); await startStopwatch(db, 'builtin-english', 1000);
  const active = await getActive(db), wallet = await getWallet(db);
  await saveRoomLocations(db, { 'cat-02': 'bed-0' }); db.close();
  const reopened = await openDatabase(); expect(reopened.version).toBe(6);
  expect(await getRoomLocations(reopened)).toEqual({ 'cat-02': 'bed-0' });
  expect(await getActive(reopened)).toEqual(active); expect(await getWallet(reopened)).toEqual(wallet);
  const backup = JSON.parse(await exportBackup(reopened)); expect(backup.version).toBe(9); expect(backup.roomLocations).toBeUndefined(); reopened.close();
});
it('rejects unknown cats, transient state, shared capacity, and cats not resident', async () => {
  for (const invalid of [null, [], { unknown: 'bed-0' }, { 'cat-02': 'teleporting' }, { 'cat-02': 'food-0', 'cat-03': 'water-0' }]) expect(() => validateRoomLocations(invalid)).toThrow();
  const db = await openDatabase(); await adoptInitialCat(db, 'cat-02');
  await expect(saveRoomLocations(db, { 'cat-03': 'bed-0' })).rejects.toThrow('入住'); expect(await getRoomLocations(db)).toEqual({}); db.close();
});

it('normalizes removed nearby idle IDs without erasing valid unrelated legacy entries',()=>{
  expect(validateRoomLocations({'orange-white':'food-idle-0','cat-02':'bed-0','cat-03':'play-idle-2'})).toEqual({'cat-02':'bed-0'});
  expect(()=>validateRoomLocations({'orange-white':'food-idle-9'})).toThrow();
});
