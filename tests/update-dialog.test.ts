// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createUpdateDialog} from '../src/update-dialog';
import {createAppUpdateView} from '../src/app-update-view';
import type {UpdateState,AppUpdate} from '../src/app-update';
import {mockDialogs} from './dialog-mocks';
import {userRelease} from '../src/release-notes';
const notes={id:'life',label:'猫咪日常更新',title:'陪伴有了更多小动作',summary:['猫咪待机时会伸伸懒腰。','专注页也能点击抚摸陪伴猫。']};
const state=():UpdateState=>({phase:'ready',current:'old',latest:'new',message:'',applying:false,mediaPhase:'complete',cached:3,total:3,release:notes});
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();localStorage.clear();});
it('defers behind welcome and paused focus, shows matching notes, remembers versions and keeps update backdrop explicit',()=>{
  mockDialogs();vi.spyOn(document,'hidden','get').mockReturnValue(false);let active=true,allowed=false;const apply=vi.fn(async()=>{}),view=createUpdateDialog(()=>active,()=>allowed,apply),s=state();
  try{view.update(s);expect(document.querySelector('dialog[open]')).toBeNull();active=false;view.update(s);expect(document.querySelector('dialog[open]')).toBeNull();allowed=true;view.update(s);
    const dialog=document.querySelector<HTMLDialogElement>('dialog[open]')!;expect(dialog.dataset.dismissOutside).toBe('false');expect(dialog.textContent).toContain(notes.title);expect(dialog.textContent).not.toContain('六猫更新');
    dialog.querySelector<HTMLButtonElement>('[data-release-later]')!.click();view.update(s);expect(document.querySelector('dialog[open]')).toBeNull();s.latest='newer';view.update(s);expect(document.querySelector('dialog[open]')).not.toBeNull();
    s.phase='current';view.update(s);expect(document.querySelector('dialog[open]')).toBeNull();expect(apply).not.toHaveBeenCalled();
  }finally{view.destroy();}
});
it('opens settings and starts update once, while preserving settings release notes after dismissal',async()=>{
  mockDialogs();vi.spyOn(document,'hidden','get').mockReturnValue(false);document.body.innerHTML='<div data-update-card-slot></div><div data-update-banner-slot></div>';
  let changed!:(s:UpdateState)=>void;const s=state(),apply=vi.fn(async()=>{}),openSettings=vi.fn();
  const controller={snapshot:()=>s,subscribe:(fn:typeof changed)=>{changed=fn;fn(s);return ()=>{};},apply,check:vi.fn(),retryMedia:vi.fn()} as unknown as AppUpdate;
  const view=createAppUpdateView(controller,()=>false,{canShow:()=>!document.querySelector('dialog[open]'),openSettings});view.mount();
  try{const button=document.querySelector<HTMLButtonElement>('[data-release-go]')!;button.click();button.click();await Promise.resolve();expect(apply).toHaveBeenCalledTimes(1);expect(openSettings).toHaveBeenCalledTimes(1);expect(document.querySelector('.update-release-notes')!.textContent).toContain(notes.summary[0]);s.phase='current';changed(s);expect(document.querySelector('dialog[open]')).toBeNull();}
  finally{view.destroy();}
});
it('validates user copy and tolerates missing metadata and blocked reminder storage',()=>{
  mockDialogs();vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('denied');});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied');});
  expect(userRelease({title:'bad'})).toBeUndefined();const s=state();delete s.release;
  const view=createUpdateDialog(()=>false,()=>true,async()=>{});
  try{view.update(s);expect(document.querySelector('dialog')!.textContent).toContain('更新内容暂不可用');document.querySelector<HTMLButtonElement>('[data-release-later]')!.click();view.update(s);expect(document.querySelector('dialog[open]')).toBeNull();}finally{view.destroy();}
});
