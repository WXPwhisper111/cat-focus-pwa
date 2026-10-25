import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkinToday, exportBackup, getDailyCheckins, getWallet, importBackup, openDatabase } from '../src/storage';
import { CHECKIN_REWARDS_KEY, CUMULATIVE_REWARDS, checkinPresentation, rewardBaseline, rewardNodes } from '../src/checkin-rewards';
import { parseBackup } from '../src/domain';

let db: IDBDatabase;
const day = (index: number) => new Date(2026, 11, 27 + index, 12).getTime();
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); db = await openDatabase('rewards'); });
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function claimDays(count: number) { const results = []; for (let index = 0; index < count; index++) results.push(await checkinToday(db, day(index))); return results; }
async function legacyBackup(count: number) {
  await claimDays(count);
  const backup = JSON.parse(await exportBackup(db)); backup.version = 9; delete backup.checkinRewards;
  const extra = backup.wallet.transactions.filter((entry: { kind: string }) => entry.kind === 'checkin_bonus').reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0);
  backup.wallet.transactions = backup.wallet.transactions.filter((entry: { kind: string }) => entry.kind !== 'checkin_bonus');
  backup.wallet.state.balance -= extra; backup.wallet.state.totalIncome -= extra;
  return JSON.stringify(backup);
}
it('awards repeating streak days 3, 7, 10, 14 across year boundaries, stacking day 7 with cumulative rewards', async () => {
  const results = await claimDays(14);
  expect(results.map(result => result.presentation!.totalReward)).toEqual([5,5,10,5,5,5,30,5,5,10,5,5,5,20]);
  expect(results[9].presentation!.progress).toMatchObject({ streak: 10, cycleDay: 3, total: 10 });
  expect((await getWallet(db)).state.balance).toBe(120);
  expect((await getWallet(db)).transactions.filter(entry => entry.kind === 'daily_checkin').every(entry => entry.amount === 5)).toBe(true);
});
it('resets only streak after a missed calendar day and retains cumulative progress', async () => {
  await claimDays(3); const result = await checkinToday(db, day(5));
  expect(result.presentation).toMatchObject({ totalReward: 5, progress: { streak: 1, cycleDay: 1, total: 4 } });
});
it('pays every lifetime milestone once and finishes the cumulative target list at 365', async () => {
  const results = await claimDays(365);
  for (const [days, amount] of CUMULATIVE_REWARDS) expect(results[days - 1].presentation!.bonuses).toContainEqual(expect.objectContaining({ type: 'cumulative', amount }));
  expect(results[364].presentation!.progress.nextTotalDays).toBeNull();
  const before = await getWallet(db); expect((await checkinToday(db, day(364))).created).toBe(false); expect(await getWallet(db)).toEqual(before);
});
it('counts spring and autumn daylight-saving calendar dates without assuming elapsed 24 hours', () => {
  for (const dates of [['2026-03-07','2026-03-08','2026-03-09'], ['2026-10-31','2026-11-01','2026-11-02']]) {
    const history = dates.map(date => ({ date, reward:5, transactionId:`daily_checkin:${date}`, claimedAt:0 }));
    expect(rewardNodes(history).streak).toBe(3); expect(rewardNodes(history).entries[0].amount).toBe(5);
  }
});
it('baselines old progress without paying retroactively or repeating the upgrade-day welcome', async () => {
  const raw = await legacyBackup(7), target = await openDatabase('legacy');
  try {
    await importBackup(target, raw); await importBackup(target, raw);
    expect((await getWallet(target)).state.balance).toBe(35);
    expect((await checkinToday(target, day(6))).created).toBe(false);
    const restored = JSON.parse(await exportBackup(target)); expect(restored.checkinRewards.entries.every((entry: {status:string}) => entry.status === 'waived')).toBe(true);
    await checkinToday(target, day(7)); await checkinToday(target, day(8)); await importBackup(target, raw); const next = await checkinToday(target, day(9));
    expect(next.presentation!.totalReward).toBe(10); expect(next.presentation!.progress.streak).toBe(10);
    const before = await getWallet(target); await expect(importBackup(target, raw)).rejects.toThrow(); expect(await getWallet(target)).toEqual(before);
  } finally { target.close(); }
});
it('initializes existing local history with missing policy and never tops up historical nodes', async () => {
  const raw = await legacyBackup(7), target = await openDatabase('pre-policy');
  try {
    await importBackup(target, raw);
    await new Promise<void>((resolve, reject) => { const transaction = target.transaction('settings','readwrite'); transaction.objectStore('settings').delete(CHECKIN_REWARDS_KEY); transaction.oncomplete=()=>resolve(); transaction.onerror=()=>reject(transaction.error); });
    const next = await checkinToday(target, day(7)); expect(next.presentation!.totalReward).toBe(5); expect((await getWallet(target)).state.balance).toBe(40);
  } finally { target.close(); }
});
it('serializes two tabs on a bonus day and atomically rolls back a failed bonus write', async () => {
  await claimDays(2); const before = await getWallet(db), add = IDBObjectStore.prototype.add;
  const failure = vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === 'walletTransactions' && args[0].kind === 'checkin_bonus') throw Error('bonus write failed'); return add.apply(this,args);
  });
  await expect(checkinToday(db, day(2))).rejects.toThrow('bonus write failed'); failure.mockRestore();
  expect(await getWallet(db)).toEqual(before); expect(await getDailyCheckins(db)).toHaveLength(2);
  const other = await openDatabase(db.name);
  try { const results = await Promise.all([checkinToday(db,day(2)),checkinToday(other,day(2))]); expect(results.filter(result=>result.created)).toHaveLength(1); expect((await getWallet(db)).state.balance).toBe(20); } finally { other.close(); }
});
it('roundtrips v10 and rejects paid/waived, amount, date, missing policy and unknown bonus conflicts', async () => {
  await claimDays(7); const raw = await exportBackup(db), backup = JSON.parse(raw), target = await openDatabase('roundtrip');
  try {
    expect(backup.version).toBe(10); await importBackup(target,raw); await importBackup(target,raw); expect(await getWallet(target)).toEqual(await getWallet(db));
    for (const mutate of [
      (value: typeof backup)=>{delete value.checkinRewards;},
      (value: typeof backup)=>{value.checkinRewards.entries[0].status='waived';},
      (value: typeof backup)=>{value.checkinRewards.entries[0].amount++;},
      (value: typeof backup)=>{value.checkinRewards.entries[0].date='2026-01-01';},
      (value: typeof backup)=>{value.checkinRewards.entries.push(value.checkinRewards.entries[0]);},
    ]) { const modified=structuredClone(backup); mutate(modified); expect(()=>parseBackup(JSON.stringify(modified))).toThrow('奖励'); }
    const before=await getWallet(target); const old=structuredClone(backup); old.version=9; delete old.checkinRewards;
    await expect(importBackup(target,JSON.stringify(old))).rejects.toThrow('奖励'); expect(await getWallet(target)).toEqual(before);
  } finally { target.close(); }
});
it('does not grant bonuses when the clock rolls back or re-count an already claimed date', async () => {
  await checkinToday(db,day(8)); const result=await checkinToday(db,day(0)); expect(result.presentation!.bonuses).toEqual([]);
  expect((await checkinToday(db,day(8))).created).toBe(false);
  expect(rewardBaseline(await getDailyCheckins(db)).entries).toEqual([]);
  expect(checkinPresentation(await getDailyCheckins(db)).progress.total).toBe(2);
});
it.each([6,7,8,9])('imports v%s history without awarding old milestones and preserves waivers on repeated restore', async version => {
  const backup=JSON.parse(await legacyBackup(7)); backup.version=version; backup.versions.database=version===6?5:6;
  const target=await openDatabase(`old-${version}`);
  try { await importBackup(target,JSON.stringify(backup)); await importBackup(target,JSON.stringify(backup)); expect((await getWallet(target)).state.balance).toBe(35); expect((await checkinToday(target,day(6))).created).toBe(false); } finally { target.close(); }
});
it('rejects conflicting valid paid and waived states instead of merging wallet balances', async () => {
  const old=await legacyBackup(7), paid=await exportBackup(db), target=await openDatabase('conflict');
  try { await importBackup(target,old); const before=await getWallet(target); await expect(importBackup(target,paid)).rejects.toThrow('签到额外奖励领取状态冲突'); expect(await getWallet(target)).toEqual(before); } finally { target.close(); }
});
