import type { FocusTask } from './focus-tasks';
import type { FocusRecord } from './domain';
import { elapsedMs, type ActiveSession } from './domain';
import type { CompletionSummary } from './storage';

export type EndAction = 'early' | 'discard';

export function focusDuration(seconds: number): string {
  if (seconds > 0 && seconds < 1) return '不足 1 秒';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = total % 60;
  return [hours ? `${hours} 小时` : '', minutes ? `${minutes} 分钟` : '', rest || !total ? `${rest} 秒` : ''].filter(Boolean).join(' ');
}

export function createFocusEnding(
  onConfirm: (action: EndAction, sessionId: string) => Promise<void>,
  onAcknowledge: (id: string) => Promise<void>,
  taskOptions?: { getTask: (id: string) => FocusTask | undefined; completeTask: (record: FocusRecord) => Promise<'completed' | 'missing'> },
) {
  const confirmationDialog = document.createElement('dialog');
  confirmationDialog.className = 'focus-dialog end-confirmation';
  confirmationDialog.setAttribute('aria-labelledby', 'end-title');
  confirmationDialog.setAttribute('aria-describedby', 'end-description');
  confirmationDialog.innerHTML = `<h2 id="end-title"></h2><p id="end-category" class="end-category"></p>
    <p class="end-duration">已专注 <strong id="end-duration"></strong></p>
    <p id="end-description"></p><p id="end-clock-note" class="hint"></p>
    <p class="ending-error" role="alert"></p><div class="actions"><button id="end-cancel" type="button">继续专注</button><button id="end-confirm" type="button" class="primary">结束并保存</button></div>`;
  const summaryDialog = document.createElement('dialog');
  summaryDialog.className = 'focus-dialog completion-summary';
  summaryDialog.setAttribute('aria-labelledby', 'summary-title');
  summaryDialog.innerHTML = `<div class="eyebrow">每一点努力都算数</div><h2 id="summary-title"></h2><p class="hint">记录已保存</p>
    <dl class="summary-details"><div><dt>专注类别</dt><dd id="summary-category"></dd></div><div><dt>计时模式</dt><dd id="summary-mode"></dd></div><div><dt>有效专注</dt><dd id="summary-duration"></dd></div></dl>
    <div class="summary-task" hidden><small>本次专注目标</small><strong data-summary-task-title></strong><p data-summary-task-note></p><button type="button" id="summary-task-complete">标记目标已完成</button></div><div class="summary-rewards"><div><strong id="summary-experience"></strong><span>经验</span></div><div><strong id="summary-coins"></strong><span>猫爪币</span></div></div>
    <p id="summary-reward-note" class="hint"></p><p class="ending-error" role="alert"></p><button id="summary-done" type="button" class="primary wide">知道了</button>`;
  document.body.append(confirmationDialog, summaryDialog);
  let confirmation: { action: EndAction; session: ActiveSession } | null = null;
  let lastAction: EndAction = 'early';
  let confirmationBusy = false;
  let summary: CompletionSummary | undefined;
  let summaryBusy = false;
  const confirm = confirmationDialog.querySelector<HTMLButtonElement>('#end-confirm')!;
  const cancel = confirmationDialog.querySelector<HTMLButtonElement>('#end-cancel')!;
  const done = summaryDialog.querySelector<HTMLButtonElement>('#summary-done')!;
  const text = (dialog: HTMLDialogElement, selector: string, value: string) => { dialog.querySelector(selector)!.textContent = value; };
  const focusTimer = () => document.querySelector<HTMLButtonElement>('#start, #pause')?.focus();

  function closeConfirmation() {
    confirmation = null;
    if (confirmationDialog.open) confirmationDialog.close();
  }
  function updateSession(active: ActiveSession | undefined, now: number) {
    if (!confirmation) return;
    if (!active || active.id !== confirmation.session.id) { closeConfirmation(); return; }
    confirmation.session = active;
    const seconds = Math.min(elapsedMs(active, now), active.mode === 'countdown' ? active.targetMinutes * 60_000 : Infinity) / 1000;
    text(confirmationDialog, '#end-duration', focusDuration(seconds));
    text(confirmationDialog, '#end-clock-note', active.status === 'running' ? '确认期间计时仍在继续。' : '当前已暂停，确认期间不累计时长。');
    cancel.textContent = active.status === 'running' ? '继续专注' : '返回专注';
  }

  confirm.onclick = async () => {
    if (!confirmation || confirmationBusy) return;
    const { action, session } = confirmation;
    confirmationBusy = true;
    confirm.disabled = cancel.disabled = true;
    text(confirmationDialog, '.ending-error', '');
    try { await onConfirm(action, session.id); closeConfirmation(); }
    catch (error) { text(confirmationDialog, '.ending-error', `操作未完成：${(error as Error).message}，请重试。`); }
    finally { confirmationBusy = false; confirm.disabled = cancel.disabled = false; }
  };
  cancel.onclick = () => { if (!confirmationBusy) closeConfirmation(); };
  confirmationDialog.addEventListener('cancel', event => { if (confirmationBusy) event.preventDefault(); });
  confirmationDialog.addEventListener('close', () => {
    confirmation = null;
    const trigger = document.querySelector<HTMLButtonElement>(lastAction === 'early' ? '#early' : '#discard');
    if (trigger) trigger.focus(); else focusTimer();
  });

  async function acknowledge() {
    if (!summary || summaryBusy) return;
    summaryBusy = true;
    done.disabled = true;
    text(summaryDialog, '.ending-error', '');
    try { await onAcknowledge(summary.record.id); }
    catch (error) { text(summaryDialog, '.ending-error', `暂时无法关闭总结：${(error as Error).message}，请重试。`); }
    finally { summaryBusy = false; done.disabled = false; }
  }
  const completeTaskButton=summaryDialog.querySelector<HTMLButtonElement>('#summary-task-complete')!;
  function updateTask(record: FocusRecord) {
    const context=record.taskContext, box=summaryDialog.querySelector<HTMLElement>('.summary-task')!;box.hidden=!context;
    if(!context){done.textContent='知道了';return;}
    text(summaryDialog,'[data-summary-task-title]',context.titleSnapshot);
    const task=taskOptions?.getTask(context.taskId);
    done.textContent=task?.status==='pending'?'暂不完成，关闭总结':'知道了';
    text(summaryDialog,'[data-summary-task-note]',task?.status==='completed'?'这项任务已完成。':!task?'原任务已删除，专注记录仍然保留。':'任务不会自动完成，也可以暂不完成，留到下次。');
    completeTaskButton.hidden=!taskOptions||!task||task.status==='completed';
  }
  completeTaskButton.onclick=async()=>{
    if(!summary||summaryBusy||!taskOptions)return;
    const record=summary.record;summaryBusy=true;completeTaskButton.disabled=true;done.disabled=true;
    try{await taskOptions.completeTask(record);updateTask(record);}
    catch(error){text(summaryDialog,'.ending-error',`任务暂未完成：${(error as Error).message}`);}
    finally{summaryBusy=false;completeTaskButton.disabled=false;done.disabled=false;}
  };
  done.onclick = acknowledge;
  summaryDialog.addEventListener('cancel', event => { event.preventDefault(); void acknowledge(); });
  summaryDialog.addEventListener('close', focusTimer);

  return {
    confirm(action: EndAction, active: ActiveSession, now: number) {
      if (confirmationBusy || summaryDialog.open) return;
      confirmation = { action, session: active };
      lastAction = action;
      text(confirmationDialog, '#end-title', action === 'early' ? '提前结束本次专注？' : '放弃本次专注？');
      text(confirmationDialog, '#end-category', active.category);
      text(confirmationDialog, '#end-description', action === 'early' ? '已专注时长会保存，并计入统计和奖励。' : '本次时长不会保存，也不会获得奖励。');
      text(confirmationDialog, '.ending-error', '');
      confirm.textContent = action === 'early' ? '结束并保存' : '确认放弃';
      confirm.className = action === 'early' ? 'primary' : 'danger';
      updateSession(active, now);
      if (!confirmationDialog.open) confirmationDialog.showModal();
      cancel.focus();
    },
    updateSession,
    update(active: ActiveSession | undefined, pending: CompletionSummary[], now: number) {
      updateSession(active, now);
      const next = pending[0];
      if (!next) {
        summary = undefined;
        if (summaryDialog.open) summaryDialog.close();
        return;
      }
      updateTask(next.record);
      if (summary?.record.id === next.record.id && summaryDialog.open) return;
      closeConfirmation();
      summary = next;
      const { record, earned } = next;
      text(summaryDialog, '#summary-title', record.completed ? '专注完成！' : record.mode === 'stopwatch' ? '本次专注已保存' : '这段专注已保存');
      text(summaryDialog, '#summary-category', record.category);
      text(summaryDialog, '#summary-mode', record.mode === 'stopwatch' ? '正计时' : '倒计时');
      text(summaryDialog, '#summary-duration', focusDuration(record.durationSeconds));
      text(summaryDialog, '#summary-experience', `+${earned}`);
      text(summaryDialog, '#summary-coins', `+${next.coinsEarned ?? 0}`);
      text(summaryDialog, '#summary-reward-note', `${earned > Math.floor(record.durationSeconds / 60) ? '本次经验包含此前累计的不足一分钟时长。' : ''}有效专注累计满 1 分钟获得 1 经验，迁移后累计满 5 分钟获得 1 猫爪币；不足部分继续累计。`);
      text(summaryDialog, '.ending-error', '');
      if (!summaryDialog.open) summaryDialog.showModal();
      done.focus();
    },
    destroy() { confirmationDialog.remove(); summaryDialog.remove(); },
  };
}
