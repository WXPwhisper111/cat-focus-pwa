import { behaviorLimits, toiletTiming, type ManualBehavior } from './room-behavior-config';

export const autonomyTiming = { initial: [8000, 10000], cooldown: [10000, 20000], spacing: [5000, 8000], interactionDelay: 8000, maxActive: behaviorLimits.maxActive } as const;
export const autonomousActions = ['eat', 'drink', 'scratch', 'sleep','toilet'] as const;
export type AutonomyPort = {
  ids: readonly string[];
  activeCount(): number;
  busy(id: string): boolean;
  protectedCat(): string | null;
  available(id: string, action: ManualBehavior): boolean;
  execute(id: string, action: ManualBehavior, signal: AbortSignal): Promise<void>;
  atFurniture(id: string): boolean;
  vacate(id: string, signal: AbortSignal): Promise<void>;
};
// One timer for the entire room. No missed background work is queued.
export function createRoomAutonomy(port: AutonomyPort, options: {
  now?: () => number; random?: () => number;
  setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout;
} = {}) {
  const now = options.now || Date.now, random = options.random || Math.random;
  const setTimer = options.setTimer || setTimeout, clearTimer = options.clearTimer || clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined, enabled = false, destroyed = false, nextStart = 0, deferredUntil = 0;
  const toiletNext=new Map<string,number>();
  const next = new Map<string, number>(), recent = new Map<string, ManualBehavior>(), jobs = new Map<string, AbortController>();
  const delay = (range: readonly [number, number]) => range[0] + Math.floor(random() * (range[1] - range[0]));
  function clear() { if (timer !== undefined) clearTimer(timer); timer = undefined; }
  function schedule() {
    clear(); if (!enabled || destroyed) return;
    const dates = port.ids.filter(id => !port.busy(id) && !jobs.has(id) && port.protectedCat() !== id).map(id => next.get(id) || now());
    if (!dates.length || port.activeCount() >= autonomyTiming.maxActive) return;
    timer = setTimer(tick, Math.max(0, Math.max(Math.min(...dates), nextStart, deferredUntil) - now()));
  }
  function launch(id: string, action?: ManualBehavior) {
    const abort = new AbortController(); jobs.set(id, abort);
    nextStart = now() + delay(autonomyTiming.spacing);
    if (action) recent.set(id, action);
    void (action ? port.execute(id, action, abort.signal) : port.vacate(id, abort.signal)).catch(() => {
      // Executor restores a stable pose; retry only after a full cooldown.
    }).finally(() => {
      if (jobs.get(id) !== abort) return;
      jobs.delete(id);if(action==='toilet')toiletNext.set(id,now()+delay(toiletTiming.cooldown)); next.set(id, now() + delay(autonomyTiming.cooldown)); schedule();
    });
  }
  function tick() {
    timer = undefined; if (!enabled || destroyed) return;
    if (port.activeCount() >= autonomyTiming.maxActive) return;
    for (const id of [...port.ids].sort((a,b) => (next.get(a) || 0) - (next.get(b) || 0))) {
      if ((next.get(id) || 0) > now() || port.busy(id) || jobs.has(id) || port.protectedCat() === id) continue;
      const candidates = autonomousActions.filter(action => (action!=='toilet'||(toiletNext.get(id)??Infinity)<=now()) && port.available(id, action));
      const varied = candidates.filter(action => action !== recent.get(id));
      if (varied.length) {const weighted=varied.flatMap(action=>Array.from({length:action==='toilet'?toiletTiming.weight:toiletTiming.ordinaryWeight},()=>action));launch(id,weighted[Math.min(weighted.length-1,Math.floor(random()*weighted.length))]);}
      else next.set(id, now() + delay(autonomyTiming.cooldown));
      break;
    }
    schedule();
  }
  return {
    setActive(active: boolean) {
      if (destroyed || enabled === active) return;
      enabled = active; clear();
      if (!active) { for (const abort of jobs.values()) abort.abort(); return; }
      const start = now(); nextStart = start; deferredUntil = start;
      for (const id of port.ids) {next.set(id, start + delay(autonomyTiming.initial));toiletNext.set(id,Math.max(toiletNext.get(id)||0,start+delay(toiletTiming.initial)));}
      schedule();
    },
    userInteraction() { deferredUntil = now() + autonomyTiming.interactionDelay; schedule(); },
    settled(id: string, action?: ManualBehavior) { if(action==='toilet')toiletNext.set(id,now()+delay(toiletTiming.cooldown)); if(action && action !== 'pet')recent.set(id, action); next.set(id, now() + delay(autonomyTiming.cooldown)); schedule(); },
    changed: schedule,
    snapshot: () => ({ active: enabled, jobs: [...jobs.keys()], next: Object.fromEntries(next), recent: Object.fromEntries(recent), timerPending: timer !== undefined }),
    destroy() { if (destroyed) return; destroyed = true; enabled = false; clear(); for (const abort of jobs.values()) abort.abort(); jobs.clear(); },
  };
}
