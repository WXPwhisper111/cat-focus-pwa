import './app-update.css';
import { createAppUpdate } from './app-update';
import { createAppUpdateView } from './app-update-view';
import './pwa-install.css';
import { createInstallController } from './pwa-install';
import { createInstallView } from './pwa-install-view';
import './startup.css';
import { createStartup } from './startup';
import { applyCatNames, catDisplayName } from './cat-names';
import { getCatNames, renameCat } from './storage';
import { openCatRename } from './cat-rename';
import { openCompanionPicker } from './companion-picker';
import { icon } from './category-icons';
import './focus-tasks.css';
import { createFocusTaskList } from './focus-task-list';
import { completeSummaryTask, getFocusTaskState, selectFocusTask } from './focus-task-storage';
import { createFocusGoal } from './focus-goal-card';
import type { FocusTask } from './focus-tasks';
import { createRoomAutonomy } from './room-autonomy';
import { getRoomLocations, saveRoomLocations } from './storage';
import type { RoomLocations } from './room-locations';
import './cat-shop.css';
import { createCatShop } from './cat-shop';
import { defaultCommerce, type CommerceState } from './shop';
import './daily-welcome.css';
import { createDailyWelcome } from './daily-welcome';
import { createDailyCheckinRunner, localDayKey, type DailyCheckinRecord } from './daily-checkin';
import './style.css';
import './category-manager.css';
import './timer.css';
import './focus-ending.css';
import './statistics.css';
import './category-picker.css';
import { createCategoryPicker } from './category-picker';
import './room-scene.css';
import './cat-adoption.css';
import { createCatAdoption } from './cat-adoption';
import { getCatDefinition } from './cat-definition';
import { hasAdoptedCat, type CatHouseState } from './cat-house-state';
import { getCatHouseState, adoptInitialCat, getCommerceState, purchaseProduct, setCompanionCat } from './storage';
import { createRoomScene, type RoomTheme } from './room-scene';
import { roomHotspots } from './room-scene';
import { createRoomInteraction, roomItems, type InteractionItem } from './room-interaction';
import { createRoomBehavior } from './room-behavior';
import { createRoomInteractionPanel } from './room-interaction-panel';
import { createFocusCat } from './focus-cat';
import { dateKey, formatClock, isDue, sessionClock, type ActiveSession, type FocusRecord, type TimerMode } from './domain';
import { acknowledgeCompletion, checkinToday, getWallet, exportBackup, getActive, getPendingCompletions, getRecords, getTimerMode, importBackup, openDatabase, selectTimerMode, settle, startSession, startStopwatch, togglePause } from './storage';
import { downloadBackup, previewImport, mountDataManager } from './data-manager';
import { notifyCompletion, requestOptionalNotification } from './notifications';
import { DEFAULT_CATEGORIES, type FocusCategory } from './categories';
import { getCategoryState, selectCategory } from './storage';
import { createCategoryManager } from './category-manager';
import { createFocusEnding, type EndAction } from './focus-ending';
import { bindStatisticsEvents, statisticsMarkup } from './statistics-view';
import type { StatisticsState } from './statistics';

const app = document.querySelector<HTMLDivElement>('#app')!;
let db: IDBDatabase;
let applicationReady = false;
let initialSummaries: Awaited<ReturnType<typeof getPendingCompletions>> = [];
let session: ActiveSession | undefined;
let records: FocusRecord[] = [];
let coinBalance = 0;
const previewValue = import.meta.env.DEV ? new URLSearchParams(location.search).get('roomPreview') : null;
const roomPreview: RoomTheme | undefined = previewValue === 'day' || previewValue === 'night' ? previewValue : undefined;
let page: 'focus' | 'stats' | 'room' | 'shop' | 'settings' = roomPreview ? 'room' : location.hash === '#settings-update' ? 'settings' : 'focus';
const statisticsState: StatisticsState = { range: 'week', month: dateKey(new Date()).slice(0, 7), selectedBucket: null };
let notice = '';
let catHouse: CatHouseState | null = null;
let catHouseIssue = '';
let commerce: CommerceState = defaultCommerce();
let commerceIssue = '';
let catShop: ReturnType<typeof createCatShop> | undefined;
let notifiedId: string | null = null;
let categories: FocusCategory[] = [];
let selectedCategoryId = DEFAULT_CATEGORIES[0].id;
let focusTasks: FocusTask[] = [];
let selectedFocusTaskId: string | null = null;
let focusGoal: ReturnType<typeof createFocusGoal> | undefined;
let focusTaskList: ReturnType<typeof createFocusTaskList> | undefined;
let categoryPicker: ReturnType<typeof createCategoryPicker> | undefined;
let dailyWelcome: ReturnType<typeof createDailyWelcome> | undefined;
let dailyCheckin: ReturnType<typeof createDailyCheckinRunner> | undefined;
let pendingWelcome: DailyCheckinRecord | undefined;
let pendingCompletionCount = 0;
let draftMinutes = '25';
let draftMode: TimerMode = 'countdown';
let categoryManager: ReturnType<typeof createCategoryManager> | undefined;
let focusEnding: ReturnType<typeof createFocusEnding> | undefined;
let checkingDue = false;
let finishing = false;
let refreshRevision = 0;
const stateChannel = 'BroadcastChannel' in window ? new BroadcastChannel('cat-focus-state') : undefined;
const appUpdate = createAppUpdate({ enabled: import.meta.env.PROD, hasActiveSession: async () => !!(await getActive(db)), canReload: () => applicationReady && !pendingWelcome && !pendingCompletionCount && !document.querySelector('dialog[open]') });
const appUpdateView = createAppUpdateView(appUpdate, () => !!session, {
  canShow: () => applicationReady && !pendingWelcome && !pendingCompletionCount && !document.querySelector('dialog[open]'),
  openSettings: () => { history.replaceState(history.state, '', '#settings-update'); page = 'settings'; render(); },
});

// Capture install opportunities once, before asynchronous database initialization.
const installController = createInstallController();
const installView = createInstallView(installController, () => applicationReady && page === 'focus' && !session && !pendingCompletionCount && !pendingWelcome && !document.hidden && !document.querySelector('dialog[open]'));


let stableLocations: RoomLocations = {};
let locationWrites = Promise.resolve();
let roomAutonomy: ReturnType<typeof createRoomAutonomy> | undefined;
let roomLifecycleCleanup: (() => void) | undefined;
let roomScene: ReturnType<typeof createRoomScene> | undefined;
let roomBehavior: ReturnType<typeof createRoomBehavior> | undefined;
let roomInteraction: ReturnType<typeof createRoomInteraction> | undefined;
let interactionPanel: ReturnType<typeof createRoomInteractionPanel> | undefined;
let unsubscribeInteraction: (() => void) | undefined;
let focusCat: ReturnType<typeof createFocusCat> | undefined;
let adoption: ReturnType<typeof createCatAdoption> | undefined;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const clock = formatClock;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function assignNotice(message: string) {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  notice = message;
  noticeTimer = message ? setTimeout(() => {
    noticeTimer = undefined; notice = '';
    document.querySelector('#close-notice')?.closest('.toast')?.remove();
  }, 4000) : undefined;
}
const setNotice = (message: string) => { assignNotice(message); render(); };

async function refresh() {
  const revision = ++refreshRevision;
  const [active, savedRecords, categoryState, savedMode, pending, house, wallet, shop, locations, taskState, names] = await Promise.all([getActive(db), getRecords(db), getCategoryState(db), getTimerMode(db), getPendingCompletions(db), getCatHouseState(db).then(state => ({ state, error: '' })).catch(error => ({ state: null, error: (error as Error).message })), getWallet(db), getCommerceState(db).then(state => ({ state, error: '' })).catch(error => ({ state: defaultCommerce(), error: (error as Error).message })), getRoomLocations(db), getFocusTaskState(db).then(state => ({ ...state, error: '' })).catch(error => ({ tasks: focusTasks, selectedId: selectedFocusTaskId, error: `无法读取专注清单：${(error as Error).message}` })), getCatNames(db)]);
  if (revision !== refreshRevision) return;
  applyCatNames(names);
  if (!roomScene) stableLocations = locations;
  coinBalance = wallet.state.balance; commerce = shop.state; commerceIssue = shop.error;
  catHouse = house.state; catHouseIssue = house.error;
  session = active;
  records = savedRecords;
  categories = categoryState.categories;
  selectedCategoryId = categoryState.selectedId;
  draftMode = savedMode;
  categoryManager?.update(categories);
  if (taskState.error) assignNotice(taskState.error);
  focusTasks = taskState.tasks; selectedFocusTaskId = taskState.selectedId;
  focusTaskList?.update(focusTasks, { selectedId: selectedFocusTaskId, locked: !!session });
  pendingCompletionCount = pending.length;
  render();
  if (session) dailyWelcome?.hide();
  initialSummaries = pending;
  if (applicationReady) focusEnding?.update(session, pending, Date.now());
  presentWelcome();
}
function presentWelcome() {
  if (!applicationReady || !pendingWelcome || document.hidden) return;
  if (pendingWelcome.date !== localDayKey()) { pendingWelcome = undefined; return; }
  if (session) {
    pendingWelcome = undefined;
    assignNotice('今日已自动签到，+5 猫爪币已存入钱包。安心继续专注吧。'); render(); return;
  }
  if (pendingCompletionCount || document.querySelector('dialog[open]')) return;
  pendingWelcome = undefined;
  dailyWelcome?.show(getCatDefinition(catHouse?.companionCatId));
}
async function returnToForeground() {
  if (document.hidden) return;
  await checkDue(); await dailyCheckin?.check(true); presentWelcome();
}
async function checkDue() {
  if (!db || checkingDue) return;
  checkingDue = true;
  try {
    const result = await settle(db, 'due');
    if (result.created && result.record && notifiedId !== result.record.id) {
      notifiedId = result.record.id;
      assignNotice('');
      void notifyCompletion(result.record.id);
      stateChannel?.postMessage('changed');
    }
    await refresh();
  } finally { checkingDue = false; }
}
async function finishSession(action: EndAction, id: string) {
  if (finishing) return;
  finishing = true;
  try {
    const result = await settle(db, action, Date.now(), id);
    assignNotice(result.created ? '' : result.discarded ? '已放弃，本次时长未保存。' : '本次未新增记录，已刷新当前状态。');
    if (result.created && result.record?.completed && notifiedId !== result.record.id) {
      notifiedId = result.record.id;
      void notifyCompletion(result.record.id);
    }
    await refresh(); stateChannel?.postMessage('changed');
  } finally { finishing = false; }
}
async function requestEnd(action: EndAction, displayed: ActiveSession) {
  if (action === 'discard' || (displayed.mode === 'countdown' && !isDue(displayed, Date.now()))) {
    focusEnding?.confirm(action, displayed, Date.now());
    return;
  }
  try { await finishSession(action, displayed.id); }
  catch (error) { setNotice(`保存未完成：${(error as Error).message}，请重试。`); }
}
function focusMarkup() {
  const companion = getCatDefinition(catHouse?.companionCatId);
  const name = companion ? catDisplayName(companion) : '猫咪';
  const active = !!session;
  const paused = session?.status === 'paused';
  const mode = session?.mode || draftMode;
  const display = session ? sessionClock(session, Date.now()) : mode === 'stopwatch' ? '00:00' : clock(Number(draftMinutes) * 60_000);
  const durationMarkup = mode === 'countdown' ? `<div class="label">专注时长</div><div class="presets">${[15, 25, 45, 60].map(minutes => `<button data-minutes="${minutes}"${String(minutes) === draftMinutes ? ' class="selected"' : ''}>${minutes} 分钟</button>`).join('')}</div><label>自定义分钟数<input id="minutes" type="number" min="1" max="180" step="1" inputmode="numeric" value="${escapeHtml(draftMinutes)}" /></label>` : '<p class="hint">从零开始，不设目标时长；完成后请点击“结束并保存”。</p>';
  return `<section class="hero"><div class="eyebrow">今天也和${escapeHtml(name)}一起</div><h1>专注一会儿吧</h1><p>一点一点，积累自己的节奏。</p></section>
  <section class="cat-card">${getCatDefinition(catHouse?.companionCatId) ? `<div id="focus-cat-slot"></div><span class="cat-caption">${escapeHtml(name)}${paused ? '在等你回来' : active ? '正陪你专注' : '准备好啦'}</span>` : '<div class="focus-cat-empty"><strong>这里还空空的</strong><p>去猫咪小屋领养一位小伙伴，让它陪你专注吧。</p><button type="button" data-page="room">去领养猫咪</button></div>'}${catHouse?.ownedCatIds.length ? '<button type="button" class="focus-companion-change" id="focus-companion">更换猫咪</button>' : ''}</section>
  <div id="focus-goal-slot"></div><section class="timer-card">${!active ? `<div class="timer-modes" role="group" aria-label="计时模式"><button type="button" data-mode="countdown" aria-pressed="${mode === 'countdown'}">倒计时</button><button type="button" data-mode="stopwatch" aria-pressed="${mode === 'stopwatch'}">正计时</button></div>` : `<div class="timer-mode-label">${mode === 'stopwatch' ? '正计时' : '倒计时'}</div>`}<span class="eyebrow">${active ? paused ? '已暂停' : '专注进行中' : '准备开始'}</span><div class="clock${display.length >= 8 ? ' long-clock' : ''}" id="clock">${display}</div>
  <div class="time-note">${active ? `${escapeHtml(session!.category)} · ${mode === 'stopwatch' ? '自由专注，手动结束' : `目标 ${session!.targetMinutes} 分钟`}` : mode === 'stopwatch' ? '不预设时长，按自己的节奏专注' : '选一个小目标，开始专注'}</div>
  ${active ? `<div class="actions"><button class="primary" id="pause">${paused ? '继续专注' : '暂停'}</button><button id="early">${mode === 'stopwatch' ? '结束并保存' : '提前结束并保存'}</button><button class="danger" id="discard">放弃且不保存</button></div>` : `<div class="form"><div class="category-heading"><label for="category">专注类别</label><button id="manage-categories" type="button">管理</button></div><select id="category">${categories.filter(item => !item.archived).map(item => `<option value="${escapeHtml(item.id)}"${item.id === selectedCategoryId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>${durationMarkup}<button class="primary wide" id="start">开始专注</button></div>`}</section>
  <div data-install-reminder-slot></div><div id="focus-list-slot"></div><p class="hint">${mode === 'stopwatch' ? '正计时不会自动结束。结束并保存会' : '提前结束会'}保存已专注时长并计入统计、奖励；放弃会删除本次时长。</p>`;
}
function statMarkup() {
  return statisticsMarkup(records, categories, statisticsState, new Date(), getCatDefinition(catHouse?.companionCatId) ?? null, coinBalance);
}
function houseMarkup() {
  if (catHouseIssue) return `<section class="hero"><h1>猫咪小屋</h1><p class="cat-house-error">暂时无法读取领养状态：${escapeHtml(catHouseIssue)}。现有记录仍保留，请重试。</p><button id="retry-cat-house">重新读取</button></section>`;
  if (!hasAdoptedCat(catHouse)) return '<div id="adoption-slot"></div>';
  return `<section class="hero"><div class="eyebrow">猫咪的日常</div><h1>猫咪小屋</h1><p>一个安静的小角落。</p>${roomPreview ? `<p class="room-preview-note">开发预览 · ${roomPreview === 'day' ? '白天' : '夜间'}</p>` : ''}</section><section class="room-card"><div id="room-slot" class="room-slot"></div></section><div id="interaction-slot"></div><div class="house-actions"><p>已入住 ${catHouse!.residentCatIds.length} / 3</p><button type="button" data-page="shop">猫咪商城</button></div><div class="house-companions" aria-label="选择行动猫">${catHouse!.residentCatIds.map(id => { const cat = getCatDefinition(id)!, selected = roomInteraction?.snapshot().selectedCatId === id; return `<div class="house-cat-card"><button type="button" data-action-cat="${id}" aria-pressed="${selected}" class="${selected ? 'is-selected' : ''}"><img src="${cat.preview}" alt=""/>${escapeHtml(catDisplayName(cat))}<small>选择行动猫</small></button><button type="button" class="cat-rename-button" data-rename-cat="${id}" aria-label="修改${escapeHtml(catDisplayName(cat))}的名称">改名</button></div>`; }).join('')}</div>`;
}
function settingsMarkup() {
  return `<section class="hero"><div class="eyebrow">安心专注</div><h1>设置与备份</h1><p>数据保存在这台设备的浏览器中。</p></section>
  <div class="settings-stack"><div data-install-card-slot></div><div data-update-card-slot></div><section class="panel settings-notifications"><div class="eyebrow">提醒与权限</div><h2>完成提示</h2><p>应用打开或返回前台时，会显示页面内完成提示。</p><p class="hint">系统通知的横幅、声音与锁屏显示取决于手机设置；当前不保证后台或锁屏准时提醒。</p><div class="settings-actions"><button id="notify">${'Notification' in window ? `启用系统通知（当前：${Notification.permission === 'granted' ? '已允许' : Notification.permission === 'denied' ? '已拒绝' : '未设置'}）` : '当前浏览器不支持系统通知'}</button><button id="test-notify">发送测试通知</button></div><p class="hint">拒绝通知权限不会影响计时或记录。</p></section>
    <section class="panel settings-data"><div class="eyebrow">本机数据</div><h2>数据管理 · 手动备份</h2><div id="data-manager"></div><p>浏览器数据可能被用户或系统清除，请定期导出 JSON 备份。</p><div class="actions" id="backup-actions"><button id="export">导出 JSON</button><label class="file-button">导入 JSON<input id="import" type="file" accept="application/json,.json" hidden /></label></div><details class="settings-details"><summary>备份与恢复说明</summary><p class="hint">仅支持本 PWA 的备份，不读取桌面版数据。导入会合并记录和任务，保留本机有效任务选择；未选择时恢复备份目标。旧备份不会清空清单，任务内容冲突时整批不导入。保留本机其他设置；尚未领养时可恢复备份中的猫咪。备份含钱包、签到历史、购买记录和入住状态。有活动专注时请先结束；恢复时按日期去重签到奖励，钱包、商城、领养状态或记录冲突时整批不导入。</p></details></section>
  </div>`;
}

function render() {
  if (!applicationReady || !app.isConnected) return;
  focusTaskList?.element.remove(); focusGoal?.element.remove();
  if (page !== 'focus') focusTaskList?.close();
  categoryPicker?.destroy(); categoryPicker = undefined;
  // Preserve the independent player across form/state renders; dispose on navigation.
  const companion = getCatDefinition(catHouse?.companionCatId);
  const residents = (catHouse?.residentCatIds || []).map(id => getCatDefinition(id)!);
  const residentKey = residents.map(cat => cat.id).join('|');
  if (page === 'shop') catShop?.element.remove(); else { catShop?.destroy(); catShop = undefined; }
  const showRoom = page === 'room' && hasAdoptedCat(catHouse) && !catHouseIssue;
  if (roomScene && (roomScene.residentKey !== residentKey || !showRoom)) {
    roomAutonomy?.destroy(); roomAutonomy = undefined; roomLifecycleCleanup?.(); roomLifecycleCleanup = undefined;
    roomInteraction?.setExecutor(undefined); roomBehavior?.destroy(); roomBehavior = undefined;
    roomScene.destroy(); roomScene = undefined;
  }
  if (focusCat && focusCat.catId !== companion?.id) { focusCat.destroy(); focusCat = undefined; }
  if (!showRoom && roomInteraction) {
    unsubscribeInteraction?.(); unsubscribeInteraction = undefined;
    interactionPanel?.destroy(); interactionPanel = undefined;
    roomInteraction.destroy(); roomInteraction = undefined;
  }
  if (showRoom) { roomScene?.element.remove(); interactionPanel?.element.remove(); }
  else { roomScene?.destroy(); roomScene = undefined; }
  if (page === 'room' && !hasAdoptedCat(catHouse) && !catHouseIssue) adoption?.element.remove();
  else { adoption?.destroy(); adoption = undefined; }
  if (page === 'focus') focusCat?.element.remove();
  else { focusCat?.destroy(); focusCat = undefined; }
  app.innerHTML = `<main>${notice ? `<div class="toast" role="status">${escapeHtml(notice)}<button id="close-notice" aria-label="关闭提示">×</button></div>` : ''}<div data-update-banner-slot></div>${page === 'focus' ? focusMarkup() : page === 'stats' ? statMarkup() : page === 'room' ? houseMarkup() : page === 'shop' ? '<div id="shop-slot"></div>' : settingsMarkup()}</main><nav><button data-page="focus" class="${page === 'focus' ? 'active' : ''}">${icon('focus-timer')}<span>专注</span></button><button data-page="stats" class="${page === 'stats' ? 'active' : ''}">${icon('bars')}<span>统计</span></button><button data-page="room" class="${page === 'room' || page === 'shop' ? 'active' : ''}">${icon('cat-house')}<span>猫咪小屋</span></button><button data-page="settings" class="${page === 'settings' ? 'active' : ''}">${icon('settings-gear')}<span>设置</span></button></nav>`;
  installView.mount(); appUpdateView.mount();
  if (page === 'focus' && focusGoal) {
    document.querySelector('#focus-goal-slot')!.append(focusGoal.element);
    const selected = focusTasks.find(task => task.id === selectedFocusTaskId && task.status === 'pending');
    const context = session ? session.taskContext : pendingCompletionCount ? undefined : selected ? { taskId: selected.id, titleSnapshot: selected.title } : undefined;
    focusGoal.update(context, session ? session.status === 'paused' ? '已暂停' : '正在专注' : '待开始', !!session);
  }
  if (page === 'focus') { const slot = document.querySelector('#focus-list-slot'); if (slot && focusTaskList) slot.append(focusTaskList.element); }
  if (page === 'focus' && companion) {
    const animation = session?.status === 'paused' ? 'sleep_loop' : 'idle';
    focusCat ??= createFocusCat(animation, companion);
    document.querySelector('#focus-cat-slot')!.append(focusCat.element);
    focusCat.refreshName();
    void focusCat.updateState(animation);
  } else if (showRoom) {
    if (!roomInteraction) {
      roomInteraction = createRoomInteraction(residents.map(cat => cat.id), undefined, catHouse?.companionCatId || '');
      interactionPanel = createRoomInteractionPanel(roomInteraction);
      unsubscribeInteraction = roomInteraction.subscribe(state => { roomScene?.setSelected(state.selectedCatId); document.querySelectorAll<HTMLButtonElement>('[data-action-cat]').forEach(button => { const selected = button.dataset.actionCat === state.selectedCatId; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); }); roomAutonomy?.changed(); });
    } else roomInteraction.reconcile(residents.map(cat => cat.id));
    roomScene ??= createRoomScene('idle', {
      theme: roomPreview || 'auto', cat: residents[0], cats: residents, homeOrder: catHouse?.residentCatIds,
      hotspots: roomHotspots.filter(hotspot => hotspot.itemId !== 'curtains'),
      onCatAction: id => { roomAutonomy?.userInteraction(); void roomInteraction?.request('pet', id, null).catch(error => setNotice((error as Error).message)); },
      onItemAction: id => { roomAutonomy?.userInteraction(); roomInteraction?.selectItem(id as InteractionItem); void roomInteraction?.request(roomItems[id as InteractionItem].action).catch(error => setNotice((error as Error).message)); },
      onTargetAmbiguity: targets => { roomAutonomy?.userInteraction(); roomInteraction?.disambiguate(targets); },
    });
    if (!roomBehavior) {
      const scene = roomScene;
      const runner = createRoomBehavior(scene.behaviorPort, {
        initialLocations: stableLocations,
        equipped: item => {
          const zone = item === 'bed' ? 'sleep' : item === 'scratcher' ? 'play' : item === 'rug' ? 'activity' : 'food';
          const product = item === 'bed' ? 'basic-bed' : item === 'scratcher' ? 'basic-scratcher' : item === 'rug' ? 'basic-rug' : 'basic-tableware';
          return commerce.inventory.equipped[zone] === product && commerce.inventory.ownedFurnitureIds.includes(product);
        },
        onLocations: locations => {
          stableLocations = locations;
          locationWrites = locationWrites.then(() => saveRoomLocations(db, locations)).catch(error => { setNotice(`小屋位置保存失败：${(error as Error).message}`); });
        },
        onSettled: (id, action) => roomAutonomy?.settled(id, action),
      });
      roomBehavior = runner;
      roomInteraction.setExecutor(runner.executor);
      const scheduler = createRoomAutonomy({
        ids: scene.behaviorPort.ids, activeCount: runner.activeCount, busy: runner.busy,
        protectedCat: () => roomInteraction?.snapshot().open ? roomInteraction.snapshot().selectedCatId : null,
        available: runner.available, atFurniture: runner.atFurniture, vacate: runner.vacate,
        execute: (catId, behavior, signal) => runner.execute({ catId, behavior, source: 'autonomous' }, signal),
      });
      roomAutonomy = scheduler;
      let pageActive = true, revision = 0;
      const updateVisibility = () => {
        const token = ++revision, active = pageActive && !document.hidden;
        scheduler.setActive(false);
        void runner.setSuspended(!active).then(() => { if (token === revision && active) scheduler.setActive(true); });
      };
      const hide = () => { pageActive = false; updateVisibility(); };
      const show = () => { pageActive = true; updateVisibility(); };
      document.addEventListener('visibilitychange', updateVisibility);
      window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
      roomLifecycleCleanup = () => { ++revision; document.removeEventListener('visibilitychange', updateVisibility); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
      updateVisibility();
    }
    const interaction = roomInteraction.snapshot();
    roomScene.setSelected(interaction.selectedCatId);
    document.querySelector('#interaction-slot')!.append(interactionPanel!.element);
    document.querySelector('#room-slot')!.append(roomScene.element);
    roomScene.refreshNames(); interactionPanel?.refreshNames();
    void roomScene.refreshEnvironment();
  } else if (page === 'room' && !catHouseIssue && !hasAdoptedCat(catHouse)) {
    adoption ??= createCatAdoption(async id => {
      try {
        await adoptInitialCat(db, id);
        assignNotice(''); await refresh(); stateChannel?.postMessage('changed');
      } catch (error) {
        assignNotice((error as Error).message); await refresh(); throw error;
      }
    });
    document.querySelector('#adoption-slot')!.append(adoption.element);
  }
  if (page === 'shop') {
    const host = document.querySelector('#shop-slot')!;
    if (commerceIssue || catHouseIssue) host.textContent = `暂时无法读取商城：${commerceIssue || catHouseIssue}`;
    else {
      catShop ??= createCatShop({ balance: coinBalance, house: catHouse, commerce }, {
        back: () => { page = 'room'; render(); },
        buy: async id => { const result = await purchaseProduct(db, id); assignNotice(result.created ? '购买成功，猫咪已自动入住。' : '已经拥有这只猫咪，无需重复购买。'); await refresh(); stateChannel?.postMessage('changed'); },
        companion: async id => { await setCompanionCat(db, id); await refresh(); stateChannel?.postMessage('changed'); },
      });
      catShop.update({ balance: coinBalance, house: catHouse, commerce }); host.append(catShop.element);
    }
  }
  document.querySelectorAll<HTMLButtonElement>('[data-rename-cat]').forEach(button => button.onclick = () => {
    const cat = getCatDefinition(button.dataset.renameCat)!;
    roomAutonomy?.userInteraction();
    openCatRename(cat, async name => { await renameCat(db, cat.id, name); await refresh(); stateChannel?.postMessage('changed'); });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-action-cat]').forEach(button => button.onclick = () => {
    roomAutonomy?.userInteraction(); roomInteraction?.selectCat(button.dataset.actionCat!);
  });
  document.querySelector<HTMLButtonElement>('#focus-companion')?.addEventListener('click', () => {
    openCompanionPicker(catHouse?.ownedCatIds || [], catHouse?.companionCatId || null, async id => {
      await setCompanionCat(db, id); await refresh(); stateChannel?.postMessage('changed');
    });
  });
  document.querySelector<HTMLButtonElement>('#retry-cat-house')?.addEventListener('click', () => void refresh());
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.onclick = () => { page = button.dataset.page as typeof page; if (location.hash === '#settings-update') history.replaceState(history.state, '', location.pathname + location.search); render(); });
  if (page === 'stats') bindStatisticsEvents(app, statisticsState, render);
  document.querySelector<HTMLButtonElement>('#close-notice')?.addEventListener('click', () => { assignNotice(''); render(); });
  document.querySelector<HTMLButtonElement>('#manage-categories')?.addEventListener('click', () => categoryManager?.open());
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = async () => {
    try { await selectTimerMode(db, button.dataset.mode as TimerMode); await refresh(); stateChannel?.postMessage('changed'); }
    catch (error) { setNotice((error as Error).message); }
  });
  document.querySelector<HTMLSelectElement>('#category')?.addEventListener('change', async event => {
    const id = (event.target as HTMLSelectElement).value;
    try { await selectCategory(db, id); selectedCategoryId = id; stateChannel?.postMessage('changed'); }
    catch (error) { assignNotice((error as Error).message); await refresh(); }
  });
  const categorySelect = document.querySelector<HTMLSelectElement>('#category');
  if (categorySelect) categoryPicker = createCategoryPicker(categorySelect);
  document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach(button => button.onclick = () => {
    const input = document.querySelector<HTMLInputElement>('#minutes')!; draftMinutes = button.dataset.minutes!; input.value = draftMinutes;
    updateClock(clock(Number(draftMinutes) * 60_000));
    document.querySelectorAll('[data-minutes]').forEach(item => item.classList.remove('selected')); button.classList.add('selected');
  });
  document.querySelector<HTMLInputElement>('#minutes')?.addEventListener('input', event => {
    draftMinutes = (event.target as HTMLInputElement).value;
    document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach(item => item.classList.toggle('selected', item.dataset.minutes === draftMinutes));
    updateClock(clock(Number(draftMinutes) * 60_000));
  });
  document.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', async () => {
    try {
      const categoryId = document.querySelector<HTMLSelectElement>('#category')!.value;
      if (draftMode === 'stopwatch') await startStopwatch(db, categoryId);
      else await startSession(db, categoryId, Number(draftMinutes));
      assignNotice(''); await refresh(); stateChannel?.postMessage('changed');
    }
    catch (error) { assignNotice((error as Error).message); await refresh(); }
  });
  const displayedSession = session;
  const displayedSessionId = displayedSession?.id;
  document.querySelector<HTMLButtonElement>('#pause')?.addEventListener('click', async () => {
    await togglePause(db, Date.now(), displayedSessionId);
    await refresh();
    if (session && isDue(session, Date.now())) await checkDue();
    stateChannel?.postMessage('changed');
  });
  document.querySelector<HTMLButtonElement>('#early')?.addEventListener('click', () => { if (displayedSession) void requestEnd('early', displayedSession); });
  document.querySelector<HTMLButtonElement>('#discard')?.addEventListener('click', () => { if (displayedSession) void requestEnd('discard', displayedSession); });
  if (page === 'settings') void mountDataManager(db, setNotice);
  document.querySelector('#test-notify')?.addEventListener('click', async () => {
    const result = await notifyCompletion(`test-${Date.now()}`);
    setNotice(result === 'sent' ? '通知已提交给系统；横幅、声音与锁屏显示取决于系统设置。' : `通知未发送：${result === 'denied' ? '请允许通知权限' : result === 'unsupported' ? '当前环境没有可用的通知方式' : '系统调用失败，请重试'}`);
  });
  document.querySelector('#diagnostics')?.addEventListener('click', async () => {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await navigator.clipboard.writeText(JSON.stringify({ version: document.querySelector('script[type="module"][src]')?.getAttribute('src'), online: navigator.onLine, standalone: matchMedia('(display-mode: standalone)').matches, notification: 'Notification' in window ? Notification.permission : 'unsupported', worker: registration?.active?.state ?? 'none', cacheNames: await caches.keys() }, null, 2));
      setNotice('诊断信息已复制，不包含任务和专注记录。');
    } catch { setNotice('无法复制诊断信息，请检查浏览器权限。'); }
  });
  document.querySelector<HTMLButtonElement>('#notify')?.addEventListener('click', async () => {
    const permission = await requestOptionalNotification(); setNotice(permission === 'granted' ? '系统通知已允许。' : permission === 'unsupported' ? '当前环境不支持系统通知。' : '系统通知未获允许，计时仍可正常使用。');
  });
  document.querySelector<HTMLButtonElement>('#export')?.addEventListener('click', async () => {
    try { await downloadBackup(db); setNotice('已发起备份下载，请确认文件已保存。'); } catch { setNotice('备份导出失败，请重试。'); }
  });
  document.querySelector<HTMLInputElement>('#import')?.addEventListener('change', async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    await previewImport(db, file, async () => { await refresh(); stateChannel?.postMessage('changed'); }, setNotice);
  });
}

function updateClock(text: string) {
  const clockElement = document.querySelector('#clock');
  if (clockElement) { clockElement.textContent = text; clockElement.classList.toggle('long-clock', text.length >= 8); }
}

function tick() {
  if (!document.hidden) void dailyCheckin?.check();
  focusEnding?.updateSession(session, Date.now());
  if (session && isDue(session, Date.now())) { void checkDue(); return; }
  if (session) updateClock(sessionClock(session, Date.now()));

}

async function initializeApplication() {
 try {
  db = await openDatabase();
  categoryManager = createCategoryManager(db, async message => {
    assignNotice(message);
    await refresh();
    stateChannel?.postMessage('changed');
  });
  focusEnding = createFocusEnding(finishSession, async id => {
    const acknowledged = initialSummaries.find(summary => summary.record.id === id)?.record;
    await acknowledgeCompletion(db, id);
    await refresh(); stateChannel?.postMessage('changed');
    if (acknowledged && acknowledged.durationSeconds > 0) installController.noteFocusSaved();
    installView.mount();
  }, {
    getTask: id => focusTasks.find(task => task.id === id),
    completeTask: async record => { const result = await completeSummaryTask(db, record.id); await refresh(); stateChannel?.postMessage('changed'); return result; },
  });
  dailyWelcome = createDailyWelcome(() => { page = 'focus'; render(); });
  focusTaskList = createFocusTaskList(db, async () => { await refresh(); stateChannel?.postMessage('changed'); }, id => selectFocusTask(db, id));
  focusGoal = createFocusGoal(() => void focusTaskList?.open(), async () => {
    if (session) return;
    try {
      await selectFocusTask(db, null);
      await refresh(); stateChannel?.postMessage('changed');
    } catch (error) { setNotice(`清除目标失败：${(error as Error).message}`); }
  });
  dailyCheckin = createDailyCheckinRunner({
    claim: now => checkinToday(db, now),
    onChecked: async () => { try { await refresh(); } catch { setNotice('签到状态已保存，页面刷新失败，请重新打开应用。'); } },
    onSuccess: record => {
      if (notice.startsWith('今日签到暂未完成：')) { assignNotice(''); render(); }
      pendingWelcome = record; stateChannel?.postMessage('changed'); presentWelcome();
    },
    onError: error => setNotice(`今日签到暂未完成：${(error as Error).message}。返回应用时会自动重试。`),
  });
  await checkDue();
  await dailyCheckin.check(true);
 } catch (error) {
  // A retry reuses the same initialization path, without keeping partial controllers.
  categoryManager?.destroy(); categoryManager = undefined;
  focusEnding?.destroy(); focusEnding = undefined;
  dailyWelcome?.destroy(); dailyWelcome = undefined;
  focusTaskList?.destroy(); focusTaskList = undefined;
  focusGoal?.destroy(); focusGoal = undefined;
  focusCat?.destroy(); focusCat = undefined;
  db?.close();
  throw error;
 }
}

const startup = createStartup(app, initializeApplication, () => {
  applicationReady = true;
  render();
  focusEnding?.update(session, initialSummaries, Date.now());
  presentWelcome();
  if (stateChannel) stateChannel.onmessage = () => void refresh();
  setInterval(tick, 100);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void returnToForeground(); });
  document.addEventListener('close', () => queueMicrotask(presentWelcome), true);
  window.addEventListener('focus', () => void returnToForeground());
  window.addEventListener('pageshow', () => void returnToForeground());
  window.addEventListener('storage', () => void checkDue());
  void appUpdate.start();
});
await startup.start();

navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'FOCUS_NOTIFICATION_OPEN' && applicationReady) { page = 'focus'; render(); }
});
