export const COIN_INTERVAL_MS = 5 * 60_000;
export const DAILY_CHECKIN_COINS = 5; // Daily automatic check-in; focus rewards remain independent.
export type WalletIncomeKind = 'focus' | 'daily_checkin' | 'test_grant';
export type WalletState = {
  version: 1; balance: number; totalIncome: number; totalSpent: number; remainderMs: number;
  migratedAt: number; baseline: { sessionId: string; effectiveMs: number } | null;
};
export type WalletTransaction = {
  id: string; kind: WalletIncomeKind | 'spend'; sourceId: string; amount: number; description: string; createdAt: number;
};
export type CoinReceipt = { recordId: string; eligibleMs: number; coins: number };
export type WalletSnapshot = { state: WalletState; transactions: WalletTransaction[]; receipts: CoinReceipt[] };
export const initialWallet = (now: number, baseline: WalletState['baseline'] = null): WalletState => ({
  version: 1, balance: 0, totalIncome: 0, totalSpent: 0, remainderMs: 0, migratedAt: now, baseline,
});
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const key = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

export function validateWalletSnapshot(value: unknown): WalletSnapshot {
  const fail = (): never => { throw Error('钱包备份无效或余额与流水不一致'); };
  if (!value || typeof value !== 'object') fail();
  const { state, transactions, receipts } = value as WalletSnapshot;
  if (!state || state.version !== 1 || ![state.balance, state.totalIncome, state.totalSpent, state.remainderMs, state.migratedAt].every(natural) ||
      state.remainderMs >= COIN_INTERVAL_MS || !Array.isArray(transactions) || !Array.isArray(receipts)) fail();
  if (state.baseline !== null && (!state.baseline || !key(state.baseline.sessionId) || !natural(state.baseline.effectiveMs))) fail();
  const txIds = new Set<string>(), receiptIds = new Set<string>();
  let income = 0, spent = 0, eligible = 0;
  for (const tx of transactions) {
    if (!tx || !key(tx.id) || !key(tx.sourceId) || txIds.has(tx.id) || tx.id !== `${tx.kind}:${tx.sourceId}` ||
        !Number.isSafeInteger(tx.amount) || !tx.amount || !natural(tx.createdAt) || typeof tx.description !== 'string' || tx.description.length > 200 ||
        !['focus', 'daily_checkin', 'test_grant', 'spend'].includes(tx.kind) || (tx.kind === 'spend' ? tx.amount >= 0 : tx.amount <= 0) ||
        (tx.kind === 'daily_checkin' && tx.amount !== DAILY_CHECKIN_COINS)) fail();
    txIds.add(tx.id); if (tx.amount > 0) income += tx.amount; else spent -= tx.amount;
  }
  const focus = new Map(transactions.filter(tx => tx.kind === 'focus').map(tx => [tx.sourceId, tx]));
  let focusCoins = 0;
  for (const receipt of receipts) {
    if (!receipt || !key(receipt.recordId) || receiptIds.has(receipt.recordId) || !natural(receipt.eligibleMs) || !natural(receipt.coins)) fail();
    receiptIds.add(receipt.recordId); eligible += receipt.eligibleMs; focusCoins += receipt.coins;
    if ((focus.get(receipt.recordId)?.amount || 0) !== receipt.coins) fail();
  }
  if (!Number.isSafeInteger(eligible) || !Number.isSafeInteger(income) || !Number.isSafeInteger(spent) ||
      focus.size !== receipts.filter(receipt => receipt.coins > 0).length || Math.floor(eligible / COIN_INTERVAL_MS) !== focusCoins ||
      eligible % COIN_INTERVAL_MS !== state.remainderMs || income !== state.totalIncome || spent !== state.totalSpent || income - spent !== state.balance) fail();
  // Return a canonical copy; unknown fields cannot influence equality or future storage.
  return {
    state: { version: 1, balance: state.balance, totalIncome: income, totalSpent: spent, remainderMs: state.remainderMs, migratedAt: state.migratedAt,
      baseline: state.baseline ? { sessionId: state.baseline.sessionId, effectiveMs: state.baseline.effectiveMs } : null },
    transactions: transactions.map(tx => ({ id: tx.id, kind: tx.kind, sourceId: tx.sourceId, amount: tx.amount, description: tx.description, createdAt: tx.createdAt })),
    receipts: receipts.map(receipt => ({ recordId: receipt.recordId, eligibleMs: receipt.eligibleMs, coins: receipt.coins })),
  };
}
export function walletSignature(snapshot: WalletSnapshot) {
  const canonical = validateWalletSnapshot(snapshot);
  return JSON.stringify({ ...canonical, transactions: canonical.transactions.sort((a, b) => a.id.localeCompare(b.id)), receipts: canonical.receipts.sort((a, b) => a.recordId.localeCompare(b.recordId)) });
}
