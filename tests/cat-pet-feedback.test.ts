// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPetFeedback } from '../src/cat-pet-feedback';
import { createCatPlayer } from '../src/cat-player';
import { catDefinitions } from '../src/cat-definition';
import { getInteractionClip } from '../src/cat-interactions';
import { applyCatNames } from '../src/cat-names';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); applyCatNames({}); document.body.replaceChildren(); });
it('shows one feedback per actual cat, holds briefly on completion and clears interruptions/background/destroy', () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const scene = document.createElement('div'), feedback = createPetFeedback(scene);
  expect(scene.children).toHaveLength(0);
  feedback.event('a', 'pet:once', 'start'); feedback.position('a', [900, 400, 144, 144]);
  expect(scene.querySelector('.cat-pet-bubble.is-left')).not.toBeNull();
  feedback.event('b', 'pet:once', 'start'); expect(scene.children).toHaveLength(2);
  feedback.event('a', 'pet:once', 'complete'); feedback.event('a', 'pet:once', 'stop'); feedback.event('a', 'idle', 'start');
  vi.advanceTimersByTime(399); expect(scene.children).toHaveLength(2);
  vi.advanceTimersByTime(161); expect(scene.children).toHaveLength(1);
  feedback.event('b', 'pet:once', 'stop'); expect(scene.children).toHaveLength(0);
  feedback.event('a', 'pet:once', 'start'); window.dispatchEvent(new Event('pagehide')); expect(scene.children).toHaveLength(0);
  feedback.event('a', 'pet:once', 'start'); feedback.destroy(); expect(scene.children).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});
it('emits start only after load, refreshes names without restarting playback, and completes once', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const image = document.createElement('img'); let now = 0, next = 0;
  const callbacks = new Map<number, FrameRequestCallback>(); const events: string[] = [];
  const clip = getInteractionClip('orange-white', 'pet', 'once')!;
  let resolve!: () => void;
  const ready = { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  const second = createCatPlayer(image, 'idle', { definition: catDefinitions[0], onPlayback: (clip, event) => events.push(`${clip.id}:${event}`) }, {
    loadImage: async url => { if (url.includes('pet')) await ready.promise; }, now: () => now,
    requestFrame: cb => { callbacks.set(++next, cb); return next; }, cancelFrame: id => { callbacks.delete(id); },
  });
  await second.updateState('idle'); const playing = second.play(clip);
  expect(events).not.toContain('pet:once:start'); ready.resolve(); await playing;
  expect(events.filter(event => event === 'pet:once:start')).toHaveLength(1);
  const frame = image.dataset.frame; applyCatNames({ 'orange-white': '小布' }); second.refreshName();
  expect(image.alt).toBe('小布 · pet:once'); expect(image.dataset.frame).toBe(frame); expect(callbacks.size).toBe(1);
  now = clip.frames.reduce((total, frame) => total + frame.durationMs, 0);
  for (const [id, cb] of [...callbacks]) { callbacks.delete(id); cb(now); }
  expect(events.filter(event => event === 'pet:once:complete')).toHaveLength(1); expect(callbacks.size).toBe(0);
  second.destroy();
});
