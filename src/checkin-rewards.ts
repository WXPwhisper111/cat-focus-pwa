import { type DailyCheckinRecord } from './daily-checkin';
import type { WalletTransaction } from './wallet';

export const CHECKIN_REWARDS_KEY = 'checkinRewardsV1';
export const CUMULATIVE_REWARDS = [[7, 10], [30, 30], [60, 50], [100, 80], [200, 120], [365, 200]] as const;
export type CheckinReward = { id: string; date: string; amount: number; type: 'streak' | 'cumulative'; status: 'paid' | 'waived' };
export type CheckinRewards = { version: 1; entries: CheckinReward[] };
export type CheckinProgress = { streak: number; cycleDay: number; total: number; nextStreakDays: number; nextStreakReward: number; nextTotalDays: number | null; nextTotalReward: number | null };
export type CheckinPresentation = { totalReward: number; bonuses: CheckinReward[]; progress: CheckinProgress };
function calendarDay(date: string) { return Date.parse(`${date}T00:00:00Z`) / 86400000; }
export function rewardNodes(history: DailyCheckinRecord[]) {
  const entries: Omit<CheckinReward, 'status'>[] = [];
  let streak = 0, start = '', previous = '';
  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date));
  sorted.forEach((record, index) => {
    streak = previous && calendarDay(record.date) - calendarDay(previous) === 1 ? streak + 1 : 1;
    if (streak === 1) start = record.date;
    const cycleDay = (streak - 1) % 7 + 1;
    if (cycleDay === 3 || cycleDay === 7) entries.push({ id: `v1:streak:${start}:${Math.floor((streak - 1) / 7)}:${cycleDay}`, date: record.date, amount: cycleDay === 3 ? 5 : 15, type: 'streak' });
    const milestone = CUMULATIVE_REWARDS.find(([days]) => days === index + 1);
    if (milestone) entries.push({ id: `v1:cumulative:${milestone[0]}`, date: record.date, amount: milestone[1], type: 'cumulative' });
    previous = record.date;
  });
  return { entries, streak };
}
export function rewardBaseline(history: DailyCheckinRecord[]): CheckinRewards {
  return { version: 1, entries: rewardNodes(history).entries.map(entry => ({ ...entry, status: 'waived' })) };
}
export function validateCheckinRewards(value: unknown, history: DailyCheckinRecord[], transactions: WalletTransaction[]): CheckinRewards {
  const fail = (): never => { throw Error('签到额外奖励记录与历史或钱包冲突，未导入任何数据'); };
  if (!value || typeof value !== 'object') return fail();
  const state = value as CheckinRewards;
  if (state.version !== 1 || !Array.isArray(state.entries)) return fail();
  const nodes = rewardNodes(history).entries;
  if (state.entries.length !== nodes.length || new Set(state.entries.map(entry => entry?.id)).size !== nodes.length) return fail();
  const bonuses = transactions.filter(entry => entry.kind === 'checkin_bonus');
  const entries = nodes.map(node => {
    const entry = state.entries.find(item => item?.id === node.id);
    if (!entry || entry.date !== node.date || entry.amount !== node.amount || entry.type !== node.type || !['paid', 'waived'].includes(entry.status)) return fail();
    const transaction = bonuses.find(item => item.sourceId === node.id);
    const daily = history.find(item => item.date === node.date)!;
    if (entry.status === 'paid' ? !transaction || transaction.amount !== node.amount || transaction.createdAt !== daily.claimedAt : !!transaction) return fail();
    return { ...node, status: entry.status };
  });
  if (bonuses.length !== entries.filter(entry => entry.status === 'paid').length) return fail();
  return { version: 1, entries };
}
export function checkinPresentation(history: DailyCheckinRecord[], bonuses: CheckinReward[] = []): CheckinPresentation {
  const { streak } = rewardNodes(history), cycleDay = (streak - 1) % 7 + 1;
  const next = CUMULATIVE_REWARDS.find(([days]) => days > history.length);
  return { totalReward: 5 + bonuses.reduce((sum, entry) => sum + entry.amount, 0), bonuses,
    progress: { streak, cycleDay, total: history.length, nextStreakDays: cycleDay < 3 ? 3 - cycleDay : cycleDay < 7 ? 7 - cycleDay : 3,
      nextStreakReward: cycleDay < 3 || cycleDay === 7 ? 5 : 15, nextTotalDays: next ? next[0] - history.length : null, nextTotalReward: next?.[1] ?? null } };
}
