import { EXPANSION_KEY, expansionState, validateExpansion, mergeExpansion, newCatIds, type ExpansionState } from './cat-expansion-state';
import { CAT_NAMES_KEY, normalizeCatName, validateCatNames } from './cat-names';
import { SELECTED_FOCUS_TASK_KEY, taskSignature, validateFocusTask, validateFocusTasks } from './focus-tasks';
import { validateRoomLocations, type RoomLocations } from './room-locations';
import { commerceSignature, defaultCommerce, getProduct, productName, validateCommerce, validateCommerceLinks, type CommerceState } from './shop';
import { COIN_INTERVAL_MS, initialWallet, validateWalletSnapshot, walletSignature, type WalletState, type WalletTransaction, type WalletSnapshot, type CoinReceipt } from './wallet';
import { checkinsFromTransactions, localDayKey, validCheckinDate, type DailyCheckinRecord } from './daily-checkin';
import { DAILY_CHECKIN_COINS } from './wallet';
import { elapsedMs, isDue, isRecord, makeRecord, parseBackup, progress, recordSignature, type ActiveSession, type FocusRecord, type TimerConfiguration, type TimerMode, validMinutes } from './domain';
import { categoryKey, DEFAULT_CATEGORIES, normalizeCategoryName, sortCategories, type FocusCategory } from './categories';
import { getCatDefinition } from './cat-definition';
import { catHouseSignature, hasAdoptedCat, validateCatHouseState, type CatHouseState } from './cat-house-state';

export const DB_VERSION = 6;
const DB_NAME = 'cat-focus-pwa';
const ACTIVE_KEY = 'only';
const SELECTED_CATEGORY_KEY = 'selectedCategoryId';
const TIMER_MODE_KEY = 'timerMode';
const PENDING_COMPLETIONS_KEY = 'pendingCompletions';
const CAT_HOUSE_KEY = 'catHouse';
const DAILY_CHECKINS_KEY = 'dailyCheckins';
const COMMERCE_KEY = 'commerce';

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error('存储事务中止'));
    tx.onerror = () => reject(tx.error || Error('存储失败'));
  });
}

export async function transact<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, mode);
  const finished = done(tx);
  try {
    const result = await operation(tx);
    await finished;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed or aborted. */ }
    await finished.catch(() => {});
    throw error;
  }
}

export function openDatabase(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        db.createObjectStore('active');
        db.createObjectStore('records', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('settings');
      }
      if (oldVersion < 3) {
        const categories = db.createObjectStore('categories', { keyPath: 'id' });
        for (const item of DEFAULT_CATEGORIES) categories.add({ ...item });
        req.transaction!.objectStore('settings').put(DEFAULT_CATEGORIES[0].id, SELECTED_CATEGORY_KEY);
      }
      if (oldVersion < 4) {
        // Use a single cursor pass for category IDs and modes. Two concurrent
        // passes could overwrite each other's updates when upgrading from v1/v2.
        for (const storeName of ['active', 'records']) {
          const cursor = req.transaction!.objectStore(storeName).openCursor();
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) return;
            const migrated = { ...current.value, mode: 'countdown' };
            if (oldVersion < 3) {
              const category = DEFAULT_CATEGORIES.find(item => item.name === migrated.category);
              if (!category) { req.transaction!.abort(); return; }
              migrated.categoryId = category.id;
            }
            current.update(migrated);
            current.continue();
          };
        }
      }
      if (oldVersion < 5) {
        const wallet = db.createObjectStore('wallet');
        db.createObjectStore('walletTransactions', { keyPath: 'id' });
        db.createObjectStore('coinReceipts', { keyPath: 'recordId' });
        const migratedAt = Date.now();
        const active = req.transaction!.objectStore('active').get(ACTIVE_KEY);
        active.onsuccess = () => {
          const session = active.result as ActiveSession | undefined;
          // v1–v3 sessions have not necessarily been rewritten by the migration cursor yet.
          const effective = session ? Math.round(Math.min(elapsedMs(session, migratedAt),
            session.mode === 'stopwatch' ? Number.MAX_SAFE_INTEGER : session.targetMinutes! * 60_000)) : 0;
          wallet.put(initialWallet(migratedAt, session ? { sessionId: session.id, effectiveMs: effective } : null), 'only');
          // Old pending summaries may have been rendered before migration: never show old coin awards as new income.
          const settings = req.transaction!.objectStore('settings');
          const pending = settings.get(PENDING_COMPLETIONS_KEY);
          pending.onsuccess = () => settings.put(completionQueue(pending.result).map(summary => ({ ...summary, coinsEarned: 0 })), PENDING_COMPLETIONS_KEY);
        };
      }
      if (oldVersion < 6) db.createObjectStore('focusTasks', { keyPath: 'id' });
      // Future schema migrations are added here by oldVersion.
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      void ensureDefaultCategories(req.result).then(() => ensureCatExpansion(req.result)).then(() => resolve(req.result), error => { req.result.close(); reject(error); });
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error('请关闭其他旧版本页面后重试'));
  });
}

async function ensureCatExpansion(db: IDBDatabase) {
  await transact(db,['settings'],'readwrite',async tx=>{
    const settings=tx.objectStore('settings'); if(await request(settings.get(EXPANSION_KEY))!==undefined)return;
    const house=await request(settings.get(CAT_HOUSE_KEY));
    settings.put(expansionState(house!==undefined && hasAdoptedCat(validateCatHouseState(house))),EXPANSION_KEY);
  });
}
export async function getCatExpansion(db:IDBDatabase) {
  return validateExpansion(await request(db.transaction('settings').objectStore('settings').get(EXPANSION_KEY)));
}
export async function claimExpansionCat(db:IDBDatabase,id:string,now=Date.now()) {
  if(!newCatIds.includes(id as typeof newCatIds[number]))throw Error('免费名额仅适用于新增三只猫');
  return transact(db,['settings'],'readwrite',async tx=>{
    const settings=tx.objectStore('settings'), house=validateCatHouseState(await request(settings.get(CAT_HOUSE_KEY)));
    const grant=validateExpansion(await request(settings.get(EXPANSION_KEY)),house.ownedCatIds);
    if(!grant.eligible || grant.claimed)throw Error('没有可用的免费名额');
    if(house.ownedCatIds.includes(id))throw Error('已经拥有这只猫，请选择其他猫');
    const next=validateExpansion({...grant,claimed:{catId:id,claimedAt:now}});
    house.ownedCatIds.push(id);if(house.residentCatIds.length<3)house.residentCatIds.push(id);
    settings.put(validateCatHouseState(house),CAT_HOUSE_KEY);settings.put(next,EXPANSION_KEY);return house;
  });
}
export async function manageResidents(db:IDBDatabase,id:string,operation:'in'|'out',replaceId?:string) {
  return transact(db,['settings'],'readwrite',async tx=>{
    const settings=tx.objectStore('settings'), house=validateCatHouseState(await request(settings.get(CAT_HOUSE_KEY)));
    if(!house.ownedCatIds.includes(id))throw Error('只能安排已拥有的猫');
    if(operation==='out') {
      if(!house.residentCatIds.includes(id))return house;
      if(house.residentCatIds.length<=1)throw Error('请至少保留一只猫入住');
      house.residentCatIds=house.residentCatIds.filter(value=>value!==id);
    } else if(!house.residentCatIds.includes(id)) {
      if(replaceId) {
        const index=house.residentCatIds.indexOf(replaceId);if(index<0)throw Error('入住名单已变化，请重新选择');
        house.residentCatIds[index]=id;
      } else {
        if(house.residentCatIds.length>=3)throw Error('小屋已满，请选择要暂离的猫');
        house.residentCatIds.push(id);
      }
    }
    settings.put(validateCatHouseState(house),CAT_HOUSE_KEY);return house;
  });
}

// Content update in the existing stores; preserve existing IDs, archives and selection.
async function ensureDefaultCategories(db: IDBDatabase) {
  await transact(db, ['categories', 'settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    if (await request(settings.get('defaultCategories-v2'))) return;
    const store = tx.objectStore('categories');
    const existing = await request<FocusCategory[]>(store.getAll());
    let order = Math.max(-1, ...existing.map(category => category.order)) + 1;
    for (const category of DEFAULT_CATEGORIES.slice(2)) {
      if (existing.some(item => item.id === category.id || categoryKey(item.name) === categoryKey(category.name))) continue;
      store.add({ ...category, order: order++ });
    }
    settings.put(true, 'defaultCategories-v2');
  });
}

export async function getActive(db: IDBDatabase): Promise<ActiveSession | undefined> {
  return request(db.transaction('active').objectStore('active').get(ACTIVE_KEY));
}
export async function getRecords(db: IDBDatabase): Promise<FocusRecord[]> {
  return request(db.transaction('records').objectStore('records').getAll());
}

export async function getCatHouseState(db: IDBDatabase): Promise<CatHouseState | null> {
  const value = await request(db.transaction('settings').objectStore('settings').get(CAT_HOUSE_KEY));
  return value === undefined ? null : validateCatHouseState(value);
}

export async function getCatNames(db: IDBDatabase) {
  return validateCatNames(await request(db.transaction('settings').objectStore('settings').get(CAT_NAMES_KEY)));
}
export async function renameCat(db: IDBDatabase, id: string, value: string) {
  const name = normalizeCatName(value);
  return transact(db, ['settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    const house = validateCatHouseState(await request(settings.get(CAT_HOUSE_KEY)));
    if (!house.ownedCatIds.includes(id)) throw Error('只能修改已拥有猫咪的名称');
    const names = validateCatNames(await request(settings.get(CAT_NAMES_KEY)));
    names[id] = name; settings.put(names, CAT_NAMES_KEY);
    return names;
  });
}

export async function adoptInitialCat(db: IDBDatabase, id: string): Promise<CatHouseState> {
  if (!getCatDefinition(id)) throw Error('猫咪不存在，请重新选择');
  return transact(db, ['settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    const value = await request(settings.get(CAT_HOUSE_KEY));
    const existing = value === undefined ? null : validateCatHouseState(value);
    if (hasAdoptedCat(existing)) {
      if (existing!.companionCatId === id && existing!.ownedCatIds.length === 1) return existing!;
      throw Error('已经完成首次领养，不能重新选择');
    }
    const state = validateCatHouseState({ ownedCatIds: [id], residentCatIds: [id], companionCatId: id });
    settings.put(state, CAT_HOUSE_KEY);
    return state;
  });
}

export async function getTimerMode(db: IDBDatabase): Promise<TimerMode> {
  const value = await request(db.transaction('settings').objectStore('settings').get(TIMER_MODE_KEY));
  return value === 'stopwatch' ? 'stopwatch' : 'countdown';
}

export async function selectTimerMode(db: IDBDatabase, mode: TimerMode) {
  if (mode !== 'countdown' && mode !== 'stopwatch') throw Error('计时模式无效');
  await transact(db, ['settings'], 'readwrite', async tx => { tx.objectStore('settings').put(mode, TIMER_MODE_KEY); });
}

export async function getCategoryState(db: IDBDatabase) {
  return transact(db, ['categories', 'settings'], 'readwrite', async tx => {
    const categories = sortCategories(await request<FocusCategory[]>(tx.objectStore('categories').getAll()));
    const settings = tx.objectStore('settings');
    const saved = await request<string | undefined>(settings.get(SELECTED_CATEGORY_KEY));
    const selectedId = categories.find(item => item.id === saved && !item.archived)?.id || categories.find(item => !item.archived)?.id;
    if (!selectedId) throw Error('没有可用的专注类别');
    if (selectedId !== saved) settings.put(selectedId, SELECTED_CATEGORY_KEY);
    return { categories, selectedId };
  });
}

export async function selectCategory(db: IDBDatabase, id: string) {
  return transact(db, ['categories', 'settings'], 'readwrite', async tx => {
    const category = await request<FocusCategory | undefined>(tx.objectStore('categories').get(id));
    if (!category || category.archived) throw Error('此类别已删除或不存在，请重新选择');
    tx.objectStore('settings').put(id, SELECTED_CATEGORY_KEY);
  });
}

export async function addCategory(db: IDBDatabase, rawName: string) {
  const name = normalizeCategoryName(rawName);
  return transact(db, ['categories', 'settings'], 'readwrite', async tx => {
    const store = tx.objectStore('categories');
    const existing = await request<FocusCategory[]>(store.getAll());
    const duplicate = existing.find(item => categoryKey(item.name) === categoryKey(name));
    if (duplicate?.archived) {
      const restored = { ...duplicate, archived: false }; store.put(restored);
      tx.objectStore('settings').put(restored.id, SELECTED_CATEGORY_KEY); return restored;
    }
    if (duplicate) throw Error('已存在同名类别，请直接选择');
    const category: FocusCategory = { id: crypto.randomUUID(), name, archived: false,
      order: Math.max(-1, ...existing.map(item => item.order)) + 1 };
    store.add(category);
    tx.objectStore('settings').put(category.id, SELECTED_CATEGORY_KEY);
    return category;
  });
}

export async function setCategoryArchived(db: IDBDatabase, id: string, archived: boolean) {
  return transact(db, ['categories', 'settings'], 'readwrite', async tx => {
    const store = tx.objectStore('categories');
    const categories = sortCategories(await request<FocusCategory[]>(store.getAll()));
    const category = categories.find(item => item.id === id);
    if (!category) throw Error('类别不存在，请刷新后重试');
    if (archived && !category.archived && categories.filter(item => !item.archived).length <= 1) throw Error('至少需要保留一个可用类别');
    store.put({ ...category, archived });
    const settings = tx.objectStore('settings');
    const selected = await request<string | undefined>(settings.get(SELECTED_CATEGORY_KEY));
    if (archived && selected === id) {
      settings.put(categories.find(item => item.id !== id && !item.archived)!.id, SELECTED_CATEGORY_KEY);
    }
  });
}

export async function startSession(db: IDBDatabase, categoryId: string, minutes: number, now = Date.now()) {
  if (!validMinutes(minutes)) throw Error('时长须为 1–180 分钟');
  return startFocus(db, categoryId, { mode: 'countdown', targetMinutes: minutes }, now);
}

export async function startStopwatch(db: IDBDatabase, categoryId: string, now = Date.now()) {
  return startFocus(db, categoryId, { mode: 'stopwatch', targetMinutes: null }, now);
}

async function startFocus(db: IDBDatabase, categoryId: string, timing: TimerConfiguration, now: number) {
  return transact(db, ['active', 'categories', 'settings', 'focusTasks'], 'readwrite', async tx => {
    const category = await request<FocusCategory | undefined>(tx.objectStore('categories').get(categoryId));
    if (!category || category.archived) throw Error('此类别已删除或不存在，请重新选择');
    const store = tx.objectStore('active');
    if (await request<ActiveSession | undefined>(store.get(ACTIVE_KEY))) throw Error('已有进行中的专注');
    const settings = tx.objectStore('settings'), selected = await request(settings.get(SELECTED_FOCUS_TASK_KEY));
    const task = typeof selected === 'string' ? await request(tx.objectStore('focusTasks').get(selected)) : undefined;
    const goal = task && validateFocusTask(task).status === 'pending' ? validateFocusTask(task) : null;
    if (!goal && selected !== undefined) settings.delete(SELECTED_FOCUS_TASK_KEY);
    const session: ActiveSession = { ...(goal ? { taskContext: { taskId: goal.id, titleSnapshot: goal.title } } : {}), ...timing, id: crypto.randomUUID(), categoryId, category: category.name,
      startedAt: now, accumulatedMs: 0, status: 'running', runSinceMs: now };
    store.put(session, ACTIVE_KEY);
    tx.objectStore('settings').put(categoryId, SELECTED_CATEGORY_KEY);
    tx.objectStore('settings').put(timing.mode, TIMER_MODE_KEY);
    return session;
  });
}

export async function togglePause(db: IDBDatabase, now = Date.now(), expectedSessionId?: string) {
  const tx = db.transaction('active', 'readwrite');
  const finished = done(tx);
  const store = tx.objectStore('active');
  const session = await request<ActiveSession | undefined>(store.get(ACTIVE_KEY));
  if (session && (!expectedSessionId || session.id === expectedSessionId)) {
    if (session.status === 'running') {
      if (isDue(session, now)) { tx.abort(); try { await finished; } catch { /* settle separately */ } return session; }
      session.accumulatedMs = elapsedMs(session, now);
      session.runSinceMs = null;
      session.status = 'paused';
    } else {
      session.runSinceMs = now;
      session.status = 'running';
    }
    store.put(session, ACTIVE_KEY);
  }
  await finished;
  return session;
}

export type CompletionSummary = { record: FocusRecord; earned: number; coinsEarned?: number; settledAt: number };
export type Settlement = { record: FocusRecord | null; created: boolean; earned?: number; coinsEarned?: number; discarded?: boolean };

function completionQueue(value: unknown): CompletionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CompletionSummary => item && typeof item === 'object' && isRecord(item.record) &&
    Number.isSafeInteger(item.earned) && item.earned >= 0 && (item.coinsEarned === undefined || Number.isSafeInteger(item.coinsEarned) && item.coinsEarned >= 0) && Number.isFinite(item.settledAt));
}

export async function getPendingCompletions(db: IDBDatabase): Promise<CompletionSummary[]> {
  const value = await request(db.transaction('settings').objectStore('settings').get(PENDING_COMPLETIONS_KEY));
  return completionQueue(value).sort((a, b) => a.settledAt - b.settledAt || a.record.id.localeCompare(b.record.id));
}

export async function acknowledgeCompletion(db: IDBDatabase, id: string) {
  await transact(db, ['settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings');
    const pending = completionQueue(await request(settings.get(PENDING_COMPLETIONS_KEY)));
    settings.put(pending.filter(item => item.record.id !== id), PENDING_COMPLETIONS_KEY);
  });
}

export async function settle(db: IDBDatabase, mode: 'due' | 'early' | 'discard', now = Date.now(), expectedSessionId?: string): Promise<Settlement> {
  return transact(db, ['active', 'records', 'settings', 'wallet', 'walletTransactions', 'coinReceipts'], 'readwrite', async tx => {
    const active = tx.objectStore('active');
    const records = tx.objectStore('records');
    const session = await request<ActiveSession | undefined>(active.get(ACTIVE_KEY));
    if (!session || (expectedSessionId && session.id !== expectedSessionId) || (mode === 'due' && !isDue(session, now))) {
      return { record: null, created: false };
    }
    let record: FocusRecord | null = null;
    let created = false;
    let earned = 0, coinsEarned = 0;
    const completed = isDue(session, now);
    if (mode !== 'discard' || completed) {
      record = makeRecord(session, now, completed);
      if (record) {
        const previous = await request<FocusRecord | undefined>(records.get(session.id));
        if (previous && recordSignature(previous) !== recordSignature(record)) throw Error('记录 ID 冲突，未结算');
        if (!previous) {
          const existing = await request<FocusRecord[]>(records.getAll());
          earned = progress([...existing, record]).experience - progress(existing).experience;
          records.add(record);
          coinsEarned = await awardFocusCoins(tx, record, now);
          const settings = tx.objectStore('settings');
          const pending = completionQueue(await request(settings.get(PENDING_COMPLETIONS_KEY)));
          settings.put([...pending, { record, earned, coinsEarned, settledAt: now } satisfies CompletionSummary], PENDING_COMPLETIONS_KEY);
          created = true;
        }
      }
    }
    const wallet = await request<WalletState>(tx.objectStore('wallet').get('only'));
    if (wallet.baseline?.sessionId === session.id) { wallet.baseline = null; tx.objectStore('wallet').put(wallet, 'only'); }
    if (session.taskContext && await request(tx.objectStore('settings').get(SELECTED_FOCUS_TASK_KEY)) === session.taskContext.taskId) tx.objectStore('settings').delete(SELECTED_FOCUS_TASK_KEY);
    active.delete(ACTIVE_KEY);
    return { record, created, ...(created ? { earned, coinsEarned } : {}), ...(mode === 'discard' && !record ? { discarded: true } : {}) };
  });
}

async function walletSnapshotIn(tx: IDBTransaction): Promise<WalletSnapshot> {
  const state = await request<WalletState>(tx.objectStore('wallet').get('only'));
  const transactions = await request<WalletTransaction[]>(tx.objectStore('walletTransactions').getAll());
  const receipts = await request<CoinReceipt[]>(tx.objectStore('coinReceipts').getAll());
  return validateWalletSnapshot({ state, transactions, receipts });
}
export async function getWallet(db: IDBDatabase): Promise<WalletSnapshot> {
  return transact(db, ['wallet', 'walletTransactions', 'coinReceipts'], 'readonly', walletSnapshotIn);
}

async function checkinHistoryIn(tx: IDBTransaction, snapshot: WalletSnapshot) {
  const history = checkinsFromTransactions(snapshot.transactions);
  const stored = await request(tx.objectStore('settings').get(DAILY_CHECKINS_KEY));
  if (stored !== undefined && JSON.stringify(stored) !== JSON.stringify(history)) throw Error('签到历史与钱包流水不一致，请检查备份');
  return history;
}
export async function getDailyCheckins(db: IDBDatabase): Promise<DailyCheckinRecord[]> {
  return transact(db, ['wallet', 'walletTransactions', 'coinReceipts', 'settings'], 'readonly', async tx => checkinHistoryIn(tx, await walletSnapshotIn(tx)));
}
export async function checkinToday(db: IDBDatabase, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || !validCheckinDate(localDayKey(now))) throw Error('签到时间无效');
  return transact(db, ['wallet', 'walletTransactions', 'coinReceipts', 'settings'], 'readwrite', async tx => {
    const snapshot = await walletSnapshotIn(tx);
    const history = await checkinHistoryIn(tx, snapshot), date = localDayKey(now);
    const previous = history.find(record => record.date === date);
    if (previous) {
      // Also materialize history restored from a pre-M2 wallet backup.
      const settings = tx.objectStore('settings');
      if (await request(settings.get(DAILY_CHECKINS_KEY)) === undefined) settings.put(history, DAILY_CHECKINS_KEY);
      return { created: false, record: previous };
    }
    const record: DailyCheckinRecord = { date, claimedAt: now, reward: DAILY_CHECKIN_COINS, transactionId: `daily_checkin:${date}` };
    const wallet = snapshot.state;
    wallet.balance += DAILY_CHECKIN_COINS; wallet.totalIncome += DAILY_CHECKIN_COINS;
    if (!Number.isSafeInteger(wallet.balance) || !Number.isSafeInteger(wallet.totalIncome)) throw Error('钱包累计超出可保存范围');
    tx.objectStore('wallet').put(wallet, 'only');
    tx.objectStore('walletTransactions').add({ id: record.transactionId, kind: 'daily_checkin', sourceId: date, amount: DAILY_CHECKIN_COINS,
      description: '每日自动签到', createdAt: now } satisfies WalletTransaction);
    tx.objectStore('settings').put([...history, record].sort((a, b) => a.date.localeCompare(b.date)), DAILY_CHECKINS_KEY);
    return { created: true, record };
  });
}
async function awardFocusCoins(tx: IDBTransaction, record: FocusRecord, now: number) {
  const receiptStore = tx.objectStore('coinReceipts');
  if (await request(receiptStore.get(record.id))) return 0;
  const store = tx.objectStore('wallet');
  const wallet = await request<WalletState>(store.get('only'));
  const baseline = wallet.baseline?.sessionId === record.id ? wallet.baseline.effectiveMs : 0;
  const eligibleMs = Math.max(0, Math.round(record.durationSeconds * 1000) - baseline);
  const total = wallet.remainderMs + eligibleMs;
  const coins = Math.floor(total / COIN_INTERVAL_MS);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(wallet.balance + coins) || !Number.isSafeInteger(wallet.totalIncome + coins)) throw Error('钱包累计超出可保存范围');
  wallet.remainderMs = total % COIN_INTERVAL_MS; wallet.balance += coins; wallet.totalIncome += coins;
  receiptStore.add({ recordId: record.id, eligibleMs, coins } satisfies CoinReceipt);
  if (coins) tx.objectStore('walletTransactions').add({ id: `focus:${record.id}`, kind: 'focus', sourceId: record.id,
    amount: coins, createdAt: now, description: '专注累计奖励' } satisfies WalletTransaction);
  store.put(wallet, 'only');
  return coins;
}

async function spendCoinsIn(tx: IDBTransaction, snapshot: WalletSnapshot, operationId: string, amount: number, description: string, now: number) {
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(operationId) || !Number.isSafeInteger(amount) || amount <= 0 ||
      !description.trim() || description.length > 200 || !Number.isSafeInteger(now) || now < 0) throw Error('支出参数无效');
  const wallet = snapshot.state, id = `spend:${operationId}`;
  const previous = snapshot.transactions.find(entry => entry.id === id);
  if (previous) {
    if (previous.amount !== -amount || previous.description !== description) throw Error('支出 ID 内容冲突');
    return { balance: wallet.balance, created: false };
  }
  if (wallet.balance < amount) throw Error('猫爪币余额不足');
  wallet.balance -= amount; wallet.totalSpent += amount;
  if (!Number.isSafeInteger(wallet.totalSpent)) throw Error('钱包累计超出可保存范围');
  tx.objectStore('wallet').put(wallet, 'only');
  tx.objectStore('walletTransactions').add({ id, kind: 'spend', sourceId: operationId, amount: -amount, description, createdAt: now } satisfies WalletTransaction);
  return { balance: wallet.balance, created: true };
}
export async function spendCoins(db: IDBDatabase, operationId: string, amount: number, description: string, now = Date.now()) {
  if (operationId.startsWith('purchase_')) throw Error('商品购买请使用购买接口');
  return transact(db, ['wallet', 'walletTransactions', 'coinReceipts'], 'readwrite', async tx => spendCoinsIn(tx, await walletSnapshotIn(tx), operationId, amount, description, now));
}
async function commerceIn(tx: IDBTransaction) {
  const value = await request(tx.objectStore('settings').get(COMMERCE_KEY));
  return value === undefined ? defaultCommerce() : validateCommerce(value);
}
export async function getCommerceState(db: IDBDatabase): Promise<CommerceState> {
  return transact(db, ['settings'], 'readonly', commerceIn);
}
export async function purchaseProduct(db: IDBDatabase, productId: string, now = Date.now()) {
  const product = getProduct(productId);
  if (!product) throw Error('商品不存在');
  return transact(db, ['settings', 'wallet', 'walletTransactions', 'coinReceipts'], 'readwrite', async tx => {
    const shop = await commerceIn(tx), snapshot = await walletSnapshotIn(tx), settings = tx.objectStore('settings');
    const saved = await request(settings.get(CAT_HOUSE_KEY));
    const house = saved === undefined ? null : validateCatHouseState(saved);
    validateCommerceLinks(shop, house, snapshot);
    const owned = product.kind === 'cat' ? house?.ownedCatIds.includes(product.catId) : shop.inventory.ownedFurnitureIds.includes(product.id);
    if (owned) return { created: false, balance: snapshot.state.balance };
    if (!house?.companionCatId) throw Error('请先完成首次免费领养');

    const operationId = `purchase_${product.id}`;
    const payment = await spendCoinsIn(tx, snapshot, operationId, product.price, `购买${productName(product)}`, now);
    if (!payment.created) throw Error('购买流水与所有权不一致，请检查备份');
    if (product.kind === 'cat') {
      house.ownedCatIds.push(product.catId); if(house.residentCatIds.length<3)house.residentCatIds.push(product.catId);
      settings.put(validateCatHouseState(house), CAT_HOUSE_KEY);
    } else {
      shop.inventory.ownedFurnitureIds.push(product.id);
      shop.inventory.equipped[product.zone] = product.id; // One item per zone, never stack placements.
    }
    shop.purchases.push({ productId: product.id, price: product.price, transactionId: `spend:${operationId}`, purchasedAt: now });
    settings.put(validateCommerce(shop), COMMERCE_KEY);
    return { created: true, balance: payment.balance };
  });
}
export async function equipFurniture(db: IDBDatabase, id: string) {
  return transact(db, ['settings'], 'readwrite', async tx => {
    const shop = await commerceIn(tx), product = getProduct(id);
    if (product?.kind !== 'furniture' || !shop.inventory.ownedFurnitureIds.includes(id)) throw Error('只能装备已拥有的家具');
    shop.inventory.equipped[product.zone] = id;
    tx.objectStore('settings').put(validateCommerce(shop), COMMERCE_KEY);
    return shop;
  });
}
export async function setCompanionCat(db: IDBDatabase, id: string) {
  return transact(db, ['settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings'), saved = await request(settings.get(CAT_HOUSE_KEY));
    if (!saved) throw Error('请先领养猫咪');
    const house = validateCatHouseState(saved);
    if (!house.ownedCatIds.includes(id)) throw Error('只能选择已拥有的猫咪');
    house.companionCatId = id; settings.put(validateCatHouseState(house), CAT_HOUSE_KEY); return house;
  });
}

export async function exportBackup(db: IDBDatabase) {
  return transact(db, ['categories', 'records', 'settings', 'wallet', 'walletTransactions', 'coinReceipts', 'focusTasks'], 'readonly', async tx => {
    const categories = sortCategories(await request<FocusCategory[]>(tx.objectStore('categories').getAll()));
    const records = await request<FocusRecord[]>(tx.objectStore('records').getAll());
    const value = await request(tx.objectStore('settings').get(CAT_HOUSE_KEY));
    const catHouse = value === undefined ? undefined : validateCatHouseState(value);
    const wallet = await walletSnapshotIn(tx);
    const commerce = await commerceIn(tx);
    validateCommerceLinks(commerce, catHouse, wallet);
    const checkins = await checkinHistoryIn(tx, wallet);
    const { experience, level } = progress(records);
    const tasks = validateFocusTasks(await request(tx.objectStore('focusTasks').getAll()));
    const savedSelection = await request(tx.objectStore('settings').get(SELECTED_FOCUS_TASK_KEY));
    const catNames = validateCatNames(await request(tx.objectStore('settings').get(CAT_NAMES_KEY)));
    const selectedTaskId = tasks.find(task => task.id === savedSelection && task.status === 'pending')?.id ?? null;
    const expansion=validateExpansion(await request(tx.objectStore('settings').get(EXPANSION_KEY)),catHouse?.ownedCatIds ?? []);
    return JSON.stringify({ format: 'cat-focus-pwa', version: 9, expansion, tasks, selectedTaskId, catNames, versions: { database: DB_VERSION, wallet: 1, commerce: 1, growth: 'focus-minutes-v1' }, growth: { experience, level }, commerce, checkins, wallet, exportedAt: new Date().toISOString(), categories, records, ...(catHouse ? { catHouse } : {}) }, null, 2);
  });
}
export async function importBackup(db: IDBDatabase, raw: string, preview = false, requireIdle = false) {
  const incoming = parseBackup(raw); // Validate all records before the first write.
  return transact(db, ['records', 'categories', 'settings', 'wallet', 'walletTransactions', 'coinReceipts', 'active', 'focusTasks'], 'readwrite', async tx => {
    const beforeHouse = await request(tx.objectStore('settings').get(CAT_HOUSE_KEY));
    if ((preview || requireIdle) && await request(tx.objectStore('active').get(ACTIVE_KEY))) throw Error('请先结束当前专注，再导入备份');
    if (incoming.wallet) {
      const local = await walletSnapshotIn(tx);
      await checkinHistoryIn(tx, local);
      const restored = validateWalletSnapshot(incoming.wallet);
      // First launch awards a daily bonus before a user can import. Preserve those
      // unspent daily dates, deduplicating by transaction ID rather than adding twice.
      const ids = new Set(restored.transactions.map(entry => entry.id));
      for (const entry of local.transactions.filter(entry => entry.kind === 'daily_checkin')) {
        if (ids.has(entry.id)) continue;
        restored.transactions.push(entry); ids.add(entry.id);
        restored.state.balance += entry.amount; restored.state.totalIncome += entry.amount;
      }
      validateWalletSnapshot(restored);
      if (walletSignature(local) !== walletSignature(restored)) {
        if (local.receipts.length || local.transactions.some(entry => entry.kind !== 'daily_checkin') || local.state.totalSpent || local.state.remainderMs) throw Error('钱包与本机冲突，未导入任何数据');
        if (await request(tx.objectStore('active').get(ACTIVE_KEY))) throw Error('请先结束当前专注，再恢复钱包备份');
        tx.objectStore('wallet').put(restored.state, 'only');
        tx.objectStore('walletTransactions').clear();
        for (const entry of restored.transactions) tx.objectStore('walletTransactions').add(entry);
        for (const receipt of restored.receipts) tx.objectStore('coinReceipts').add(receipt);
      }
      tx.objectStore('settings').put(checkinsFromTransactions(restored.transactions), DAILY_CHECKINS_KEY);
    }
    if (incoming.commerce) {
      const local = await commerceIn(tx);
      if (commerceSignature(local) !== commerceSignature(incoming.commerce) && commerceSignature(local) !== commerceSignature(defaultCommerce())) throw Error('商城数据与本机冲突，未导入任何数据');
      tx.objectStore('settings').put(incoming.commerce, COMMERCE_KEY);
    }
    // Adopt/restore once. Conflicting saved houses reject the entire transaction.
    if (incoming.catHouse && hasAdoptedCat(incoming.catHouse)) {
      const settings = tx.objectStore('settings');
      const value = await request(settings.get(CAT_HOUSE_KEY));
      const localHouse = value === undefined ? null : validateCatHouseState(value);
      if (hasAdoptedCat(localHouse) && catHouseSignature(localHouse!) !== catHouseSignature(incoming.catHouse)) {
        throw Error('备份中的领养状态与本机冲突，未导入任何数据');
      }
      if (!hasAdoptedCat(localHouse)) settings.put(incoming.catHouse, CAT_HOUSE_KEY);
    }
    const mergedHouseValue=await request(tx.objectStore('settings').get(CAT_HOUSE_KEY));
    const mergedHouse=mergedHouseValue===undefined?null:validateCatHouseState(mergedHouseValue);
    const localExpansion=validateExpansion(await request(tx.objectStore('settings').get(EXPANSION_KEY)));
    const restoredExpansion=incoming.expansion ?? expansionState(beforeHouse===undefined && !!incoming.catHouse?.companionCatId);
    tx.objectStore('settings').put(validateExpansion(mergeExpansion(localExpansion,restoredExpansion),mergedHouse?.ownedCatIds ?? []),EXPANSION_KEY);
    if (incoming.catNames) {
      const settings = tx.objectStore('settings');
      const localNames = validateCatNames(await request(settings.get(CAT_NAMES_KEY)));
      settings.put({ ...incoming.catNames, ...localNames }, CAT_NAMES_KEY);
    }
    if (incoming.tasks) {
      const store = tx.objectStore('focusTasks');
      for (const task of incoming.tasks) {
        const existing = await request(store.get(task.id));
        if (existing && taskSignature(existing) !== taskSignature(task)) throw Error('任务 ID 内容冲突，未导入任何数据');
        if (!existing) store.add(task);
      }
    }
    // Merge selection like other local preferences: a valid local choice wins.
    // Older backups have no selection and must not erase local task state.
    const taskSettings = tx.objectStore('settings');
    const savedSelection = await request(taskSettings.get(SELECTED_FOCUS_TASK_KEY));
    const mergedTasks = validateFocusTasks(await request(tx.objectStore('focusTasks').getAll()));
    const selectedTaskId = mergedTasks.find(task => task.id === savedSelection && task.status === 'pending')?.id
      ?? mergedTasks.find(task => task.id === incoming.selectedTaskId && task.status === 'pending')?.id;
    if (selectedTaskId) taskSettings.put(selectedTaskId, SELECTED_FOCUS_TASK_KEY);
    else taskSettings.delete(SELECTED_FOCUS_TASK_KEY);
    const categoryStore = tx.objectStore('categories');
    const local = sortCategories(await request<FocusCategory[]>(categoryStore.getAll()));
    const idMap = new Map<string, string>();
    let order = Math.max(-1, ...local.map(item => item.order)) + 1;
    for (const category of sortCategories(incoming.categories)) {
      const sameId = local.find(item => item.id === category.id);
      if (sameId && sameId.name !== category.name) throw Error('类别 ID 与本机名称冲突，未导入任何数据');
      const existing = sameId || local.find(item => categoryKey(item.name) === categoryKey(category.name));
      if (existing) idMap.set(category.id, existing.id);
      else {
        const imported = { ...category, order: order++ };
        categoryStore.add(imported);
        local.push(imported);
        idMap.set(category.id, category.id);
      }
    }
    const store = tx.objectStore('records');
    let added = 0;
    for (const original of incoming.records) {
      const record = { ...original, categoryId: idMap.get(original.categoryId)! };
      const existing = await request<FocusRecord | undefined>(store.get(record.id));
      if (existing) {
        if (!isRecord(existing) || recordSignature(existing) !== recordSignature(record)) {
          throw Error(`记录 ${record.id} 的内容与本机冲突，未导入任何数据`);
        }
      } else { store.add(record); added++; }
    }
    const result = { added, skipped: incoming.records.length - added };
    if (preview) throw new BackupPreview(result);
    return result;
  });
}

// Stable display positions are local presentation settings, not reward-bearing backup data.
export async function getRoomLocations(db: IDBDatabase): Promise<RoomLocations> {
  return transact(db, ['settings'], 'readonly', async tx => {
    const value = await request(tx.objectStore('settings').get('roomLocations'));
    if (value === undefined) return {};
    try { return validateRoomLocations(value); } catch { return {}; }
  });
}
export async function saveRoomLocations(db: IDBDatabase, value: RoomLocations) {
  const locations = validateRoomLocations(value);
  return transact(db, ['settings'], 'readwrite', async tx => {
    const settings = tx.objectStore('settings'), raw = await request(settings.get(CAT_HOUSE_KEY));
    const house = raw ? validateCatHouseState(raw) : null;
    if (Object.keys(locations).some(id => !house?.residentCatIds.includes(id))) throw Error('只能保存已入住猫咪的位置');
    settings.put(locations, 'roomLocations');
  });
}


// Explicit development-only credit. A fixed operation ID makes this request idempotent.
export async function grantDevelopmentCoins(db: IDBDatabase, now = Date.now()) {
  if (!import.meta.env.DEV) throw Error('测试入账仅限开发环境');
  return transact(db, ['wallet', 'walletTransactions', 'coinReceipts'], 'readwrite', async tx => {
    const snapshot = await walletSnapshotIn(tx), sourceId = 'manual_test_1000_2026_10_21', id = `test_grant:${sourceId}`;
    if (snapshot.transactions.some(entry => entry.id === id)) return { created: false, balance: snapshot.state.balance };
    const entry: WalletTransaction = { id, kind: 'test_grant', sourceId, amount: 1000, description: '开发测试资金：1000 猫爪币', createdAt: now };
    snapshot.state.balance += entry.amount; snapshot.state.totalIncome += entry.amount;
    snapshot.transactions.push(entry); validateWalletSnapshot(snapshot);
    tx.objectStore('wallet').put(snapshot.state, 'only'); tx.objectStore('walletTransactions').add(entry);
    return { created: true, balance: snapshot.state.balance };
  });
}

class BackupPreview extends Error {
  constructor(public result: { added: number; skipped: number }) { super('preview'); }
}
export async function previewBackup(db: IDBDatabase, raw: string) {
  try { await importBackup(db, raw, true); } catch (error) {
    if (error instanceof BackupPreview) return error.result;
    throw error;
  }
  throw Error('无法预览备份');
}
