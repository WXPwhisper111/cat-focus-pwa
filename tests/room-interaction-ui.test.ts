// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createRoomInteraction, type InteractionItem } from '../src/room-interaction';
import { createRoomInteractionPanel } from '../src/room-interaction-panel';
import { createRoomScene, roomHotspots } from '../src/room-scene';
import { catDefinitions } from '../src/cat-definition';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it('connects five accessible furniture buttons and three cats, keeping per-cat animation independent', async () => {
  let next = 0; const frames = new Map<number, FrameRequestCallback>();
  const controller = createRoomInteraction(catDefinitions.map(cat => cat.id));
  const panel = createRoomInteractionPanel(controller);
  const room = createRoomScene('idle', {
    cats: catDefinitions, hotspots: roomHotspots.filter(item => item.itemId !== 'curtains'),
    onCatAction: controller.selectCat, onItemAction: id => controller.selectItem(id as InteractionItem), onTargetAmbiguity: controller.disambiguate,
  }, { loadImage: async () => {}, requestFrame: callback => { frames.set(++next, callback); return next; }, cancelFrame: id => { frames.delete(id); } });
  const unsubscribe = controller.subscribe(state => room.setSelected(state.selectedCatId, state.itemId));
  document.body.append(room.element, panel.element);
  await room.updateState('idle'); expect(frames.size).toBe(3);
  expect(room.element.querySelectorAll('.room-item-hit')).toHaveLength(5);
  expect(room.element.querySelectorAll('.room-cat-hit')).toHaveLength(3);
  const press = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  press('[data-room-item=foodBowl]'); expect(panel.element.textContent).toContain('请选择互动猫咪');
  press('[data-interaction-choice="cat:cat-02"]');
  expect(panel.element.hidden).toBe(true);
  expect(room.element.querySelector('[data-room-cat-target=cat-02]')!.getAttribute('aria-pressed')).toBe('true');
  expect(panel.element.querySelector('.interaction-actions')).toBeNull();
  for (const cat of catDefinitions.slice(0,3)) { press(`[data-room-cat-target="${cat.id}"]`); expect(controller.snapshot().selectedCatId).toBe(cat.id); }
  await room.updateCatState('cat-02', 'sleep_loop');
  expect(room.element.querySelector('[data-room-cat=cat-02]')!.getAttribute('data-animation')).toBe('sleep_loop');
  expect(room.element.querySelector('[data-room-cat=cat-03]')!.getAttribute('data-animation')).toBe('idle');
  controller.close(); expect(panel.element.hidden).toBe(true);
  controller.disambiguate([{ kind: 'item', id: 'foodBowl' }, { kind: 'item', id: 'waterBowl' }]);
  expect(panel.element.textContent).toContain('这里有多个目标'); press('[data-interaction-choice="item:waterBowl"]');
  expect(controller.snapshot().itemId).toBe('waterBowl');
  unsubscribe(); panel.destroy(); controller.destroy(); room.destroy(); expect(frames.size).toBe(0);
  expect(room.element.querySelector('.room-scene')!.getAttribute('data-cat-id')).toBe('orange-white');
});
