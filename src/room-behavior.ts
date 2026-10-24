import { clipDuration, type AnimationClip, type AnimationPoint } from './cat-animation';
import { anchorFeet, createAnchorManager, furnitureAnchors, nearbyCandidates, positionsOverlap } from './room-anchors';
import { baseClip, behaviorPlan, behaviorLimits, type BehaviorPlan, type ManualBehavior } from './room-behavior-config';
import { createTeleportController, cancelled, checkSignal, awaitAbortable, type TeleportPort } from './cat-teleport';
import type { PlayOptions, PlaybackStart } from './cat-player';
import type { BehaviorExecutor, InteractionItem } from './room-interaction';

export type BehaviorRequest = { catId: string; behavior: ManualBehavior | 'return-home'; source: 'manual' | 'autonomous'; itemId?: InteractionItem; anchorId?: string };
export type BehaviorPort = TeleportPort & {
  ids: readonly string[]; home(id: string): AnimationPoint; positions(): ReadonlyMap<string, AnimationPoint>;
  preload(id: string, clip: AnimationClip): Promise<void>;
  play(id: string, clip: AnimationClip, options?: PlayOptions): Promise<PlaybackStart>;
  setOffscreen?(id:string,value:boolean):void; toiletFeedback?(id:string,value:boolean):void;
  stop(id: string): void; idle(id: string): Promise<void>;
};
export type BehaviorStage = 'loading' | 'teleporting' | 'enter' | 'loop' | 'once' | 'exit' | 'recovering';
export function createRoomBehavior(port: BehaviorPort, dependencies: {
  teleport?: ReturnType<typeof createTeleportController>;
  plan?: (id: string, action: ManualBehavior) => BehaviorPlan | undefined;
  equipped?: (item: InteractionItem) => boolean;
  initialLocations?: Record<string, string>;
  onLocations?: (locations: Record<string, string>) => void;
  onSettled?: (id: string, action?: ManualBehavior) => void;
} = {}) {
  let toiletOwner:string|undefined;
  const away=new Set<string>();
  const nearbyReservations=new Map<string,AnimationPoint>();
  const anchorHomes=new Map(port.ids.map(id=>[id,port.home(id)]));
  const teleport = dependencies.teleport || createTeleportController(port), anchors = createAnchorManager(()=>new Map([...port.positions(),...[...nearbyReservations].map(([id,point])=>[`${id}#nearby`,point] as [string,AnimationPoint])]), furnitureAnchors, anchorHomes);
  const lifetime = new AbortController(); let destroyed = false, suspended = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  type Lease = ReturnType<typeof anchors.reserve>;
  const stable = new Map<string, { feet: AnimationPoint; lease?: Lease; anchorId?: string }>(port.ids.map(id => [id, { feet: port.home(id) }]));
  const locations = (): Record<string, string> => ({}); // Only idle homes are stable now; action poses are transient.
  type RecoveryReason = 'complete' | 'replace' | 'displace' | 'cancel' | 'suspend';
  type Task = { reason: RecoveryReason; abort: AbortController; recovery: AbortController; source: BehaviorRequest['source']; stage: BehaviorStage; behavior: BehaviorRequest['behavior']; preempt: boolean; done: Promise<void> };
  const tasks = new Map<string, Task>();
  const carry = new Map<string, Lease>();
  const carryTokens=new Map<string,number>();
  const nextMoves=new Map<string,{token:number;request:BehaviorRequest;plan:BehaviorPlan;ready:boolean;signal:AbortSignal}>();
  // Serialize only preparation/handovers, never whole behavior loops.
  let preparation: Promise<void> = Promise.resolve();
  const commands = new Map<string, number>();
  const pendingManual = new Set<string>();
  const latestRequests = new Map<string, { key: string; done: Promise<void> }>();
  const planFor = dependencies.plan || behaviorPlan;
  function available(id: string, action: ManualBehavior) {
    if (destroyed || suspended || (tasks.has(id) || pendingManual.has(id)) || !port.ids.includes(id)) return false;
    if(action==='toilet' && (toiletOwner || !port.setOffscreen))return false;
    const plan = planFor(id, action);
    if (!plan || !baseClip(id, 'idle')) return false;
    try { return !plan.item || ((dependencies.equipped?.(plan.item) ?? true) && !!anchors.available(id, plan.item, (plan.loop || plan.once)!)); } catch { return false; }
  }
  // Both legacy furniture positions and removed nearby-idle positions restore at home.
  for (const id of port.ids) port.setFeet(id, port.home(id));
  async function home(id: string, signal: AbortSignal, animate = true) {
    if (animate && !destroyed && !suspended) await teleport.move(id, port.home(id), signal, away.has(id)?async()=>{port.setOffscreen?.(id,false);away.delete(id);}:undefined,undefined,away.has(id)?'in':undefined);
    else {port.setFeet(id, port.home(id));port.setOffscreen?.(id,false);away.delete(id);}
    port.toiletFeedback?.(id,false);
    stable.get(id)?.lease?.release(); carry.get(id)?.release(); carry.delete(id);carryTokens.delete(id);
    stable.set(id, { feet: port.home(id) });
    port.fadeElements(id).forEach(node => { node.style.opacity = '1'; });
    dependencies.onLocations?.(locations());
    if (!destroyed) await awaitAbortable(port.idle(id), lifetime.signal);
  }
  async function restNearby(id:string,item:InteractionItem,task:Task) {
    const free=nearbyCandidates(item).find(point=>
      ![...port.positions()].some(([other,current])=>other!==id&&positionsOverlap(current,point)) &&
      ![...nearbyReservations].some(([other,current])=>other!==id&&positionsOverlap(current,point)) &&
      ![...anchorHomes].some(([other,current])=>other!==id&&positionsOverlap(current,point)) &&
      !anchors.snapshot().some(lease=>lease.catId!==id&&positionsOverlap(lease.feet,point)));
    if(!free){await home(id,task.recovery.signal);return;}
    nearbyReservations.set(id,free);
    try {
      await teleport.move(id,free,task.recovery.signal,undefined,()=>{
        const next=nextMoves.get(id);
        if(next?.ready && !next.signal.aborted && commands.get(id)===next.token && task.reason==='replace' && next.plan.item && anchors.available(id,next.plan.item,next.plan.loop||next.plan.once!,next.request.anchorId)) {
          const lease=anchors.reserve(id,next.plan.item,next.plan.loop||next.plan.once!,next.request.anchorId);
          carry.set(id,lease);carryTokens.set(id,next.token);return lease.feet;
        }
        return free;
      });
      if(task.reason!=='complete' && task.reason!=='replace'){await home(id,task.recovery.signal);return;}
      if(carryTokens.has(id))return; // Successor starts at the already reached target, without an intermediate idle.
      stable.set(id,{feet:port.getFeet(id)});
      if(task.reason==='replace'&&pendingManual.has(id))return;
      await awaitAbortable(port.idle(id),lifetime.signal);
    } finally {nearbyReservations.delete(id);}
  }
  function interrupt(task: Task, reason: RecoveryReason = 'cancel') {
    // A displaced cat must leave the furniture even if its own next command is queued.
    if (task.reason !== 'displace' || reason === 'suspend') task.reason = reason;
    task.preempt = true;
    if (task.stage === 'loop' || task.stage === 'loading') task.abort.abort();
  }
  function playUntilComplete(id: string, clip: AnimationClip, signal: AbortSignal, iterations?: number) {
    checkSignal(signal);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const abort = () => { port.stop(id); finish(cancelled()); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      void port.play(id, clip, { iterations, onComplete: () => finish() }).then(result => {
        if (result.status !== 'started') finish(result.error || cancelled());
      }, finish);
    });
  }
  async function executeInternal(request: BehaviorRequest, signal: AbortSignal, report: (stage: BehaviorStage) => void, token: number | undefined, prepared: () => void) {
    if (token !== undefined && commands.get(request.catId) !== token) throw cancelled();
    checkSignal(signal);
    if (suspended) throw Error('小屋暂不可操作');
    if (destroyed || !port.ids.includes(request.catId)) throw Error('当前猫咪没有入住');
    if(request.behavior==='toilet' && (request.source!=='autonomous'||toiletOwner||!port.setOffscreen))throw Error('厕所暂不可用');
    const desiredPlan = request.behavior === 'return-home' ? { item: null, minimumMs: 0 } : planFor(request.catId, request.behavior);
    if (!desiredPlan || !baseClip(request.catId, 'idle')) throw Error('这只猫缺少对应动作素材');
    if (desiredPlan.item && !(dependencies.equipped?.(desiredPlan.item) ?? true)) throw Error('对应家具尚未装备');
    if (request.itemId && request.itemId !== desiredPlan.item) throw Error('行为与家具不匹配');
    if (!['manual', 'autonomous'].includes(request.source)) throw Error('行为来源无效');
    const existing = tasks.get(request.catId);
    if (existing) {
      if (request.source === 'manual') {
        interrupt(existing, 'replace'); await existing.done.catch(() => {}); checkSignal(signal);
        return executeInternal(request, signal, report, token, prepared);
      }
      throw Error('这只猫正在执行其他行为，请稍候');
    }
    const requestedPlan = request.behavior === 'return-home' ? undefined : planFor(request.catId, request.behavior);
    if (request.source === 'manual' && requestedPlan?.item) {
      const group = furnitureAnchors.find(anchor => anchor.itemId === requestedPlan.item)?.group;
      const occupant = anchors.snapshot().find(lease => lease.catId !== request.catId && lease.anchor.group === group);
      const occupiedTask = occupant && tasks.get(occupant.catId);
      if (occupiedTask) { interrupt(occupiedTask, 'displace'); await occupiedTask.done.catch(() => {}); checkSignal(signal); return executeInternal(request, signal, report, token, prepared); }
      if (occupant && carry.has(occupant.catId)) { await home(occupant.catId, lifetime.signal); checkSignal(signal); return executeInternal(request, signal, report, token, prepared); }
    }
    if(request.source==='manual' && requestedPlan?.item && !anchors.available(request.catId,requestedPlan.item,requestedPlan.loop||requestedPlan.once!,request.anchorId)) {
      const target=furnitureAnchors.find(anchor=>anchor.itemId===requestedPlan.item);
      if(target){
        const feet=anchorFeet(target,requestedPlan.loop||requestedPlan.once!);
        for(const [id,point] of port.positions())if(id!==request.catId && positionsOverlap(point,feet)) {
          const other=tasks.get(id);
          if(other){interrupt(other,'displace');await other.done.catch(()=>{});}else await home(id,lifetime.signal);
          checkSignal(signal);
        }
      }
    }
    if (tasks.size >= behaviorLimits.maxActive) {
      const automatic = [...tasks.values()].find(task => task.source === 'autonomous');
      if (request.source === 'manual' && automatic) { interrupt(automatic, 'displace'); await automatic.done.catch(() => {}); checkSignal(signal); return executeInternal(request, signal, report, token, prepared); }
      throw Error('已有两只猫正在活动，请稍候');
    }
    const returning = request.behavior === 'return-home';
    const plan = returning ? { item: null, minimumMs: 0 } : planFor(request.catId, request.behavior as ManualBehavior), idle = baseClip(request.catId, 'idle');
    if (!plan || !idle) throw Error('这只猫缺少对应动作素材');
    if (plan.item && !(dependencies.equipped?.(plan.item) ?? true)) throw Error('对应家具尚未装备');
    if (request.itemId && request.itemId !== plan.item) throw Error('行为与家具不匹配');
    if (!['manual', 'autonomous'].includes(request.source)) throw Error('行为来源无效');
    const task: Task = { reason: 'complete', abort: new AbortController(), recovery: new AbortController(), source: request.source, stage: 'loading', behavior: request.behavior, preempt: false, done: Promise.resolve() };
    tasks.set(request.catId, task); emit();
    const abort = () => task.abort.abort();
    const endLifetime = () => { task.abort.abort(); task.recovery.abort(); };
    signal.addEventListener('abort', abort, { once: true }); lifetime.signal.addEventListener('abort', endLifetime, { once: true });
    const status = (stage: BehaviorStage) => { task.stage = stage; report(stage); emit(); };
    const run = async () => {
      const id = request.catId;
      let lease: ReturnType<typeof anchors.reserve> | undefined, entered = false, completed = false;
      try {
        status('loading');
        if(request.behavior==='toilet') {
          toiletOwner=id;port.stop(id);status('teleporting');
          await teleport.move(id,port.getFeet(id),task.abort.signal,async()=>{port.setOffscreen?.(id,true);away.add(id);stable.get(id)?.lease?.release();carry.get(id)?.release();carry.delete(id);stable.set(id,{feet:port.home(id)});},undefined,'out');
          if(task.preempt)task.abort.abort();checkSignal(task.abort.signal);prepared();status('loop');port.toiletFeedback?.(id,true);
          await awaitAbortable(new Promise<void>(resolve=>{const timer=setTimeout(resolve,plan.minimumMs);task.abort.signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});}),task.abort.signal);
          completed=true;return;
        }
        port.stop(id);
        const targetClip = plan.loop || plan.once!;
        if (plan.item) {
          if(token!==undefined && carryTokens.get(id)===token){lease=carry.get(id);carry.delete(id);carryTokens.delete(id);}
          else lease=anchors.reserve(id,plan.item,targetClip,request.anchorId);
        }
        if(plan.once && !plan.item && carry.has(id)){lease=carry.get(id);carry.delete(id);carryTokens.delete(id);}
        await awaitAbortable(Promise.all([idle, plan.enter, plan.loop, plan.exit, plan.once].filter((clip): clip is AnimationClip => !!clip).map(clip => port.preload(id, clip))), task.abort.signal);
        checkSignal(task.abort.signal);
        if (lease || returning || away.has(id)) { status('teleporting'); const target=lease?.feet || port.home(id); if(away.has(id)) {await teleport.move(id,target,task.abort.signal,async()=>{port.setOffscreen?.(id,false);away.delete(id);},undefined,'in');} else if(Math.hypot(port.getFeet(id)[0]-target[0],port.getFeet(id)[1]-target[1])>.01)await teleport.move(id,target,task.abort.signal); }
        checkSignal(task.abort.signal);
        if (lease || returning) {
          stable.get(id)?.lease?.release(); carry.get(id)?.release(); carry.delete(id); carryTokens.delete(id); stable.set(id, { feet: port.getFeet(id), ...(lease ? { lease, anchorId: lease.anchor.id } : {}) });
          if(returning)dependencies.onLocations?.(locations());
        }
        if (task.preempt) task.abort.abort();
        checkSignal(task.abort.signal);
        if (plan.enter) { entered = true; status('enter'); await playUntilComplete(id, plan.enter, task.abort.signal); if (task.preempt) { task.abort.abort(); checkSignal(task.abort.signal); } }
        if (plan.once) { entered = true; prepared(); status('once'); await playUntilComplete(id, plan.once, task.abort.signal); }
        if (plan.loop) { entered = true; prepared(); status('loop'); await playUntilComplete(id, plan.loop, task.abort.signal, Math.max(1, Math.ceil(plan.minimumMs / clipDuration(plan.loop)))); }
        completed = true;
      } finally {
        try {
          port.stop(id);
          if(request.behavior==='toilet'){port.toiletFeedback?.(id,false);if(toiletOwner===id)toiletOwner=undefined;}
          if (!destroyed && port.ids.includes(id)) {
            status('recovering');
            try {
              if (entered && plan.exit && !suspended) { status('exit'); await playUntilComplete(id, plan.exit, task.recovery.signal); }
              status('recovering');
              const continuing = task.reason === 'replace' && pendingManual.has(id) && !suspended;
              if (continuing) {
                if (lease) carry.set(id, lease);
                // Keep this pose/position for the successor. No idle or detour here.
              } else if(completed && task.reason==='complete' && !suspended && plan.item) await restNearby(id,plan.item,task);
              else if(completed && task.reason==='complete' && plan.once && !suspended) await awaitAbortable(port.idle(id),lifetime.signal);
              else await home(id, task.recovery.signal);
            } catch {
              if (!destroyed) await home(id, lifetime.signal, false).catch(() => {});
            }

          }
        } finally { if(carry.get(id) !== lease)lease?.release(); prepared(); const saved = stable.get(id); if(saved && saved.lease === lease)delete saved.lease; signal.removeEventListener('abort', abort); lifetime.signal.removeEventListener('abort', endLifetime); if (tasks.get(id) === task) { tasks.delete(id); if (!destroyed) { dependencies.onSettled?.(id, request.behavior === 'return-home' ? undefined : request.behavior); emit(); } } }
      }
    };
    task.done = run();
    return task.done;
  }
  function startPrepared(request: BehaviorRequest, signal: AbortSignal, report: (stage: BehaviorStage) => void, token?: number) {
    const previous = preparation; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    preparation = previous.then(() => held);
    return (async () => {
      await previous;
      try {
        if (request.source === 'autonomous' && pendingManual.has(request.catId)) throw cancelled();
        return await executeInternal(request, signal, report, token, release);
      } finally {
        if ((!pendingManual.has(request.catId) || commands.get(request.catId) === token) && (carry.has(request.catId)||away.has(request.catId))) {
          await home(request.catId, lifetime.signal).catch(() => home(request.catId, lifetime.signal, false).catch(() => {}));
        }
        release();
      }
    })();
  }
  function execute(request: BehaviorRequest, signal: AbortSignal, report: (stage: BehaviorStage) => void = () => {}): Promise<void> {
    if (request.source !== 'manual') {
      if (pendingManual.has(request.catId)) return Promise.reject(Error('正在处理用户指令'));
      return startPrepared(request, signal, report);
    }
    if(request.behavior==='toilet')return Promise.reject(Error('上厕所仅由猫咪自主触发'));
    if (signal.aborted || destroyed || suspended || !port.ids.includes(request.catId)) return Promise.reject(cancelled());
    const plan = request.behavior === 'return-home' ? { item: null } : planFor(request.catId, request.behavior);
    if (!plan || (plan.item && !(dependencies.equipped?.(plan.item) ?? true)) || (request.itemId && request.itemId !== plan.item)) return Promise.reject(Error('动作素材或目标家具不可用'));
    const key = JSON.stringify([request.behavior, request.itemId || null, request.anchorId || null]);
    const previous = latestRequests.get(request.catId);
    if (previous?.key === key) return previous.done;
    const current = tasks.get(request.catId);
    if (!previous && current?.behavior === request.behavior && !current.preempt) return current.done;
    const token = (commands.get(request.catId) || 0) + 1; commands.set(request.catId, token); pendingManual.add(request.catId); if(current)interrupt(current, 'replace'); emit();
    if(request.behavior!=='return-home' && current?.stage==='recovering'){
      const nextPlan=planFor(request.catId,request.behavior)!;
      const move={token,request,plan:nextPlan,ready:false,signal};nextMoves.set(request.catId,move);
      void Promise.all([baseClip(request.catId,'idle'),nextPlan.enter,nextPlan.loop,nextPlan.exit,nextPlan.once].filter((clip):clip is AnimationClip=>!!clip).map(clip=>port.preload(request.catId,clip))).then(()=>{if(!signal.aborted)move.ready=true;},()=>{});
    } else nextMoves.delete(request.catId);
    const done = startPrepared(request, signal, report, token).finally(() => {
      if (commands.get(request.catId) === token) { pendingManual.delete(request.catId); latestRequests.delete(request.catId); nextMoves.delete(request.catId); emit(); }
    });
    latestRequests.set(request.catId, { key, done });
    return done;
  }

  const executor: BehaviorExecutor = {
    replaceable: true,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status(id) { const task = tasks.get(id); return task ? { phase: task.stage === 'teleporting' ? 'teleporting' : task.stage === 'loading' ? 'loading' : task.stage === 'exit' || task.stage === 'recovering' ? 'recovering' : 'acting', action: task.behavior === 'scratch' ? 'play' : task.behavior === 'return-home' || task.behavior==='toilet' ? null : task.behavior, autonomous: task.source === 'autonomous' } : undefined; },
    cancel(id) { const task = tasks.get(id); if (task) interrupt(task); },
    actions: ['pet', 'sleep', 'eat', 'drink', 'play', 'rest'],
    run: (id, action, item, signal, report) => execute({ catId: id, behavior: action === 'rest' ? 'return-home' : action === 'play' ? 'scratch' : action, source: 'manual', ...(item && item !== 'rug' ? { itemId: item } : {}) }, signal,
      stage => report?.(stage === 'teleporting' ? 'teleporting' : stage === 'loading' ? 'loading' : stage === 'recovering' || stage === 'exit' ? 'recovering' : 'acting')),
  };
  return {
    executor, execute, anchors, available, locations,
    async stopCat(id:string) { commands.set(id,(commands.get(id)||0)+1); pendingManual.delete(id);nextMoves.delete(id); const pending=latestRequests.get(id);latestRequests.delete(id); const task=tasks.get(id);if(task)interrupt(task,'cancel');await Promise.allSettled([task?.done,pending?.done].filter((value):value is Promise<void>=>!!value)); },
    reconcile() {
      for(const id of [...stable.keys()])if(!port.ids.includes(id)){tasks.get(id)?.abort.abort();stable.get(id)?.lease?.release();carry.get(id)?.release();carry.delete(id);away.delete(id);carryTokens.delete(id);nextMoves.delete(id);stable.delete(id);anchorHomes.delete(id);}
      for(const id of port.ids)if(!stable.has(id)){stable.set(id,{feet:port.home(id)});anchorHomes.set(id,port.home(id));}
    },
    activeCount: () => tasks.size,
    busy: (id: string) => tasks.has(id) || pendingManual.has(id),
    atFurniture: (id: string) => !!stable.get(id)?.anchorId,
    vacate: (id: string, signal: AbortSignal) => execute({ catId: id, behavior: 'return-home', source: 'autonomous' }, signal),
    async setSuspended(value: boolean) {
      suspended = value;
      if (!value) return;
      for (const task of tasks.values()) { task.reason = 'suspend'; task.abort.abort(); task.recovery.abort(); }
      await Promise.allSettled([...tasks.values()].map(task => task.done));
    },
    stage: (id: string) => tasks.get(id)?.stage,
    destroy() {
      if (destroyed) return; destroyed = true; lifetime.abort(); teleport.destroy();
      for (const id of port.ids) { port.setOffscreen?.(id,false);port.toiletFeedback?.(id,false);port.stop(id); port.setFeet(id, port.home(id)); port.fadeElements(id).forEach(node => { node.style.opacity = '1'; }); }
      for (const lease of carry.values())lease.release(); carry.clear(); away.clear();toiletOwner=undefined; carryTokens.clear(); nextMoves.clear(); nearbyReservations.clear(); anchors.clear(); listeners.clear();
    },
  };
}
