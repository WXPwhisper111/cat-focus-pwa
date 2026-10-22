import { addFocusTask, changeFocusTask, getFocusTasks } from './focus-task-storage';
import type { FocusTask } from './focus-tasks';

export function createFocusTaskList(db: IDBDatabase, onChange: () => Promise<void>, onSelect?: (id: string | null) => Promise<void>) {
  const element = document.createElement('section'); element.className = 'focus-list-entry';
  const openButton = document.createElement('button'); openButton.type = 'button'; openButton.className = 'focus-list-open';
  openButton.innerHTML = '<span aria-hidden="true">☷</span><span><strong>专注清单</strong><small>把下一步变得具体一点</small></span><span class="focus-list-count"></span><span aria-hidden="true">›</span>';
  element.append(openButton);
  const dialog = document.createElement('dialog'); dialog.className = 'focus-task-dialog'; dialog.setAttribute('aria-labelledby','focus-list-title');
  dialog.innerHTML = `<header><div><small>一步一步，慢慢完成</small><h2 id="focus-list-title">专注清单</h2></div><button type="button" data-list-close aria-label="关闭专注清单">×</button></header>
    <form class="focus-task-add"><label for="new-focus-task">接下来想做什么？</label><div><input id="new-focus-task" autocomplete="off" placeholder="写下一件小事…" aria-describedby="task-title-help"/><button class="primary" type="submit">添加</button></div><small id="task-title-help">最多 100 个字符；相同标题可以重复添加。</small></form>
    <div class="focus-task-selection"><p data-selection-note></p><button type="button" data-selection-clear>清除选择，自由专注</button></div><p class="focus-task-feedback" role="status" aria-live="polite"></p><div class="focus-task-scroll"><h3>未完成 <span data-pending-count></span></h3><ul data-pending-list aria-label="未完成任务"></ul><details><summary>已完成 <span data-completed-count></span></summary><ul data-completed-list aria-label="已完成任务"></ul></details></div>`;
  document.body.append(dialog);
  const viewport=window.visualViewport;
  const resize=()=>{if(!dialog.open)return;const height=viewport?.height||window.innerHeight;dialog.style.setProperty('--task-available-height',`${height}px`);dialog.style.setProperty('--task-keyboard-inset',`${Math.max(0,window.innerHeight-height-(viewport?.offsetTop||0))}px`);};
  window.addEventListener('resize',resize);viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
  const input = dialog.querySelector<HTMLInputElement>('#new-focus-task')!, form = dialog.querySelector<HTMLFormElement>('form')!, feedback = dialog.querySelector<HTMLElement>('.focus-task-feedback')!;
  let returnFocus: HTMLElement | null = null;
  let renderedState = '';
  let openRevision = 0;
  let selectedId: string | null = null, locked = false;
  let tasks: FocusTask[] = [], busy = false, destroyed = false, editing: { id: string; version: number; draft: string } | null = null, deleting: string | null = null;
  const button = (label: string, action: () => void, name?: string) => {
    const node = document.createElement('button'); node.type='button'; node.textContent=label; node.disabled=busy;
    if (name) node.setAttribute('aria-label',name); node.onclick=action; return node;
  };
  async function run(operation: () => Promise<unknown>) {
    if (busy || destroyed) return; const restoreInputFocus=document.activeElement===input; busy=true; feedback.textContent=''; form.querySelector('button')!.disabled=true; input.disabled=true; renderRows();
    try { await operation(); tasks=await getFocusTasks(db); await onChange(); }
    catch(error) { feedback.textContent=(error as Error).message; }
    finally { busy=false; if (!destroyed) { input.disabled=false; form.querySelector('button')!.disabled=false; renderRows(); if(restoreInputFocus&&dialog.open)input.focus({preventScroll:true}); } }
  }
  function renderRows() {
    if (destroyed) return;
    const state = JSON.stringify([tasks, selectedId, locked, busy, editing, deleting]);
    if (state === renderedState) return;
    renderedState = state;
    const focusedEditor=dialog.querySelector<HTMLInputElement>('.focus-task-editor input');
    const restoreEditor=focusedEditor===document.activeElement;
    const selection=restoreEditor?[focusedEditor!.selectionStart,focusedEditor!.selectionEnd]:null;
    const clear=dialog.querySelector<HTMLButtonElement>('[data-selection-clear]')!;
    clear.hidden=!onSelect || !selectedId;clear.disabled=busy||locked;
    dialog.querySelector('[data-selection-note]')!.textContent=onSelect ? locked ? '本次目标已锁定，修改清单不会改变当前专注。' : '选择一件未完成任务，或不选目标直接开始。' : '';
    const pending=tasks.filter(task=>task.status==='pending'), completed=tasks.filter(task=>task.status==='completed');
    element.querySelector('.focus-list-count')!.textContent=`${pending.length} 待办`;
    dialog.querySelector('[data-pending-count]')!.textContent=String(pending.length); dialog.querySelector('[data-completed-count]')!.textContent=String(completed.length);
    for (const [selector, items] of [['[data-pending-list]',pending],['[data-completed-list]',completed]] as const) {
      const list=dialog.querySelector<HTMLElement>(selector)!; list.replaceChildren();
      if (!items.length) { const empty=document.createElement('li');empty.className='focus-task-empty';empty.textContent=selector==='[data-pending-list]'?'清单空空的，添加一件小事吧。':'完成的小事会收在这里。';list.append(empty); }
      for (const task of items) {
        const row=document.createElement('li');row.className='focus-task-row';row.dataset.taskId=task.id;
        const label=document.createElement('div'); label.className='focus-task-check';
        const hit=document.createElement('label');hit.className='focus-task-toggle';
        const check=document.createElement('input');check.type='checkbox';check.checked=task.status==='completed';check.disabled=busy;check.setAttribute('aria-label',`${check.checked?'恢复':'完成'}任务：${task.title}`);
        check.onchange=()=>void run(()=>changeFocusTask(db,task.id,{status:check.checked?'completed':'pending'},task.updatedAt));
        const title=document.createElement('span');title.textContent=task.title;title.className=check.checked?'completed':'';hit.append(check);label.append(hit,title);row.append(label);
        const actions=document.createElement('div');actions.className='focus-task-actions';
        if(onSelect && task.status==='pending') {
          const choose=button(selectedId===task.id?'已选为目标':'设为目标',()=>void run(async()=>{await onSelect(task.id);dialog.close();}),`设为目标：${task.title}`);
          choose.setAttribute('aria-pressed',String(selectedId===task.id));
          choose.disabled=busy||locked;actions.append(choose);row.classList.toggle('is-target',selectedId===task.id);
        }
        actions.append(button('编辑',()=>{editing={id:task.id,version:task.updatedAt,draft:task.title};deleting=null;renderRows();rowFocus(task.id);},`编辑任务：${task.title}`),button('删除',()=>{deleting=task.id;editing=null;renderRows();},`删除任务：${task.title}`)); row.append(actions);
        if (editing?.id===task.id) {
          const editor=document.createElement('form');editor.className='focus-task-editor';const field=document.createElement('input');field.value=editing.draft;field.setAttribute('aria-label','修改任务标题');field.disabled=busy;
          field.oninput=()=>{if(editing)editing.draft=field.value;}; const save=button('保存',()=>{});save.type='submit';
          editor.onsubmit=event=>{event.preventDefault();const captured=editing!;void run(async()=>{await changeFocusTask(db,captured.id,{title:captured.draft},captured.version);editing=null;});};
          editor.append(field,save,button('取消',()=>{editing=null;renderRows();}));row.append(editor);
        }
        if (deleting===task.id) {
          const confirmation=document.createElement('div');confirmation.className='focus-task-delete';const prompt=document.createElement('span');prompt.textContent='删除这项任务？';
          confirmation.append(prompt,button('确认删除',()=>void run(async()=>{await changeFocusTask(db,task.id,{delete:true},task.updatedAt);deleting=null;})),button('保留',()=>{deleting=null;renderRows();}));row.append(confirmation);
        }
        list.append(row);
      }
    }
    if(restoreEditor){const field=dialog.querySelector<HTMLInputElement>('.focus-task-editor input');field?.focus({preventScroll:true});if(field&&selection)field.setSelectionRange(selection[0],selection[1]);}
  }
  function rowFocus(id: string) { dialog.querySelector<HTMLInputElement>(`[data-task-id="${id}"] .focus-task-editor input`)?.focus(); }
  form.onsubmit=event=>{event.preventDefault();const title=input.value;void run(async()=>{await addFocusTask(db,title);input.value='';});};
  async function open() {
    if (destroyed || document.querySelector('dialog[open]')) return;
    const revision = ++openRevision;
    returnFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    deleting=null;feedback.textContent='';dialog.showModal(); resize(); input.focus();
    try { const loaded=await getFocusTasks(db);if(!destroyed && dialog.open && revision===openRevision){tasks=loaded;renderRows();} } catch(error) { if(!destroyed && dialog.open && revision===openRevision)feedback.textContent=`无法读取清单：${(error as Error).message}`; }
  }
  dialog.querySelector<HTMLButtonElement>('[data-selection-clear]')!.onclick=()=>{if(onSelect&&!locked)void run(async()=>{await onSelect(null);dialog.close();});};
  openButton.onclick=()=>void open();dialog.querySelector<HTMLButtonElement>('[data-list-close]')!.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{openRevision++;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else if(element.isConnected)openButton.focus({preventScroll:true});});renderRows();
  return {element,open,update(next:FocusTask[],selection?:{selectedId:string|null;locked:boolean}){tasks=next;if(selection){selectedId=selection.selectedId;locked=selection.locked;}renderRows();},close(){if(dialog.open)dialog.close();},destroy(){destroyed=true;window.removeEventListener('resize',resize);viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);dialog.remove();element.remove();}};
}
