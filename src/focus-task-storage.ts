import { request, transact } from './storage';
import { SELECTED_FOCUS_TASK_KEY, sortFocusTasks, taskTitle, validateFocusTask, validateFocusTasks, type FocusTask } from './focus-tasks';
export async function getFocusTasks(db: IDBDatabase) {
  return transact(db, ['focusTasks'], 'readonly', async tx => sortFocusTasks(validateFocusTasks(await request(tx.objectStore('focusTasks').getAll()))));
}
export async function addFocusTask(db: IDBDatabase, rawTitle: string, now = Date.now()) {
  const task = validateFocusTask({ id: crypto.randomUUID(), title: taskTitle(rawTitle), status: 'pending', createdAt: now, updatedAt: now, completedAt: null });
  return transact(db, ['focusTasks'], 'readwrite', async tx => { await request(tx.objectStore('focusTasks').add(task)); return task; });
}
export async function changeFocusTask(db: IDBDatabase, id: string, change: { title?: string; status?: FocusTask['status']; delete?: boolean }, expectedUpdatedAt?: number, now = Date.now()) {
  const title = change.title === undefined ? undefined : taskTitle(change.title);
  return transact(db, ['focusTasks','settings'], 'readwrite', async tx => {
    const store = tx.objectStore('focusTasks'), raw = await request(store.get(id));
    if (!raw) throw Error('任务已被删除，请重新打开清单');
    const current = validateFocusTask(raw);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt) throw Error('任务已在其他页面更新，请重新打开后操作');
    if (change.delete || change.status === 'completed') {
      const settings = tx.objectStore('settings');
      if (await request(settings.get(SELECTED_FOCUS_TASK_KEY)) === id) settings.delete(SELECTED_FOCUS_TASK_KEY);
    }
    if (change.delete) { await request(store.delete(id)); return null; }
    const updatedAt = Math.max(now, current.updatedAt + 1), status = change.status ?? current.status;
    const task = validateFocusTask({ ...current, ...(title === undefined ? {} : { title }), status, updatedAt,
      completedAt: status === 'pending' ? null : current.status === 'completed' ? current.completedAt : updatedAt });
    await request(store.put(task)); return task;
  });
}

export async function getFocusTaskState(db: IDBDatabase) {
  return transact(db, ['focusTasks','settings'], 'readwrite', async tx => {
    const tasks = sortFocusTasks(validateFocusTasks(await request(tx.objectStore('focusTasks').getAll())));
    const settings = tx.objectStore('settings'), saved = await request(settings.get(SELECTED_FOCUS_TASK_KEY));
    const selectedId = tasks.find(task => task.id === saved && task.status === 'pending')?.id || null;
    if (!selectedId && saved !== undefined) settings.delete(SELECTED_FOCUS_TASK_KEY);
    return { tasks, selectedId };
  });
}
export async function selectFocusTask(db: IDBDatabase, id: string | null) {
  return transact(db, ['focusTasks','settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    if (id === null) { settings.delete(SELECTED_FOCUS_TASK_KEY); return; }
    const raw = await request(tx.objectStore('focusTasks').get(id));
    if (!raw || validateFocusTask(raw).status !== 'pending') throw Error('只能选择尚未完成的任务');
    settings.put(id, SELECTED_FOCUS_TASK_KEY);
  });
}
export async function completeSummaryTask(db: IDBDatabase, sessionId: string, now = Date.now()) {
  return transact(db, ['focusTasks','settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    const summaries = await request(settings.get('pendingCompletions')) as import('./storage').CompletionSummary[] | undefined;
    const context = summaries?.find(summary => summary.record.id === sessionId)?.record.taskContext;
    if (!context) throw Error('这条专注总结没有可完成的任务');
    const store = tx.objectStore('focusTasks'), raw = await request(store.get(context.taskId));
    if (!raw) return 'missing' as const;
    const current = validateFocusTask(raw);
    if (current.status !== 'completed') {
      const updatedAt = Math.max(now, current.updatedAt + 1);
      store.put(validateFocusTask({ ...current, status: 'completed', completedAt: updatedAt, updatedAt }));
    }
    if (await request(settings.get(SELECTED_FOCUS_TASK_KEY)) === context.taskId) settings.delete(SELECTED_FOCUS_TASK_KEY);
    return 'completed' as const;
  });
}
