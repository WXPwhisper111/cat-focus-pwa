// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createCatPlayer } from '../src/cat-player';
import { catDefinitions } from '../src/cat-definition';
import { getInteractionClip } from '../src/cat-interactions';
import type { AnimationClip } from '../src/cat-animation';

const engines: ReturnType<typeof createCatPlayer>[] = [];
afterEach(() => { engines.forEach(engine => engine.destroy()); engines.length = 0; vi.restoreAllMocks(); });
function engine(loadImage = async (_url: string) => {}) {
  let hidden = false, now = 0, next = 0;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const callbacks = new Map<number, FrameRequestCallback>(), image = document.createElement('img'), onError = vi.fn(), load = vi.fn(loadImage);
  const control = createCatPlayer(image, 'idle', { definition: catDefinitions[0], onError }, {
    loadImage: load, now: () => now, requestFrame: callback => { callbacks.set(++next, callback); return next; }, cancelFrame: id => { callbacks.delete(id); },
  });
  engines.push(control);
  return { control, image, callbacks, onError, load,
    hidden(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    advance(value: number) { now = value; for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(now); } },
  };
}
const clip = (behavior: 'pet' | 'eat' | 'drink') => getInteractionClip('orange-white', behavior)!;

it('finishes a configured number of real loop cycles using frame completion rather than a dwell timer', async () => {
  const app = engine(), complete = vi.fn(); await app.control.play(clip('eat'), { iterations: 2, onComplete: complete });
  app.advance(4799); expect(complete).not.toHaveBeenCalled();
  app.advance(4800); expect(complete).toHaveBeenCalledTimes(1); expect(app.callbacks.size).toBe(0);
  expect((await app.control.play(clip('eat'), { iterations: 0 })).status).toBe('failed');
});

it('finishes actual pet once at 2400ms, holds its final frame and calls completion exactly once', async () => {
  const app = engine(), complete = vi.fn(); await app.control.play(clip('pet'), { onComplete: complete });
  app.advance(149); expect(app.image.dataset.frame).toBe('0');
  app.advance(150); expect(app.image.dataset.frame).toBe('1');
  app.advance(2399); expect(app.image.dataset.frame).toBe('15'); expect(complete).not.toHaveBeenCalled();
  app.advance(2400); expect(complete).toHaveBeenCalledTimes(1); expect(app.callbacks.size).toBe(0);
  expect(app.control.getState().completed).toBe(true);
  app.advance(10000); document.dispatchEvent(new Event('visibilitychange')); expect(complete).toHaveBeenCalledTimes(1); expect(app.callbacks.size).toBe(0);
  await app.control.updateState('idle'); expect(app.image.dataset.animation).toBe('idle'); expect(app.callbacks.size).toBe(1);
});

it('consumes arbitrary per-frame durations and skips complete loop cycles without fixed-fps assumptions', async () => {
  const app = engine(), complete = vi.fn();
  // Test-only timing probe uses real frame paths; it is never part of the resource catalogue.
  const variable: AnimationClip = { ...clip('pet'), id: 'test-variable', frames: clip('pet').frames.slice(0, 3).map((frame, index) => ({ ...frame, durationMs: [70, 130, 50][index] })) };
  await app.control.play(variable, { onComplete: complete });
  for (const [time, index] of [[69, 0], [70, 1], [199, 1], [200, 2], [249, 2]]) { app.advance(time); expect(app.image.dataset.frame).toBe(String(index)); }
  app.advance(250); expect(complete).toHaveBeenCalledTimes(1);
  await app.control.play({ ...variable, loop: true });
  app.advance(250 + 250 * 100 + 201); expect(app.image.dataset.frame).toBe('2'); expect(app.callbacks.size).toBe(1);
  app.control.stop(); const src = app.image.src; app.advance(999999); expect(app.image.src).toBe(src); expect(app.callbacks.size).toBe(0);
});

it('keeps one RAF, cancels pending loads and never lets a stale request replace the newest clip', async () => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  const app = engine(url => url.includes('/drink/') ? waiting : Promise.resolve());
  await app.control.updateState('idle'); const src = app.image.src;
  const old = app.control.play(clip('drink'));
  expect(app.image.src).toBe(src); expect(app.callbacks.size).toBe(1);
  await app.control.play(clip('pet')); release(); expect((await old).status).toBe('cancelled');
  expect(app.image.dataset.animation).toBe('pet:once'); expect(app.callbacks.size).toBe(1);
  const complete = vi.fn(); await app.control.play(clip('pet'), { onComplete: complete });
  app.control.cancel(); app.advance(5000); expect(complete).not.toHaveBeenCalled(); expect(app.callbacks.size).toBe(0);
});

it('preserves old playback on loading failure, rejects crossed cats and supports retry', async () => {
  let fail = true; const app = engine(async url => { if (fail && url.includes('/eat/')) throw Error('test decode failure'); });
  await app.control.updateState('idle'); const original = app.image.src;
  expect((await app.control.play(clip('eat'))).status).toBe('failed');
  expect(app.image.src).toBe(original); expect(app.callbacks.size).toBe(1);
  expect((await app.control.play(getInteractionClip('cat-02', 'eat')!)).status).toBe('failed');
  expect(app.load.mock.calls.some(([url]) => url.includes('/cat-02/'))).toBe(false);
  fail = false; expect((await app.control.play(clip('eat'))).status).toBe('started');
  app.advance(2400); expect(app.image.dataset.frame).toBe('0'); expect(app.callbacks.size).toBe(1);
});

it('pauses one-shot time in background and resumes with the remaining frame time', async () => {
  const app = engine(), complete = vi.fn(); await app.control.play(clip('pet'), { onComplete: complete });
  app.advance(300); app.hidden(true); app.advance(10000); expect(app.callbacks.size).toBe(0);
  expect(app.image.dataset.frame).toBe('2'); app.hidden(false);
  app.advance(10149); expect(app.image.dataset.frame).toBe('2');
  app.advance(10150); expect(app.image.dataset.frame).toBe('3');
  app.advance(12100); expect(complete).toHaveBeenCalledTimes(1); expect(app.callbacks.size).toBe(0);
});

it('does not revive after destroy while loading or after stop during page restore', async () => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const app = engine(url => url.includes('/pet/') ? wait : Promise.resolve());
  await app.control.updateState('idle'); const complete = vi.fn();
  const loading = app.control.play(clip('pet'), { onComplete: complete });
  app.control.destroy(); release(); expect((await loading).status).toBe('cancelled');
  window.dispatchEvent(new Event('pageshow')); app.hidden(false); expect(app.callbacks.size).toBe(0); expect(complete).not.toHaveBeenCalled();
  const other = engine(); await other.control.play(clip('eat')); other.control.stop();
  window.dispatchEvent(new Event('pageshow')); expect(other.callbacks.size).toBe(0);
});
