import { DAILY_CHECKIN_COINS, type WalletTransaction } from './wallet';
import type { CheckinPresentation } from './checkin-rewards';

export type DailyCheckinRecord = { date: string; claimedAt: number; reward: number; transactionId: string };
export function localDayKey(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validCheckinDate(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDayKey(date.getTime()) === value;
}
export function checkinsFromTransactions(transactions: WalletTransaction[]): DailyCheckinRecord[] {
  return transactions.filter(tx => tx.kind === 'daily_checkin').map(tx => {
    if (!validCheckinDate(tx.sourceId) || tx.id !== `daily_checkin:${tx.sourceId}` || tx.amount !== DAILY_CHECKIN_COINS ||
        !Number.isSafeInteger(tx.createdAt) || tx.createdAt < 0) throw Error('签到流水格式无效');
    return { date: tx.sourceId, claimedAt: tx.createdAt, reward: tx.amount, transactionId: tx.id };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function validateCheckinHistory(value: unknown, transactions: WalletTransaction[]) {
  const fail = (): never => { throw Error('签到历史与钱包流水不一致'); };
  if (!Array.isArray(value)) fail();
  const records = (value as unknown[]).map(item => {
    if (!item || typeof item !== 'object') return fail();
    const row = item as DailyCheckinRecord;
    if (typeof row.date !== 'string' || !validCheckinDate(row.date) || !Number.isSafeInteger(row.claimedAt) || row.claimedAt < 0 || row.reward !== DAILY_CHECKIN_COINS || row.transactionId !== `daily_checkin:${row.date}`) return fail();
    return { date: row.date, claimedAt: row.claimedAt, reward: row.reward, transactionId: row.transactionId };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (JSON.stringify(records) !== JSON.stringify(checkinsFromTransactions(transactions))) fail();
  return records;
}

export function createDailyCheckinRunner(options: {
  claim: (now: number) => Promise<{ created: boolean; record: DailyCheckinRecord; presentation?: CheckinPresentation }>;
  onSuccess: (record: DailyCheckinRecord, presentation?: CheckinPresentation) => Promise<void> | void;
  onChecked?: () => Promise<void> | void;
  onError: (error: unknown) => void;
  now?: () => number;
}) {
  let checkedDay = '', failedDay = '', retryAt = 0;
  let running: Promise<void> | undefined;
  return {
    check(forceRetry = false): Promise<void> {
      if (running) return running;
      const now = options.now?.() ?? Date.now(), day = localDayKey(now);
      if (checkedDay === day || !forceRetry && failedDay === day && now < retryAt) return Promise.resolve();
      running = (async () => {
        let result;
        try { result = await options.claim(now); }
        catch (error) { failedDay = day; retryAt = now + 60_000; options.onError(error); return; }
        checkedDay = day; failedDay = ''; retryAt = 0;
        await options.onChecked?.();
        if (result.created) await options.onSuccess(result.record, result.presentation);
      })().finally(() => { running = undefined; });
      return running;
    },
  };
}
