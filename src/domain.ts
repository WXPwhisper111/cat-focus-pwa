import { validateExpansion, type ExpansionState } from './cat-expansion-state';
import { validateCatNames, type CatNames } from './cat-names';
import { validateFocusTasks, validateTaskContext, type FocusTaskContext, type FocusTask } from './focus-tasks';
import { validateCommerce, validateCommerceLinks, type CommerceState } from './shop';
import { checkinsFromTransactions, validateCheckinHistory, type DailyCheckinRecord } from './daily-checkin';
import { validateWalletSnapshot, type WalletSnapshot } from './wallet';
import { categoryKey, DEFAULT_CATEGORIES, isCategory, normalizeCategoryName, validId, type FocusCategory } from './categories';
import { validateCatHouseState, type CatHouseState } from './cat-house-state';

export type TimerMode = 'countdown' | 'stopwatch';
export type TimerConfiguration = { mode: 'countdown'; targetMinutes: number } | { mode: 'stopwatch'; targetMinutes: null };
export type ActiveSession = TimerConfiguration & {
  taskContext?: FocusTaskContext;
  id: string; categoryId: string; category: string; startedAt: number;
  accumulatedMs: number; status: 'running' | 'paused'; runSinceMs: number | null;
};
export type FocusRecord = TimerConfiguration & {
  taskContext?: FocusTaskContext;
  id: string; categoryId: string; category: string;
  startedAt: string; endedAt: string; durationSeconds: number; completed: boolean;
};

export const threshold = (level: number) => 30 * level * (level - 1);
export const validMinutes = (value: number) => Number.isInteger(value) && value >= 1 && value <= 180;
export const elapsedMs = (session: ActiveSession, now: number) =>
  session.accumulatedMs + (session.status === 'running' ? Math.max(0, now - session.runSinceMs!) : 0);
export const dueAt = (session: ActiveSession) => session.mode === 'countdown' && session.status === 'running'
  ? session.runSinceMs! + Math.max(0, session.targetMinutes * 60_000 - session.accumulatedMs)
  : null;
export const isDue = (session: ActiveSession, now: number) => {
  const deadline = dueAt(session);
  return deadline !== null && deadline <= now;
};

export const timerConfiguration = (value: TimerConfiguration): TimerConfiguration => value.mode === 'stopwatch'
  ? { mode: 'stopwatch', targetMinutes: null }
  : { mode: 'countdown', targetMinutes: value.targetMinutes };

export function formatClock(milliseconds: number, mode: TimerMode = 'countdown'): string {
  if (!Number.isFinite(milliseconds)) return '--:--';
  const seconds = Math.max(0, mode === 'stopwatch' ? Math.floor(milliseconds / 1000) : Math.ceil(milliseconds / 1000));
  const pad = (number: number) => String(number).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours ? `${pad(hours)}:` : ''}${pad(minutes)}:${pad(seconds % 60)}`;
}

export const sessionClock = (session: ActiveSession, now: number) => formatClock(
  session.mode === 'stopwatch' ? elapsedMs(session, now) : session.targetMinutes * 60_000 - elapsedMs(session, now), session.mode,
);

export function localIso(epoch: number): string {
  const date = new Date(epoch);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function makeRecord(session: ActiveSession, now: number, completed: boolean): FocusRecord | null {
  const automaticCompletion = session.mode === 'countdown' && completed;
  const durationMs = session.mode === 'stopwatch' ? elapsedMs(session, now)
    : automaticCompletion ? session.targetMinutes * 60_000 : Math.min(elapsedMs(session, now), session.targetMinutes * 60_000);
  if (durationMs <= 0) return null;
  const ended = automaticCompletion ? dueAt(session) : now;
  if (ended === null) throw Error('暂停的专注不能自动结算');
  return {
    ...(session.taskContext ? { taskContext: validateTaskContext(session.taskContext) } : {}),
    ...timerConfiguration(session), id: session.id, categoryId: session.categoryId, category: session.category,
    startedAt: localIso(session.startedAt), endedAt: localIso(ended),
    durationSeconds: durationMs / 1000, completed: automaticCompletion,
  };
}

export function progress(records: FocusRecord[]) {
  // Round only after summing all eligible records, including early saves.
  const experience = Math.floor(records.reduce((sum, record) => sum + Math.round(record.durationSeconds * 1000), 0) / 60_000);
  let level = 1;
  while (experience >= threshold(level + 1)) level++;
  return { experience, level, current: threshold(level), next: threshold(level + 1) };
}

export const endDate = (record: FocusRecord) => record.endedAt.slice(0, 10);
export const recordSignature = (record: FocusRecord) => JSON.stringify([
  record.id, record.categoryId, record.category, record.mode, record.targetMinutes, record.startedAt,
  record.endedAt, record.durationSeconds, record.completed, record.taskContext || null,
]);
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function mondayOf(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}
export function weeksInMonth(year: number, month: number) {
  const result: { start: string; end: string }[] = [];
  const last = new Date(year, month, 0).getDate();
  for (let day = 1; day <= last;) {
    const start = new Date(year, month - 1, day);
    const endDay = Math.min(last, day + 6 - (start.getDay() + 6) % 7);
    result.push({ start: dateKey(start), end: dateKey(new Date(year, month - 1, endDay)) });
    day = endDay + 1;
  }
  return result;
}
export const secondsIn = (records: FocusRecord[], start: string, end: string) =>
  records.filter(record => endDate(record) >= start && endDate(record) <= end)
    .reduce((sum, record) => sum + record.durationSeconds, 0);

const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;
export function isRecord(value: unknown): value is FocusRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<FocusRecord>;
  try { if (r.taskContext !== undefined) validateTaskContext(r.taskContext); } catch { return false; }
  if (!validId(r.id) || !validId(r.categoryId) || typeof r.category !== 'string' ||
      typeof r.completed !== 'boolean' ||
      typeof r.durationSeconds !== 'number' || !Number.isFinite(r.durationSeconds) ||
      r.durationSeconds <= 0 || !Number.isSafeInteger(Math.round(r.durationSeconds * 1000)) ||
      typeof r.startedAt !== 'string' || typeof r.endedAt !== 'string' ||
      !isoPattern.test(r.startedAt) || !isoPattern.test(r.endedAt) ||
      !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.endedAt)) ||
      Date.parse(r.endedAt) < Date.parse(r.startedAt) ||
      r.durationSeconds * 1000 > Date.parse(r.endedAt) - Date.parse(r.startedAt) + 1) return false;
  try { if (normalizeCategoryName(r.category) !== r.category) return false; } catch { return false; }
  if (r.mode === 'countdown') {
    if (!validMinutes(r.targetMinutes!) || r.durationSeconds > r.targetMinutes! * 60 ||
        (r.completed && r.durationSeconds !== r.targetMinutes! * 60)) return false;
  } else if (r.mode !== 'stopwatch' || r.targetMinutes !== null || r.completed) return false;
  return true;
}

export type BackupData = { expansion?: ExpansionState; catNames?: CatNames; tasks?: FocusTask[]; selectedTaskId?: string | null; categories: FocusCategory[]; records: FocusRecord[]; catHouse?: CatHouseState; wallet?: WalletSnapshot; commerce?: CommerceState; checkins?: DailyCheckinRecord[] };

export function parseBackup(raw: string): BackupData {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw Error('备份格式错误');
  const backup = data as { expansion?: unknown; catNames?: unknown; format?: unknown; version?: unknown; records?: unknown; categories?: unknown; catHouse?: unknown; wallet?: unknown; commerce?: unknown; checkins?: unknown; growth?: unknown; versions?: unknown; tasks?: unknown; selectedTaskId?: unknown };
  if (backup.format !== 'cat-focus-pwa' || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(backup.version as number) || !Array.isArray(backup.records)) throw Error('不支持的备份版本或格式');
  const catNames = backup.catNames === undefined ? undefined : validateCatNames(backup.catNames);
  const catHouse = (backup.version as number) >= 4 && backup.catHouse !== undefined ? validateCatHouseState(backup.catHouse) : undefined;
  const wallet = (backup.version as number) >= 5 ? validateWalletSnapshot(backup.wallet) : undefined;
  const commerce = (backup.version as number) >= 6 ? validateCommerce(backup.commerce) : undefined;
  const categories: FocusCategory[] = [];
  if (backup.version === 1) {
    categories.push(...DEFAULT_CATEGORIES.map(item => ({ ...item })));
  } else {
    if (!Array.isArray(backup.categories) || !backup.categories.length) throw Error('备份缺少类别定义');
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const item of backup.categories) {
      if (!isCategory(item) || ids.has(item.id) || names.has(categoryKey(item.name))) throw Error('备份包含无效或重复的类别');
      ids.add(item.id); names.add(categoryKey(item.name));
      categories.push({ id: item.id, name: item.name, archived: item.archived, order: item.order });
    }
  }
  const byId = new Map(categories.map(item => [item.id, item]));
  const seen = new Map<string, string>();
  const records: FocusRecord[] = [];
  for (const value of backup.records) {
    if (!value || typeof value !== 'object') throw Error('备份包含无效记录');
    let record = value as FocusRecord;
    if (backup.version === 1) {
      const legacy = DEFAULT_CATEGORIES.find(item => item.name === record.category);
      if (!legacy) throw Error('旧版备份包含无效类别');
      record = { ...record, categoryId: legacy.id };
    }
    if ((backup.version as number) < 3) record = { ...record, mode: 'countdown' } as FocusRecord;
    if (!isRecord(record)) throw Error('备份包含无效记录');
    const category = byId.get(record.categoryId);
    if (!category || categoryKey(category.name) !== categoryKey(record.category)) throw Error('备份中的记录与类别不匹配');
    const encoded = recordSignature(record);
    const previous = seen.get(record.id);
    if (previous && previous !== encoded) throw Error('备份内存在相同 ID 的冲突记录');
    seen.set(record.id, encoded);
    records.push({ ...(record.taskContext ? { taskContext: validateTaskContext(record.taskContext) } : {}), ...timerConfiguration(record), id: record.id, categoryId: record.categoryId, category: record.category,
      startedAt: record.startedAt, endedAt: record.endedAt,
      durationSeconds: record.durationSeconds, completed: record.completed });
  }
  if (wallet) {
    checkinsFromTransactions(wallet.transactions);
    const byRecord = new Map(records.map(record => [record.id, record]));
    for (const receipt of wallet.receipts) {
      const record = byRecord.get(receipt.recordId);
      if (!record || receipt.eligibleMs > Math.round(record.durationSeconds * 1000)) throw Error('钱包凭据与专注记录不匹配，备份内容冲突');
    }
  }
  const uniqueRecords = [...new Map(records.map(record => [record.id, record])).values()];
  let checkins: DailyCheckinRecord[] | undefined;
  if ((backup.version as number) >= 6) {
    const versions = backup.versions as Record<string, unknown> | null;
    if (!versions || versions.database !== (backup.version === 6 ? 5 : 6) || versions.wallet !== 1 || versions.commerce !== 1 || versions.growth !== 'focus-minutes-v1') throw Error('备份版本信息无效');
    const expected = progress(uniqueRecords), growth = backup.growth as Partial<ReturnType<typeof progress>> | null;
    if (!growth || growth.experience !== expected.experience || growth.level !== expected.level) throw Error('成长数据与专注记录不一致');
    checkins = validateCheckinHistory(backup.checkins, wallet!.transactions);
    validateCommerceLinks(commerce!, catHouse, wallet!);
  }
  const tasks = (backup.version as number) >= 7 ? validateFocusTasks(backup.tasks) : undefined;
  const selectedTaskId = (backup.version as number) >= 8 ? tasks?.find(task => task.id === backup.selectedTaskId && task.status === 'pending')?.id ?? null : undefined;
  if (catNames && Object.keys(catNames).some(id => !catHouse?.ownedCatIds.includes(id))) throw Error('备份名称必须属于已拥有的猫咪');
  const expansion=backup.version===9?validateExpansion(backup.expansion,catHouse?.ownedCatIds ?? []):undefined;
  return { ...(expansion?{expansion}:{}), ...(catNames ? { catNames } : {}), ...(selectedTaskId !== undefined ? { selectedTaskId } : {}), ...(tasks ? { tasks } : {}), ...(commerce ? { commerce } : {}), ...(checkins ? { checkins } : {}), ...(wallet ? { wallet } : {}), categories, records: uniqueRecords, ...(catHouse ? { catHouse } : {}) };
}
