import { validId } from './categories';
export type FocusTask = { id: string; title: string; status: 'pending' | 'completed'; createdAt: number; updatedAt: number; completedAt: number | null };
export function taskTitle(value: unknown): string {
  if (typeof value !== 'string') throw Error('请填写任务标题');
  const title = value.trim();
  if (!title) throw Error('任务标题不能为空');
  if (Array.from(title).length > 100) throw Error('任务标题不能超过 100 个字符');
  return title;
}
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function validateFocusTask(value: unknown): FocusTask {
  if (!value || typeof value !== 'object') throw Error('任务数据无效');
  const task = value as FocusTask;
  if (!validId(task.id) || taskTitle(task.title) !== task.title || !['pending','completed'].includes(task.status) ||
    !timestamp(task.createdAt) || !timestamp(task.updatedAt) || task.updatedAt < task.createdAt ||
    (task.status === 'pending' ? task.completedAt !== null : !timestamp(task.completedAt) || task.completedAt < task.createdAt || task.completedAt > task.updatedAt)) throw Error('任务数据无效');
  return { id: task.id, title: task.title, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, completedAt: task.completedAt };
}
export function validateFocusTasks(value: unknown): FocusTask[] {
  if (!Array.isArray(value)) throw Error('备份缺少专注清单');
  const tasks = value.map(validateFocusTask);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw Error('备份包含重复任务 ID');
  return tasks;
}
export const taskSignature = (task: FocusTask) => JSON.stringify(validateFocusTask(task));
export const sortFocusTasks = (tasks: FocusTask[]) => [...tasks].sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export const SELECTED_FOCUS_TASK_KEY = 'selectedFocusTaskId';
export type FocusTaskContext = { taskId: string; titleSnapshot: string };
export function validateTaskContext(value: unknown): FocusTaskContext {
  if (!value || typeof value !== 'object') throw Error('专注目标快照无效');
  const context = value as FocusTaskContext;
  if (!validId(context.taskId) || taskTitle(context.titleSnapshot) !== context.titleSnapshot) throw Error('专注目标快照无效');
  return { taskId: context.taskId, titleSnapshot: context.titleSnapshot };
}
