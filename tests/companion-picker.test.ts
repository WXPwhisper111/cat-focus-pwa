// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { openCompanionPicker } from '../src/companion-picker';
import { adoptInitialCat, getActive, getCatHouseState, getWallet, openDatabase, request, setCompanionCat, startStopwatch, transact } from '../src/storage';
import { mockDialogs } from './dialog-mocks';
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('uses owned previews, reports save errors and closes after one successful selection',async()=>{
  mockDialogs();const save=vi.fn().mockRejectedValueOnce(Error('存储失败')).mockResolvedValueOnce(undefined);
  openCompanionPicker(['orange-white','cat-02','unknown'],'orange-white',save);
  const buttons=()=>document.querySelectorAll<HTMLButtonElement>('[data-pick-companion]');expect(buttons()).toHaveLength(2);
  expect(buttons()[0].getAttribute('aria-pressed')).toBe('true');buttons()[1].click();
  await vi.waitFor(()=>expect(document.querySelector('[role=status]')!.textContent).toContain('存储失败'));
  buttons()[1].click();buttons()[1].click();await vi.waitFor(()=>expect(document.querySelector('.companion-picker')).toBeNull());expect(save).toHaveBeenCalledTimes(2);
});
it('changes only companion ID even when an owned cat is not resident, preserving active focus and wallet',async()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());const db=await openDatabase();await adoptInitialCat(db,'orange-white');
  await transact(db,['settings'],'readwrite',async tx=>{const house=await request<any>(tx.objectStore('settings').get('catHouse'));house.ownedCatIds.push('cat-02');tx.objectStore('settings').put(house,'catHouse');});
  await startStopwatch(db,'builtin-english',1000);const active=await getActive(db),wallet=await getWallet(db);
  await setCompanionCat(db,'cat-02');expect((await getCatHouseState(db))!.residentCatIds).toEqual(['orange-white']);
  expect((await getCatHouseState(db))!.companionCatId).toBe('cat-02');expect(await getActive(db)).toEqual(active);expect(await getWallet(db)).toEqual(wallet);db.close();
});
