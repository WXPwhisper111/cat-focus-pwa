// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createTeleportController } from '../src/cat-teleport';
import { createAnchorManager, anchorFeet, furnitureAnchors } from '../src/room-anchors';
import { getInteractionClip } from '../src/cat-interactions';
import type { AnimationPoint } from '../src/cat-animation';
const controllers: ReturnType<typeof createTeleportController>[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); vi.useRealTimers(); vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness() {
  let feet: AnimationPoint = [100, 100], hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const node = document.createElement('div'), changes: AnimationPoint[] = [];
  const animations: { finish: () => void; cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; duration: number }[] = [];
  const controller = createTeleportController({ getFeet: () => feet, setFeet: (_id, next) => { feet = next; changes.push(next); }, fadeElements: () => [node] }, (_node, _frames, options) => {
    let finish!: () => void, reject!: (reason: Error) => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const animation = { finish, cancel: vi.fn(() => reject(Error('cancel'))), pause: vi.fn(), play: vi.fn(), duration: options.duration as number };
    animations.push(animation); return { finished, ...animation } as unknown as Animation;
  }); controllers.push(controller);
  return { controller, node, changes, animations, feet: () => feet, visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); } };
}
it('moves only after fade-out finishes and resolves only after fade-in; same-anchor skips transition', async () => {
  const app = harness(), abort = new AbortController();
  const move = app.controller.move('cat', [200, 300], abort.signal);
  expect(app.changes).toEqual([]); expect(app.animations[0].duration).toBe(150);
  app.animations[0].finish(); await flush();
  expect(app.changes).toEqual([[200, 300]]); expect(app.node.style.opacity).toBe('0'); expect(app.animations[1].duration).toBe(180);
  app.animations[1].finish(); await move; expect(app.node.style.opacity).toBe('1');
  await app.controller.move('cat', [200, 300], abort.signal); expect(app.animations).toHaveLength(2);
});
it('cancels safely in either fade, rolls back coordinates and rejects concurrent movement', async () => {
  for (const fadeIn of [false, true]) {
    const app = harness(), abort = new AbortController();
    const moving = app.controller.move('cat', [200, 300], abort.signal); const rejection = expect(moving).rejects.toMatchObject({ name: 'AbortError' });
    await expect(app.controller.move('cat', [500, 500], abort.signal)).rejects.toThrow('正在传送');
    if (fadeIn) { app.animations[0].finish(); await flush(); }
    abort.abort(); await rejection; expect(app.feet()).toEqual([100, 100]); expect(app.node.style.opacity).toBe('1'); expect(app.controller.isMoving('cat')).toBe(false);
  }
});
it('uses completion events, pauses hidden transitions, and recovers if completion never arrives', async () => {
  vi.useFakeTimers(); const app = harness();
  const move = app.controller.move('cat', [200, 300], new AbortController().signal);
  const rejected = expect(move).rejects.toThrow('超时');
  app.visibility(true); expect(app.animations[0].pause).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(9000); expect(app.feet()).toEqual([100, 100]);
  app.visibility(false); expect(app.animations[0].play).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4000); await rejected;
  expect(app.node.style.opacity).toBe('1'); expect(vi.getTimerCount()).toBe(0);
});
it('destroy and missing WAAPI restore opacity and do not leave transition timers', async () => {
  vi.useFakeTimers(); const app = harness();
  const move = app.controller.move('cat', [200, 300], new AbortController().signal); const rejected = expect(move).rejects.toMatchObject({ name: 'AbortError' });
  app.node.style.opacity = '0'; app.controller.destroy(); await rejected;
  expect(app.node.style.opacity).toBe('1'); expect(vi.getTimerCount()).toBe(0);
  const unsupported = createTeleportController({ getFeet: () => [0, 0], setFeet() {}, fadeElements: () => [document.createElement('div')] }); controllers.push(unsupported);
  await expect(unsupported.move('cat', [1, 1], new AbortController().signal)).rejects.toThrow('不支持');
});
it('shares bowl capacity, supports multiple configured anchors and releases idempotently', () => {
  const manager = createAnchorManager(() => new Map());
  const first = manager.reserve('orange-white', 'foodBowl', getInteractionClip('orange-white', 'eat')!);
  expect(first.feet).toEqual(anchorFeet(furnitureAnchors[0], getInteractionClip('orange-white', 'eat')!));
  expect(() => manager.reserve('cat-02', 'waterBowl', getInteractionClip('cat-02', 'drink')!)).toThrow('占用');
  first.release(); first.release(); expect(manager.snapshot()).toEqual([]);
  expect(() => manager.reserve('cat-02', 'waterBowl', getInteractionClip('cat-02', 'drink')!, 'missing')).toThrow('占用');
  const clip = getInteractionClip('orange-white', 'pet')!;
  const multiple = createAnchorManager(() => new Map(), [
    { id: 'left', itemId: 'bed', local: [.2, .8], contact: false, group: 'left' },
    { id: 'right', itemId: 'bed', local: [.8, .8], contact: false, group: 'right' },
  ]);
  expect(multiple.reserve('a', 'bed', clip).anchor.id).toBe('left');
  expect(multiple.reserve('b', 'bed', clip).anchor.id).toBe('right');
  expect(() => multiple.reserve('c', 'bed', clip)).toThrow('占用');
});
