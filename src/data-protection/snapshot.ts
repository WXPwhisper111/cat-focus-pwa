import { isRecord, parseBackup, progress, recordSignature, validMinutes, type ActiveSession, type FocusRecord } from '../domain';
import { checkinsFromTransactions } from '../daily-checkin';
import { rewardBaseline } from '../checkin-rewards';
import { expansionState } from '../cat-expansion-state';
import { defaultCommerce } from '../shop';
import { validId } from '../categories';
import { validateTaskContext } from '../focus-tasks';
import { validateRoomLocations } from '../room-locations';
import { DB_VERSION, request, transact } from '../storage';
import { accountUid } from './policy';

export const STORE_KEYS = {
  active: null, categories: 'id', coinReceipts: 'recordId', focusTasks: 'id',
  records: 'id', settings: null, wallet: null, walletTransactions: 'id',
} as const;
export type StoreName = keyof typeof STORE_KEYS;
export const STORE_NAMES = Object.keys(STORE_KEYS) as StoreName[];
export type SnapshotRow = { key: string; value: unknown };
export type SnapshotData = Record<StoreName, SnapshotRow[]>;
export type FullSnapshot = {
  format: 'cat-focus-local-migration'; version: 1; id: string; createdAt: number;
  sourceDatabase: string; ownerUid: string | null; databaseVersion: number;
  data: SnapshotData; contentHash: string; checksum: string;
};
const settingsKeys = new Set([
  'selectedCategoryId', 'timerMode', 'pendingCompletions', 'catHouse', 'dailyCheckins',
  'checkinRewardsV1', 'commerce', 'catExpansion-v2', 'catNames', 'selectedFocusTaskId',
  'roomLocations', 'backupPreferences', 'defaultCategories-v2',
]);
const natural = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function validateSourceOwner(name: string, owner: string | null) {
  if (name.startsWith('cat-focus-pwa-user-') && (!owner || !name.startsWith(`cat-focus-pwa-user-${owner}-shadow-`))) {
    throw Error('账号数据库必须携带匹配的 UID，不能当作访客源');
  }
}

// Reject unsupported structured-clone types instead of silently losing fields in JSON.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw Error('快照不支持稀疏数组，未省略字段');
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw Error('快照含不支持的字段类型，已停止；不会丢弃字段继续迁移');
}
async function sha256(value: unknown) {
  if (!globalThis.crypto?.subtle) throw Error('完整快照校验需要 HTTPS 或 localhost 安全环境');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function assertSchema(db: IDBDatabase) {
  if (db.version !== DB_VERSION || JSON.stringify(Array.from(db.objectStoreNames)) !== JSON.stringify(STORE_NAMES)) throw Error('数据库版本或 stores 不受支持，未执行升级');
  const tx = db.transaction(STORE_NAMES, 'readonly');
  for (const name of STORE_NAMES) {
    const store = tx.objectStore(name);
    if (store.keyPath !== STORE_KEYS[name] || store.autoIncrement || store.indexNames.length) throw Error('数据库主键或索引与已验证 schema 不符');
  }
}

export function validateSnapshotData(data: SnapshotData) {
  if (!data || JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(STORE_NAMES)) throw Error('完整快照缺少 store 或包含未知 store');
  for (const name of STORE_NAMES) {
    if (!Array.isArray(data[name])) throw Error('快照 store 格式无效');
    const keys = new Set<string>();
    for (const row of data[name]) {
      if (!row || typeof row.key !== 'string' || keys.has(row.key) || !Object.hasOwn(row, 'value')) throw Error('快照包含重复或无效主键');
      keys.add(row.key);
      const keyPath = STORE_KEYS[name];
      if (keyPath && (!row.value || (row.value as Record<string, unknown>)[keyPath] !== row.key)) throw Error('快照主键与值不匹配');
      if ((name === 'active' || name === 'wallet') && row.key !== 'only') throw Error('单例 store 主键无效');
      if (name === 'settings' && !settingsKeys.has(row.key)) throw Error('发现未知 settings 键，请先审查；不会遗漏或复制潜在凭据');
    }
  }
  const settings = new Map(data.settings.map(row => [row.key, row.value]));
  const records = data.records.map(row => row.value) as FocusRecord[];
  const wallet = { state: data.wallet[0]?.value, transactions: data.walletTransactions.map(row => row.value), receipts: data.coinReceipts.map(row => row.value) };
  const checkins = checkinsFromTransactions(wallet.transactions as Parameters<typeof checkinsFromTransactions>[0]);
  const house = settings.get('catHouse');
  const parsed = parseBackup(JSON.stringify({
    format: 'cat-focus-pwa', version: 10,
    versions: { database: DB_VERSION, wallet: 1, commerce: 1, growth: 'focus-minutes-v1' },
    records, categories: data.categories.map(row => row.value), tasks: data.focusTasks.map(row => row.value),
    selectedTaskId: settings.get('selectedFocusTaskId') ?? null, growth: progress(records), wallet,
    commerce: settings.get('commerce') ?? defaultCommerce(), checkins: settings.get('dailyCheckins') ?? checkins,
    checkinRewards: settings.get('checkinRewardsV1') ?? rewardBaseline(checkins),
    expansion: settings.get('catExpansion-v2') ?? expansionState(), catNames: settings.get('catNames'),
    ...(house === undefined ? {} : { catHouse: house }),
  }));
  const active = data.active[0]?.value as ActiveSession | undefined;
  if (data.active.length && (!active || typeof active !== 'object')) throw Error('活动专注状态无效');
  if (active) {
    if (!validId(active.id) || !parsed.categories.some(c => c.id === active.categoryId) || typeof active.category !== 'string' ||
        !natural(active.startedAt) || !natural(active.accumulatedMs) ||
        !['running', 'paused'].includes(active.status) ||
        (active.status === 'paused' ? active.runSinceMs !== null : !natural(active.runSinceMs)) ||
        (active.mode === 'countdown' ? !validMinutes(active.targetMinutes) : active.mode !== 'stopwatch' || active.targetMinutes !== null)) throw Error('活动专注状态无效');
    if (active.taskContext) validateTaskContext(active.taskContext);
  }
  const pending = settings.get('pendingCompletions');
  if (pending !== undefined) {
    if (!Array.isArray(pending)) throw Error('待展示总结格式无效');
    const seen = new Set<string>();
    for (const entry of pending) {
      if (!entry || !isRecord(entry.record) || seen.has(entry.record.id) || !natural(entry.earned) ||
          !natural(entry.settledAt) || (entry.coinsEarned !== undefined && !natural(entry.coinsEarned)) ||
          !records.some(record => record.id === entry.record.id && recordSignature(record) === recordSignature(entry.record))) throw Error('总结与专注记录不一致');
      seen.add(entry.record.id);
    }
  }
  if (settings.has('roomLocations')) {
    const positions = validateRoomLocations(settings.get('roomLocations'));
    if (Object.keys(positions).some(id => !parsed.catHouse?.residentCatIds.includes(id))) throw Error('猫咪位置与入住状态不一致');
  }
  if (settings.has('timerMode') && !['countdown', 'stopwatch'].includes(settings.get('timerMode') as string)) throw Error('计时偏好无效');
  if (settings.has('selectedCategoryId') && !parsed.categories.some(c => c.id === settings.get('selectedCategoryId'))) throw Error('类别选择无效');
  if (settings.has('selectedFocusTaskId') && !parsed.tasks?.some(t => t.id === settings.get('selectedFocusTaskId') && t.status === 'pending')) throw Error('任务选择无效');
  const prefs = settings.get('backupPreferences') as { firstAt: number; enabled: boolean; lastExportAt?: number } | undefined;
  if (settings.has('backupPreferences') && (!prefs || !natural(prefs.firstAt) || typeof prefs.enabled !== 'boolean' || (prefs.lastExportAt !== undefined && !natural(prefs.lastExportAt)))) throw Error('备份偏好无效');
  if (settings.has('defaultCategories-v2') && settings.get('defaultCategories-v2') !== true) throw Error('初始化标记无效');
  canonicalJson(data);
  return parsed;
}

export async function captureSnapshot(db: IDBDatabase, ownerUid: string | null = null): Promise<FullSnapshot> {
  validateSourceOwner(db.name, ownerUid);
  assertSchema(db);
  const entries = await transact(db, STORE_NAMES, 'readonly', async tx => Promise.all(STORE_NAMES.map(async name => {
    const store = tx.objectStore(name);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    return [name, keys.map((key, i) => ({ key, value: values[i] }))] as const;
  })));
  const data = Object.fromEntries(entries) as SnapshotData;
  validateSnapshotData(data);
  const base = {
    format: 'cat-focus-local-migration' as const, version: 1 as const, id: crypto.randomUUID(), createdAt: Date.now(),
    sourceDatabase: db.name, ownerUid: ownerUid === null ? null : accountUid(ownerUid), databaseVersion: db.version, data,
    contentHash: await sha256(data),
  };
  return { ...base, checksum: await sha256(base) };
}

export async function verifySnapshot(raw: unknown): Promise<FullSnapshot> {
  const value = structuredClone(raw) as FullSnapshot;
  if (!value || value.format !== 'cat-focus-local-migration' || value.version !== 1 || value.databaseVersion !== DB_VERSION ||
      !natural(value.createdAt) || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id) ||
      typeof value.sourceDatabase !== 'string' || !value.sourceDatabase ||
      (value.ownerUid !== null && accountUid(value.ownerUid) !== value.ownerUid)) throw Error('迁移快照格式或来源无效');
  validateSourceOwner(value.sourceDatabase, value.ownerUid);
  validateSnapshotData(value.data);
  const { checksum, ...base } = value;
  if (await sha256(value.data) !== value.contentHash || await sha256(base) !== checksum) throw Error('完整快照校验失败，未恢复数据');
  return value;
}

export function snapshotSummary(snapshot: FullSnapshot) {
  const business = validateSnapshotData(snapshot.data);
  return {
    records: snapshot.data.records.length, tasks: snapshot.data.focusTasks.length,
    balance: business.wallet!.state.balance, transactions: snapshot.data.walletTransactions.length,
    cats: business.catHouse?.ownedCatIds.length ?? 0, furniture: business.commerce!.inventory.ownedFurnitureIds.length,
    checkins: business.checkins!.length, active: snapshot.data.active.length > 0,
  };
}
