import type {UpdateState} from './app-update';
import type {UserRelease} from './release-notes';
export function createUpdateDialog(active:()=>boolean,canShow:()=>boolean,apply:()=>Promise<void>) {
  const dialog=document.createElement('dialog');dialog.className='version-update-dialog';dialog.dataset.dismissOutside='false';dialog.setAttribute('aria-labelledby','version-update-title');
  dialog.innerHTML='<button type="button" data-release-close aria-label="稍后更新" class="version-update-close">×</button><div class="version-update-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 7V2l-3 3A8 8 0 0 0 4 9M4 17v5l3-3a8 8 0 0 0 13-4M20 2v6h-6M4 22v-6h6"/></svg></div><p class="eyebrow" data-release-eyebrow></p><h2 id="version-update-title"></h2><span class="version-update-label"></span><ul class="version-update-list"></ul><p class="hint">更新不会清除已有专注记录和猫咪存档。</p><div class="version-update-actions"><button type="button" data-release-later>稍后再说</button><button type="button" data-release-go class="primary">前往更新 →</button></div>';
  const shown=new Set<string>(),key='cat-focus-update-dialog-seen';let state:UpdateState|undefined,opener:HTMLElement|null=null,version='',disposed=false,busy=false;
  const seen=(value:string)=>{try{return shown.has(value)||localStorage.getItem(key)===value;}catch{return shown.has(value);}};
  const remember=()=>{if(!version)return;shown.add(version);try{localStorage.setItem(key,version);}catch{/* In-memory dedupe still works. */}};
  const close=()=>{if(busy)return;remember();if(dialog.open)dialog.close();};
  const render=(notes?:UserRelease)=>{
    dialog.querySelector('[data-release-eyebrow]')!.textContent=state?.phase==='ready'?'新版本已就绪':'本次更新内容';
    dialog.querySelector('h2')!.textContent=notes?.title||'发现新版本';dialog.querySelector('.version-update-label')!.textContent=notes?.label||'应用更新';
    const list=dialog.querySelector('ul')!;list.replaceChildren();for(const text of notes?.summary||['更新内容暂不可用，可前往设置重试检查。']){const item=document.createElement('li');item.textContent=text;list.append(item);}
    const ready=state?.phase==='ready';dialog.querySelector<HTMLButtonElement>('[data-release-go]')!.hidden=!ready;dialog.querySelector('[data-release-later]')!.textContent=ready?'稍后再说':'知道了';
  };
  const open=(manual=false,notes=state?.release)=>{if(disposed||busy||dialog.open||document.hidden||!state||!canShow()||!manual&&active())return;
    version=state.latest;render(notes);opener=document.activeElement as HTMLElement|null;
    try{document.body.append(dialog);dialog.showModal();if(state.phase==='ready')remember();dialog.querySelector<HTMLButtonElement>('[data-release-later]')!.focus();}catch{/* Keep the settings and banner fallback available. */}
  };
  dialog.querySelector<HTMLButtonElement>('[data-release-later]')!.onclick=close;dialog.querySelector<HTMLButtonElement>('[data-release-close]')!.onclick=close;
  dialog.querySelector<HTMLButtonElement>('[data-release-go]')!.onclick=async()=>{if(busy||active()||state?.phase!=='ready')return;remember();dialog.close();busy=true;try{await apply();}finally{busy=false;}};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus({preventScroll:true});});
  const storage=(event:StorageEvent)=>{if(event.key===key&&event.newValue===version&&dialog.open)dialog.close();};window.addEventListener('storage',storage);
  return {open:(notes?:UserRelease)=>open(true,notes),update(next:UpdateState){state=next;if(dialog.open){if(document.hidden||active()||state.latest!==version||state.phase!=='ready')dialog.close();else render(state.release);}else if(state.phase==='ready'&&!active()&&!seen(state.latest))open();},destroy(){disposed=true;window.removeEventListener('storage',storage);if(dialog.open)dialog.close();dialog.remove();}};
}
