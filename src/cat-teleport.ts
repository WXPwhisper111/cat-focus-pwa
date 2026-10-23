import type { AnimationPoint } from './cat-animation';
import { teleportTiming } from './room-behavior-config';
export const cancelled = () => new DOMException('操作已取消', 'AbortError');
export function checkSignal(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }
export function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal) {
  checkSignal(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value as T); };
    const abort = () => finish(cancelled()); signal.addEventListener('abort', abort, { once: true });
    promise.then(value => finish(undefined, value), error => finish(error)); if (signal.aborted) abort();
  });
}
export type TeleportPort = {
  getFeet(id: string): AnimationPoint; setFeet(id: string, point: AnimationPoint): void;
  fadeElements(id: string): HTMLElement[];
};
export function createTeleportController(port: TeleportPort, animate = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => { if (typeof node.animate !== 'function') throw Error('当前浏览器不支持传送动画'); return node.animate(frames, options); }) {
  let destroyed = false, pageActive = true;
  const active = new Map<string, { abort: AbortController; animations: Set<Animation>; nodes: HTMLElement[]; guards: Map<() => void, () => void> }>();
  const visibility = () => {
    for (const task of active.values()) {
      for (const animation of task.animations) { if (document.hidden || !pageActive) animation.pause(); else animation.play(); }
      for (const reset of task.guards.keys()) reset();
    }
  };
  document.addEventListener('visibilitychange', visibility);
  const pageHide = () => { pageActive = false; visibility(); };
  const pageShow = () => { pageActive = true; visibility(); };
  window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow);
  async function move(id: string, target: AnimationPoint, signal: AbortSignal, whileInvisible?: () => Promise<void>, resolveTarget?: () => AnimationPoint) {
    checkSignal(signal);
    if (destroyed) throw cancelled();
    if (active.has(id)) throw Error('猫咪正在传送，请稍候');
    const origin = port.getFeet(id);
    if (!resolveTarget && Math.hypot(origin[0] - target[0], origin[1] - target[1]) < .01) { if (whileInvisible) await awaitAbortable(whileInvisible(), signal); return; }
    const task = { abort: new AbortController(), animations: new Set<Animation>(), nodes: port.fadeElements(id), guards: new Map<() => void, () => void>() };
    active.set(id, task);
    const abort = () => task.abort.abort(); signal.addEventListener('abort', abort, { once: true });
    const restore = () => task.nodes.forEach(node => { node.style.opacity = '1'; });
    const fade = async (from: number, to: number, duration: number) => {
      checkSignal(task.abort.signal);
      let guard: ReturnType<typeof setTimeout> | undefined, removeAbort = () => {}, cleanupGuard = () => {};
      const animations: Animation[] = [];
      const timeout = new Promise<never>((_, reject) => {
        const reset = () => { if (guard !== undefined) clearTimeout(guard); guard = undefined; if (!document.hidden && pageActive) guard = setTimeout(() => reject(Error('传送动画超时，已恢复猫咪')), teleportTiming.watchdogMs); };
        cleanupGuard = () => { task.guards.delete(reset); if (guard !== undefined) clearTimeout(guard); }; task.guards.set(reset, cleanupGuard); reset();
      });
      try {
        for (const node of task.nodes) {
          const animation = animate(node, [{ opacity: from }, { opacity: to }], { duration, easing: 'ease-in-out', fill: 'forwards' });
          void animation.finished.catch(() => {}); animations.push(animation); task.animations.add(animation); if (document.hidden || !pageActive) animation.pause();
        }
        const aborted = new Promise<never>((_, reject) => { const onAbort = () => reject(cancelled()); task.abort.signal.addEventListener('abort', onAbort, { once: true }); removeAbort = () => task.abort.signal.removeEventListener('abort', onAbort); if (task.abort.signal.aborted) onAbort(); });
        await Promise.race([Promise.all(animations.map(animation => animation.finished)), aborted, timeout]);
        checkSignal(task.abort.signal);
        task.nodes.forEach(node => { node.style.opacity = String(to); });
      } finally {
        cleanupGuard(); removeAbort();
        for (const animation of animations) { task.animations.delete(animation); animation.cancel(); }
      }
    };
    try {
      await fade(1, 0, teleportTiming.outMs);
      checkSignal(task.abort.signal); port.setFeet(id, resolveTarget ? resolveTarget() : target);
      if (whileInvisible) await awaitAbortable(whileInvisible(), task.abort.signal); checkSignal(task.abort.signal);
      await fade(0, 1, teleportTiming.inMs);
    } catch (error) {
      if (!destroyed) port.setFeet(id, origin);
      throw error;
    } finally { restore(); signal.removeEventListener('abort', abort); active.delete(id); }
  }
  return {
    move,
    isMoving: (id: string) => active.has(id),
    destroy() { if (destroyed) return; destroyed = true; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow); for (const task of active.values()) { task.abort.abort(); for (const animation of task.animations) animation.cancel(); task.nodes.forEach(node => { node.style.opacity = '1'; }); for (const dispose of task.guards.values()) dispose(); } active.clear(); },
  };
}
