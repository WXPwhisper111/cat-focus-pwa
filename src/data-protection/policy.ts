export function accountUid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw Error('账号 UID 无效');
  return value.toLowerCase();
}

export type OwnershipDecision = {
  ownerUid: string;
  snapshotHash: string;
  localEconomyBaseline: 'use-this-snapshot-without-merging';
  cloudEconomyBaseline: 'not-configured';
  externalBackupConfirmed: true;
  existingAccount?: 'keep-existing-as-archive';
};

export function validateOwnership(decision: OwnershipDecision, uid: string, hash: string) {
  if (decision.ownerUid !== uid || decision.snapshotHash !== hash ||
      decision.localEconomyBaseline !== 'use-this-snapshot-without-merging' ||
      decision.cloudEconomyBaseline !== 'not-configured' || decision.externalBackupConfirmed !== true) {
    throw Error('必须明确确认账号归属、独立钱包基线与设备外备份；不允许相加钱包');
  }
}

export type MigrationPhase = 'prepared' | 'copied' | 'verified' | 'active' | 'rolled-back';
export function assertSafeActivation(input: { phase: MigrationPhase; sourceMatches: boolean; targetMatches: boolean; pointerUnchanged: boolean; hasActiveSession: boolean }) {
  if (input.phase !== 'verified' || !input.targetMatches) throw Error('影子副本尚未验证，禁止切换');
  if (!input.sourceMatches) throw Error('源数据已变化，请重新预览');
  if (!input.pointerUnchanged) throw Error('账号数据上下文已变化，禁止覆盖');
  if (input.hasActiveSession) throw Error('请先结束活动专注，再迁移');
}

// A policy interface, not an implementation of cloud purchases/check-ins.
export interface FutureAccountPolicy {
  businessTimezone: string | null;
  timezoneChanges: 'requires-explicit-rule';
  lateCheckins: 'requires-explicit-rule';
  historicalRewardReplay: false;
  sharedPurchases: 'requires-online-server-confirmation';
}
export const futureAccountPolicy: Readonly<FutureAccountPolicy> = Object.freeze({
  businessTimezone: null, timezoneChanges: 'requires-explicit-rule', lateCheckins: 'requires-explicit-rule',
  historicalRewardReplay: false, sharedPurchases: 'requires-online-server-confirmation',
});
export function assertSharedPurchaseAvailable(online: boolean): never {
  if (!online) throw Error('共享经济购买需要联网并取得服务端确认');
  throw Error('尚未接入云端购买确认，本阶段不开放共享经济购买');
}
