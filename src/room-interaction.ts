import { catDisplayName } from './cat-names';
import { getCatDefinition } from './cat-definition';

export const roomItems = {
  bed: { name: '猫窝', zone: '睡觉区', action: 'sleep' },
  foodBowl: { name: '食盆', zone: '吃饭区', action: 'eat' },
  waterBowl: { name: '水盆', zone: '吃饭区', action: 'drink' },
  rug: { name: '地毯', zone: '活动区', action: 'rest' },
  scratcher: { name: '猫抓板', zone: '玩耍区', action: 'play' },
} as const;
export type InteractionItem = keyof typeof roomItems;
export const actionNames = { pet: '抚摸', sleep: '睡觉', eat: '吃饭', drink: '喝水', play: '抓挠', rest: '返回地毯' } as const;
export type CatAction = keyof typeof actionNames;
export type InteractionTarget = { kind: 'cat'; id: string } | { kind: 'item'; id: InteractionItem };
export type CatBehavior = { autonomous?: boolean; phase: 'idle' | 'loading' | 'teleporting' | 'acting' | 'recovering'; action: CatAction | null };
export type InteractionSnapshot = {
  residentIds: string[]; selectedCatId: string | null; itemId: InteractionItem | null;
  open: boolean; choices: InteractionTarget[]; behaviors: Record<string, CatBehavior>;
  feedback: string;
};
export type BehaviorExecutor = { replaceable?: boolean; subscribe?: (listener: () => void) => () => void; status?: (id: string) => (CatBehavior & { autonomous: boolean }) | undefined; cancel?: (id: string) => void; actions: readonly CatAction[]; run: (catId: string, action: CatAction, itemId: InteractionItem | null, signal: AbortSignal, report?: (phase: CatBehavior['phase']) => void) => Promise<void> };

// Ephemeral house state only. No adoption, timer, wallet or storage dependencies.
export function createRoomInteraction(ids: readonly string[], executor?: BehaviorExecutor, preferredId?: string) {
  let residentIds: string[] = [], selectedCatId: string | null = null, itemId: InteractionItem | null = null;
  let open = false, choices: InteractionTarget[] = [], destroyed = false;
  let feedback = '';
  let unsubscribeExecutor: (() => void) | undefined;
  const behaviors = new Map<string, CatBehavior>(), running = new Map<string, AbortController>();
  const listeners = new Set<(state: InteractionSnapshot) => void>();
  const snapshot = (): InteractionSnapshot => ({ residentIds: [...residentIds], selectedCatId, itemId, open, feedback, choices: choices.map(target => ({ ...target })), behaviors: Object.fromEntries([...behaviors].map(([id, state]) => [id, { ...state, ...(state.phase === 'idle' ? executor?.status?.(id) : undefined) }])) });
  const emit = () => { if (!destroyed) for (const listener of listeners) listener(snapshot()); };
  const valid = (target: InteractionTarget) => target.kind === 'cat' ? residentIds.includes(target.id) : Object.hasOwn(roomItems, target.id);
  function cancel(id: string) {
    if (destroyed || !behaviors.has(id)) return;
    const task = running.get(id);
    if (!task) { executor?.cancel?.(id); return; }
    behaviors.set(id, { phase: 'recovering', action: behaviors.get(id)!.action }); emit(); task.abort();
  }
  function reconcile(next: readonly string[]) {
    if (destroyed) return;
    residentIds = [...new Set(next.filter(id => !!getCatDefinition(id)))].slice(0, 3);
    for (const id of behaviors.keys()) if (!residentIds.includes(id)) { running.get(id)?.abort(); running.delete(id); behaviors.delete(id); }
    for (const id of residentIds) if (!behaviors.has(id)) behaviors.set(id, { phase: 'idle', action: null });
    if (selectedCatId && !residentIds.includes(selectedCatId)) selectedCatId = null;
    choices = choices.filter(valid); emit();
  }
  function selectCat(id: string, preserveItem = false) {
    if (destroyed || !residentIds.includes(id)) return;
    selectedCatId = id; if (!preserveItem) itemId = null;
    open = false; choices = []; feedback = ''; emit();
  }
  function selectItem(id: InteractionItem) {
    if (destroyed || !Object.hasOwn(roomItems, id)) return;
    itemId = id; open = !selectedCatId; choices = []; feedback = ''; emit();
  }
  function availability(id: string | null, action: CatAction, targetItem = itemId) {
    if (destroyed || !id || !residentIds.includes(id)) return '请选择互动猫咪';
    if (!Object.hasOwn(actionNames, action)) return '未知行为';
    if (!executor?.replaceable && behaviors.get(id)?.phase !== 'idle') return '这只猫正在执行其他行为';
    if (targetItem && roomItems[targetItem].action !== action) return '行为与家具不匹配';
    return executor?.actions.includes(action) ? '' : '尚未开放';
  }
  async function request(action: CatAction, id = selectedCatId, targetItem = itemId) {
    const reason = availability(id, action, targetItem);
    if (reason || !id || !executor) return { started: false, reason };
    if ((running.has(id) && behaviors.get(id)?.action === action) || (!running.has(id) && executor.status?.(id)?.action === action)) return { started: false, reason: '' };
    const abort = new AbortController(); running.set(id, abort);
    feedback = '';
    behaviors.set(id, { phase: 'acting', action }); emit();
    try {
      const capturedExecutor = executor;
      await capturedExecutor.run(id, action, targetItem, abort.signal, phase => { if (!destroyed && running.get(id) === abort) { behaviors.set(id, { phase, action }); emit(); } });
      if (destroyed || running.get(id) !== abort) return { started: false, reason: '已由新指令替换' };
      if (abort.signal.aborted) { feedback = '已取消，猫咪已恢复待机'; return { started: false, reason: feedback }; }
      feedback = `${catDisplayName(getCatDefinition(id)!)}已完成${actionNames[action]}，回到待机。`;
      return { started: true, reason: '' };
    } catch (error) {
      if (destroyed || running.get(id) !== abort) return { started: false, reason: '已由新指令替换' };
      if ((error as Error).name === 'AbortError') { feedback = '已取消，猫咪已恢复待机'; return { started: false, reason: feedback }; }
      feedback = (error as Error).message;
      throw error;
    } finally {
      if (!destroyed && running.get(id) === abort) { running.delete(id); behaviors.set(id, { phase: 'idle', action: null }); emit(); }
    }
  }
  reconcile(ids);
  selectedCatId = preferredId && residentIds.includes(preferredId) ? preferredId : preferredId !== undefined ? residentIds[0] || null : null;
  return {
    snapshot, reconcile, selectCat, selectItem, availability, request, cancel,
    setExecutor(next?: BehaviorExecutor) { if (!destroyed) { for (const id of running.keys()) cancel(id); unsubscribeExecutor?.(); executor = next; unsubscribeExecutor = next?.subscribe?.(emit); emit(); } },
    choose(target: InteractionTarget) { if (target.kind === 'cat') selectCat(target.id, true); else selectItem(target.id); if(itemId && selectedCatId)void request(roomItems[itemId].action).catch(() => {}); },
    disambiguate(targets: readonly InteractionTarget[]) { if (!destroyed) { itemId = null; choices = targets.filter(valid).map(target => ({ ...target })); open = true; emit(); } },
    close() { if (!destroyed) { itemId = null; choices = []; open = false; emit(); } },
    subscribe(listener: (state: InteractionSnapshot) => void) { if (destroyed) return () => {}; listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; },
    destroy() { if (destroyed) return; destroyed = true; unsubscribeExecutor?.(); for (const abort of running.values()) abort.abort(); running.clear(); listeners.clear(); behaviors.clear(); },
  };
}
export type RoomInteraction = ReturnType<typeof createRoomInteraction>;
