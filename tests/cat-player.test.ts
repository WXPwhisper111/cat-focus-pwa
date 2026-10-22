// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createCatPlayer } from '../src/cat-player';
import { catDefinitions, type CatDefinition } from '../src/cat-definition';

afterEach(() => vi.restoreAllMocks());
function player(definition: CatDefinition) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const image = document.createElement('img'); let now = 0, next = 0;
  const callbacks = new Map<number, FrameRequestCallback>(); const loads = vi.fn(async (_url: string) => {});
  const control = createCatPlayer(image, 'idle', { definition }, {
    loadImage: loads, now: () => now,
    requestFrame: callback => { callbacks.set(++next, callback); return next; }, cancelFrame: id => { callbacks.delete(id); },
  });
  return { control, image, callbacks, loads, advance(value: number) { now = value; for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(now); } } };
}

it('preserves the new cats per-frame timing and the 9260ms blink cycle', async () => {
  const app = player(catDefinitions[1]); await app.control.updateState('idle');
  for (const [time, index] of [[149, 0], [150, 1], [6600, 44], [6680, 45], [6780, 46], [6860, 47], [9260, 0]]) {
    app.advance(time); expect(app.image.dataset.frame).toBe(String(index));
  }
  app.advance(9260 * 100 + 1200); expect(app.image.dataset.frame).toBe('8');
  expect(app.callbacks.size).toBe(1); app.control.destroy(); expect(app.callbacks.size).toBe(0);
});

it('freezes the selected cats own idle first frame when sleep is absent and resumes it safely', async () => {
  const cat = { ...catDefinitions[1], animations: { idle: catDefinitions[1].animations.idle } };
  const app = player(cat); await app.control.updateState('sleep_loop');
  expect(app.image.getAttribute('src')).toBe(cat.animations.idle.frames[0].file);
  expect(app.image.dataset.staticFallback).toBe('true'); expect(app.image.alt).toContain('暂无睡眠动画');
  expect(app.callbacks.size).toBe(0);
  document.dispatchEvent(new Event('visibilitychange')); expect(app.callbacks.size).toBe(0);
  expect(app.loads.mock.calls.every(([url]) => url.startsWith('./cat-animation-v2/cat-02/mobile/idle/'))).toBe(true);
  await app.control.updateState('idle'); expect(app.callbacks.size).toBe(1); app.control.destroy();
});
