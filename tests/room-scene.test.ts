// @vitest-environment jsdom
import { catDefinitions } from '../src/cat-definition';
import { afterEach, expect, it, vi } from 'vitest';
import { createRoomScene, roomCatRect, roomHotspots, roomLayout, roomMarkup, roomSprites, type RoomRuntime } from '../src/room-scene';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

function player(loadImage: RoomRuntime['loadImage'] = async () => {}) {
  let hidden = false, now = 0, next = 0;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const callbacks = new Map<number, FrameRequestCallback>();
  const runtime: RoomRuntime = {
    loadImage, now: () => now,
    requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => { callbacks.delete(id); },
  };
  const room = createRoomScene('idle', {}, runtime);
  document.body.append(room.element);
  return { room, callbacks, image: room.element.querySelector<HTMLImageElement>('#cat')!,
    visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    advance(value: number) {
      now = value;
      for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(now); }
    },
  };
}

it('uses the canonical layout and preserves every independent layer and dormant item IDs', () => {
  const host = document.createElement('div'); host.innerHTML = roomMarkup('idle');
  expect([...host.querySelectorAll('[data-room-object]')].map(element => element.getAttribute('data-room-object'))).toEqual(roomLayout.layers.map(layer => layer.id));
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(host.querySelectorAll('.room-contact-shadow span')).toHaveLength(3);
  expect(host.querySelector('[data-room-object=outside]')!.getAttribute('src')).toBe('./room/window_outside_day.png');
  expect(host.querySelector('#cat')!.getAttribute('style')).toContain('left:42.96875%');
  expect(roomCatRect('idle', 0)).toEqual([440, 572 + 54 * 144 / 1254, 144, 144]);
  for (const state of ['idle', 'sleep_loop'] as const) {
    for (const [index, frame] of roomSprites.states[state]!.frames.entries()) {
      const rect = roomCatRect(state, index);
      expect(rect.slice(2)).toEqual([144, 144]);
      expect(rect[0] + frame.sourceAnchor![0] * 144 / 1254).toBeCloseTo(512);
      expect(rect[1] + frame.sourceAnchor![1] * 144 / 1254).toBeCloseTo(716);
    }
  }
  const bowls = roomHotspots.filter(hotspot => hotspot.itemId.endsWith('Bowl'));
  expect(bowls).toHaveLength(2);
  expect(bowls.every(hotspot => hotspot.rect[2] < 128 && hotspot.rect[3] < 96 && hotspot.minTargetPx === 44)).toBe(true);
});

it('plays current idle with per-frame durations and sleeping at 150ms without extra animation loops', async () => {
  const { room, image, callbacks, advance } = player();
  await room.updateState('idle');
  expect(callbacks.size).toBe(1);
  advance(149); expect(image.dataset.frame).toBe('0');
  advance(150); expect(image.dataset.frame).toBe('1');
  await room.updateState('idle'); expect(callbacks.size).toBe(1);
  await room.updateState('sleep_loop');
  expect(image.alt).toContain('睡觉');
  expect(image.dataset.animation).toBe('sleep_loop');
  expect(image.style.left).toBe('42.96875%');
  advance(299); expect(image.dataset.frame).toBe('0');
  advance(300); expect(image.dataset.frame).toBe('1');
  expect(callbacks.size).toBe(1);
  room.destroy(); expect(callbacks.size).toBe(0);
});

it('stops while hidden or page-cached, resumes without catch-up, and removes listeners on destroy', async () => {
  const { room, image, callbacks, advance, visibility } = player();
  await room.updateState('idle'); advance(150);
  visibility(true); expect(callbacks.size).toBe(0);
  advance(100_000); expect(image.dataset.frame).toBe('1');
  visibility(false); expect(callbacks.size).toBe(1);
  advance(100_149); expect(image.dataset.frame).toBe('1');
  advance(100_150); expect(image.dataset.frame).toBe('2');
  window.dispatchEvent(new Event('pagehide')); expect(callbacks.size).toBe(0);
  window.dispatchEvent(new Event('pageshow')); expect(callbacks.size).toBe(1);
  room.destroy(); room.destroy();
  visibility(false); window.dispatchEvent(new Event('pageshow'));
  await room.updateState('sleep_loop'); expect(callbacks.size).toBe(0);
  expect(document.querySelector('.room-view')).toBeNull();
});

it('retains the current frame until the requested pose is decoded and rejects stale async changes', async () => {
  let release!: () => void;
  const sleeping = new Promise<void>(resolve => { release = resolve; });
  const { room, image, callbacks } = player(url => url.includes('sleep_loop') ? sleeping : Promise.resolve());
  await room.updateState('idle');
  const original = image.src;
  const pending = room.updateState('sleep_loop');
  expect(image.src).toBe(original);
  await room.updateState('idle');
  release(); await pending;
  expect(image.dataset.animation).toBe('idle');
  expect(callbacks.size).toBe(1);
  await room.updateState('sleep_loop'); expect(image.dataset.animation).toBe('sleep_loop');
  room.destroy();
});

it('does not restart after disposal while images are loading', async () => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  const { room, callbacks } = player(() => loading);
  const pending = room.updateState('sleep_loop'); room.destroy(); release(); await pending;
  expect(callbacks.size).toBe(0);
});

it('shows a non-blocking loading error and keeps the last good pose', async () => {
  const { room, image } = player(url => url.includes('sleep_loop') ? Promise.reject(Error('offline')) : Promise.resolve());
  await room.updateState('idle'); const original = image.src;
  await room.updateState('sleep_loop');
  expect(image.src).toBe(original);
  expect(room.element.querySelector<HTMLElement>('.room-error')!.hidden).toBe(false);
  expect(room.element.textContent).toContain('专注计时不受影响');
  room.destroy();
});

it('only enables explicit future hotspots when both definitions and a callback are supplied', () => {
  const onItemAction = vi.fn();
  const room = createRoomScene('idle', { hotspots: roomHotspots, onItemAction }, { loadImage: () => new Promise(() => {}) });
  const food = room.element.querySelector<HTMLButtonElement>('[data-room-item=foodBowl]')!;
  expect(food.style.minWidth).toBe('44px');
  food.click(); expect(onItemAction).toHaveBeenCalledWith('foodBowl');
  room.destroy();
});


it('positions restored cats before image decoding and keeps home slots independent of companion order', () => {
  const room = createRoomScene('idle', {}, { loadImage: () => new Promise(() => {}) });
  const image = room.element.querySelector<HTMLImageElement>('[data-room-cat]')!;
  room.behaviorPort.setFeet('orange-white', [200, 700]);
  expect(parseFloat(image.style.left)).toBeCloseTo((200 - 72) / 1024 * 100, 2);
  expect(parseFloat(image.style.top)).toBeCloseTo((700 - 144 * 1200 / 1254) / 768 * 100, 2);
  room.destroy();
});

it('updates residents without recreating remaining cats or moving their homes', async () => {
  const room=createRoomScene('idle',{cat:catDefinitions[3],cats:[catDefinitions[3],catDefinitions[4],catDefinitions[5]],onCatAction:()=>{}},{loadImage:async()=>{}});
  document.body.append(room.element);
  const kept=room.element.querySelector('[data-room-cat="cat-05"]');
  const home=room.behaviorPort.home('cat-05');
  room.updateResidents([catDefinitions[0],catDefinitions[4],catDefinitions[5]]);
  expect(room.element.querySelector('[data-room-cat="cat-05"]')).toBe(kept);
  expect(room.behaviorPort.home('cat-05')).toEqual(home);
  expect(room.element.querySelector('[data-room-cat="cat-04"]')).toBeNull();
  expect(room.element.querySelectorAll('[data-room-cat]')).toHaveLength(3);
  expect(room.element.querySelectorAll('[data-room-cat-target]')).toHaveLength(3);
  expect(room.behaviorPort.ids).toEqual(['orange-white','cat-05','cat-06']);
  room.destroy();
});
