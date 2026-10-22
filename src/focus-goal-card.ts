import { icon } from './category-icons';
import type { FocusTaskContext } from './focus-tasks';
export function createFocusGoal(openList: () => void, clearSelection: () => Promise<void>) {
  const element=document.createElement('section');element.className='focus-goal-shell';element.setAttribute('aria-label','本次专注目标');element.setAttribute('aria-hidden','true');
  element.innerHTML=`<div class="focus-goal-overflow"><div class="focus-goal-card"><span class="focus-goal-icon" aria-hidden="true">${icon('goal')}</span><div><small data-goal-phase></small><strong data-goal-title></strong></div><button type="button" data-goal-clear aria-label="取消目标，清除选择并自由专注">取消</button><button type="button" data-goal-open>更换</button></div></div>`;
  const button=element.querySelector<HTMLButtonElement>('[data-goal-open]')!;button.onclick=openList;
  const cancel=element.querySelector<HTMLButtonElement>('[data-goal-clear]')!;
  cancel.onclick=()=>{if(cancel.disabled||cancel.hidden)return;cancel.disabled=true;void clearSelection().finally(()=>{cancel.disabled=false;});};
  return {element,update(context:FocusTaskContext|undefined,phase:string,locked:boolean){
    if(context){element.querySelector('[data-goal-title]')!.textContent=context.titleSnapshot;(element.querySelector('[data-goal-title]') as HTMLElement).title=context.titleSnapshot;element.querySelector('[data-goal-phase]')!.textContent=phase;button.textContent='更换';}
    // Establish the collapsed box before expanding; no timers or repeated animation per clock tick.
    if(context && element.dataset.visible!=='true') void element.offsetHeight;
    element.dataset.visible=String(!!context);element.setAttribute('aria-hidden',String(!context));button.hidden=cancel.hidden=!context||locked;button.tabIndex=cancel.tabIndex=context&&!locked?0:-1;
  },destroy(){button.onclick=null;cancel.onclick=null;element.remove();}};
}
