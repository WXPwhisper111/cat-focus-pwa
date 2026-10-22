// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createRoomScene, roomThemeAt } from '../src/room-scene';
import { orangeWhiteCat } from '../src/cat-definition';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

it('uses local 07:00 and 19:00 boundaries including midnight', () => {
  for (const [hour, minute, second, expected] of [
    [0, 0, 0, 'night'], [6, 59, 59, 'night'], [7, 0, 0, 'day'],
    [18, 59, 59, 'day'], [19, 0, 0, 'night'], [23, 59, 59, 'night'],
  ] as const) expect(roomThemeAt(new Date(2026, 9, 20, hour, minute, second))).toBe(expected);
});

function environment(loadImage: (url: string) => Promise<void> = async () => {}) {
  let date = new Date(2026, 9, 20, 18, 59, 40), hidden = false, next = 0;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const room = createRoomScene('idle', {}, {
    loadImage, date: () => date, now: () => 0,
    requestFrame: callback => { frames.set(++next, callback); return next; },
    cancelFrame: id => { frames.delete(id); },
    setTimer: (callback, delay) => { timers.set(++next, { callback, delay }); return next as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: id => { timers.delete(id as unknown as number); },
  });
  document.body.append(room.element);
  return { room, frames, timers, scene: room.element.querySelector<HTMLElement>('.room-scene')!,
    setDate(value: Date) { date = value; },
    hidden(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    nextMinute() { const [id, entry] = [...timers][0]; timers.delete(id); entry.callback(); },
  };
}

it('changes the window and lighting at the boundary without moving layers or resetting the cat', async () => {
  const app = environment(); await flush();
  const positions = [...app.room.element.querySelectorAll('[data-room-object]')].map(el => el.getAttribute('style'));
  expect([...app.timers.values()][0].delay).toBe(20_000);
  expect(app.scene.dataset.theme).toBe('day');
  app.setDate(new Date(2026, 9, 20, 19)); app.nextMinute(); await flush();
  expect(app.scene.dataset.theme).toBe('night');
  expect(app.room.element.querySelector('[data-room-object=outside]')!.getAttribute('src')).toBe('./room/window_outside_night.png');
  expect(app.room.element.querySelector('[data-room-period]')!.textContent).toBe('夜晚');
  expect(app.scene.getAttribute('aria-label')).toContain('夜晚');
  expect([...app.room.element.querySelectorAll('[data-room-object]')].map(el => el.getAttribute('style'))).toEqual(positions);
  expect(app.room.element.querySelector('#cat')!.getAttribute('data-animation')).toBe('idle');
  expect(app.frames.size).toBe(1); expect(app.timers.size).toBe(1);
  app.room.destroy(); expect(app.frames.size).toBe(0); expect(app.timers.size).toBe(0);
});

it('checks local time again on foreground, focus and page-cache return, and disposes every task', async () => {
  const app = environment(); await flush();
  app.hidden(true); expect(app.frames.size).toBe(0); expect(app.timers.size).toBe(0);
  app.setDate(new Date(2026, 9, 20, 21)); app.hidden(false); await flush();
  expect(app.scene.dataset.theme).toBe('night');
  app.setDate(new Date(2026, 9, 21, 7)); window.dispatchEvent(new Event('focus')); await flush();
  expect(app.scene.dataset.theme).toBe('day');
  window.dispatchEvent(new Event('pagehide')); expect(app.frames.size).toBe(0); expect(app.timers.size).toBe(0);
  app.setDate(new Date(2026, 9, 21, 19)); window.dispatchEvent(new Event('pageshow')); await flush();
  expect(app.scene.dataset.theme).toBe('night');
  expect(app.timers.size).toBe(1); expect(app.frames.size).toBe(1);
  app.room.destroy(); app.hidden(false); window.dispatchEvent(new Event('focus'));
  expect(app.timers.size).toBe(0); expect(app.frames.size).toBe(0);
});

it('keeps the current theme until decoded and ignores a late change after disposal', async () => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  const app = environment(url => url.endsWith('window_outside_night.png') ? loading : Promise.resolve());
  await flush(); app.setDate(new Date(2026, 9, 20, 19));
  const pending = app.room.refreshEnvironment();
  expect(app.scene.dataset.theme).toBe('day');
  app.room.destroy(); release(); await pending;
  expect(app.scene.dataset.theme).toBe('day'); expect(app.timers.size).toBe(0); expect(app.frames.size).toBe(0);
});

it('supports an explicit development preview and a resource ID without creating residents or hotspots', async () => {
  const room = createRoomScene('idle', { theme: 'night', cat: { ...orangeWhiteCat, id: 'future-cat-resource' } }, {
    loadImage: async () => {}, requestFrame: () => 1, cancelFrame: () => {}, date: () => new Date(2026, 9, 20, 12),
  });
  await room.updateState('idle');
  expect(room.element.querySelector<HTMLElement>('.room-scene')!.dataset.catId).toBe('future-cat-resource');
  expect(room.element.querySelector<HTMLElement>('.room-scene')!.dataset.theme).toBe('night');
  expect(room.element.querySelectorAll('[data-room-object=cat]')).toHaveLength(1);
  expect(room.element.querySelectorAll('.room-hotspot')).toHaveLength(0);
  room.destroy();
});
