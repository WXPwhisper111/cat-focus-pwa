// @vitest-environment jsdom
import {IDBFactory} from 'fake-indexeddb';
import {afterEach,expect,it,vi} from 'vitest';
import {openResidentManager} from '../src/resident-manager';
import {adoptInitialCat,openDatabase,transact,request,getCatHouseState,getCatExpansion} from '../src/storage';
import {EXPANSION_KEY} from '../src/cat-expansion-state';
import {mockDialogs} from './dialog-mocks';
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});
it('confirms one legacy gift, safely removes a resident and restores focus',async()=>{
  mockDialogs();vi.stubGlobal('indexedDB',new IDBFactory());const db=await openDatabase('manager');
  try {
    await adoptInitialCat(db,'orange-white');
    await transact(db,['settings'],'readwrite',async tx=>{
      await request(tx.objectStore('settings').put({version:1,eligible:true,claimed:null},EXPANSION_KEY));
    });
    const opener=document.createElement('button');document.body.append(opener);opener.focus();
    const prepare=vi.fn(async()=>{}),changed=vi.fn(async()=>{});
    openResidentManager(db,prepare,changed);
    const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
    await vi.waitFor(()=>expect(button('免费领养吉吉')).toBeDefined());
    button('免费领养吉吉').click();expect((await getCatExpansion(db)).claimed).toBeNull();
    button('确认免费领养（仅一次）').click();
    await vi.waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
    await vi.waitFor(()=>expect(document.body.textContent).toContain('已入住 2/3'));
    expect((await getCatHouseState(db))?.residentCatIds).toEqual(['orange-white','cat-04']);
    expect(document.body.textContent).not.toContain('免费领养珍珠');
    const card=[...document.querySelectorAll('section')].find(s=>s.textContent?.includes('吉吉'))!;
    card.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(()=>expect(prepare).toHaveBeenCalledWith('cat-04'));
    await vi.waitFor(()=>expect(document.body.textContent).toContain('已入住 1/3'));
    expect((await getCatHouseState(db))?.ownedCatIds).toContain('cat-04');
    expect((await getCatHouseState(db))?.companionCatId).toBe('orange-white');
    button('关闭').click();expect(document.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
  } finally {db.close();}
});
