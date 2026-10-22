import { expect, it, vi } from 'vitest';
import { createRoomInteraction } from '../src/room-interaction';
import { resolveRoomTargets, type HitTarget } from '../src/room-hit-targets';
const ids = ['orange-white', 'cat-02', 'cat-03'];

it('defaults to a resident companion, falls back to the first resident and keeps manual selection after closing',()=>{
  const a=createRoomInteraction(ids,undefined,ids[1]);expect(a.snapshot().selectedCatId).toBe(ids[1]);
  a.selectCat(ids[2]);a.close();a.reconcile([...ids]);expect(a.snapshot().selectedCatId).toBe(ids[2]);a.destroy();
  const b=createRoomInteraction([ids[0]],undefined,ids[1]);expect(b.snapshot().selectedCatId).toBe(ids[0]);b.destroy();
});

it('selects each cat independently, resolves pending furniture, and disables unreleased actions', async () => {
  const controller = createRoomInteraction(ids);
  controller.selectItem('foodBowl');
  expect(controller.snapshot()).toMatchObject({ open: true, selectedCatId: null, itemId: 'foodBowl' });
  controller.choose({ kind: 'cat', id: ids[1] });
  expect(controller.snapshot()).toMatchObject({ selectedCatId: ids[1], itemId: 'foodBowl' });
  expect(await controller.request('eat')).toEqual({ started: false, reason: '尚未开放' });
  for (const id of ids) {
    controller.selectCat(id); expect(controller.snapshot().selectedCatId).toBe(id);
    expect(Object.values(controller.snapshot().behaviors).every(state => state.phase === 'idle')).toBe(true);
  }
  controller.selectCat('missing'); expect(controller.snapshot().selectedCatId).toBe(ids[2]);
  controller.close(); expect(controller.snapshot()).toMatchObject({ open: false, selectedCatId: ids[2], itemId: null });
  controller.destroy();
});

it('serializes behavior for each cat while another cat can act, then cancels stale completions', async () => {
  const pending: (() => void)[] = [], signals: AbortSignal[] = [];
  const controller = createRoomInteraction(ids, { actions: ['sleep'], run: (_id, _action, _item, signal) => { signals.push(signal); return new Promise(resolve => pending.push(resolve)); } });
  const listener = vi.fn(); controller.subscribe(listener);
  controller.selectCat(ids[0]); const first = controller.request('sleep');
  expect(controller.snapshot().behaviors[ids[0]].phase).toBe('acting');
  expect(await controller.request('sleep')).toMatchObject({ started: false });
  controller.selectCat(ids[1]); const second = controller.request('sleep');
  expect(controller.snapshot().behaviors[ids[1]].phase).toBe('acting');
  expect(controller.snapshot().behaviors[ids[2]].phase).toBe('idle');
  controller.cancel(ids[0]); expect(signals[0].aborted).toBe(true);
  controller.selectCat(ids[0]); expect(await controller.request('sleep')).toMatchObject({ started: false });
  expect(controller.snapshot().behaviors[ids[0]].phase).toBe('recovering');
  pending[0](); await first;
  const third = controller.request('sleep'); expect(controller.snapshot().behaviors[ids[0]].phase).toBe('acting');
  pending[1](); await second; expect(controller.snapshot().behaviors[ids[1]].phase).toBe('idle');
  controller.destroy(); const calls = listener.mock.calls.length;
  expect(signals[2].aborted).toBe(true); pending[2](); await third; expect(listener).toHaveBeenCalledTimes(calls);
});

it('reconciles stable IDs without losing selection on reordering and removes departed cats', () => {
  const controller = createRoomInteraction(ids); controller.selectCat(ids[1]); controller.selectItem('bed');
  controller.reconcile([ids[2], ids[1], ids[0]]);
  expect(controller.snapshot()).toMatchObject({ selectedCatId: ids[1], itemId: 'bed' });
  controller.reconcile([ids[0], ids[0], 'unknown']);
  expect(controller.snapshot()).toMatchObject({ residentIds: [ids[0]], selectedCatId: null });
  expect(Object.keys(controller.snapshot().behaviors)).toEqual([ids[0]]);
  controller.destroy(); controller.selectCat(ids[0]);
  expect(controller.availability(ids[0], 'pet')).toBeTruthy();
});

it('rejects mismatched furniture and restores idle after executor failure', async () => {
  const controller = createRoomInteraction(ids, { actions: ['eat'], run: async () => { throw Error('test failure'); } });
  controller.selectCat(ids[0]); controller.selectItem('waterBowl');
  expect(await controller.request('eat')).toMatchObject({ started: false, reason: '行为与家具不匹配' });
  controller.selectItem('foodBowl'); await expect(controller.request('eat')).rejects.toThrow('test failure');
  expect(controller.snapshot().behaviors[ids[0]].phase).toBe('idle'); controller.destroy();
});

it('resolves actual bowls before expanded targets and explicitly returns ambiguous touch targets', () => {
  const targets: HitTarget[] = [
    { target: { kind: 'item', id: 'foodBowl' }, rect: [780, 652, 81, 34], minTargetPx: 44 },
    { target: { kind: 'item', id: 'waterBowl' }, rect: [875, 652, 81, 34], minTargetPx: 44 },
  ];
  for (const width of [280, 350, 390, 640]) {
    expect(resolveRoomTargets(targets, 820, 669, width)).toEqual([{ kind: 'item', id: 'foodBowl' }]);
    expect(resolveRoomTargets(targets, 915, 669, width)).toEqual([{ kind: 'item', id: 'waterBowl' }]);
  }
  expect(resolveRoomTargets(targets, 869, 693, 280)).toHaveLength(2);
  expect(resolveRoomTargets(targets, 50, 50, 280)).toEqual([]);
  expect(resolveRoomTargets(targets, 820, 669, 0)).toEqual([]);
});

it('prioritizes visible cats above the rug, without swallowing visible furniture with enlarged cat bounds', () => {
  const targets: HitTarget[] = [
    { target: { kind: 'item', id: 'rug' }, rect: [300, 620, 400, 80], minTargetPx: 44 },
    { target: { kind: 'cat', id: ids[0] }, rect: [450, 580, 100, 130], minTargetPx: 44 },
  ];
  expect(resolveRoomTargets(targets, 500, 670, 280)).toEqual([{ kind: 'cat', id: ids[0] }]);
  expect(resolveRoomTargets(targets, 570, 670, 280)).toEqual([{ kind: 'item', id: 'rug' }]);
});

it('keeps a bowl reachable when its current cat overlaps the visible furniture hotspot',()=>{
  const targets:HitTarget[]=[
    {target:{kind:'cat',id:ids[0]},rect:[800,540,110,130],minTargetPx:44},
    {target:{kind:'item',id:'waterBowl'},rect:[875,652,81,34],minTargetPx:44},
  ];
  expect(resolveRoomTargets(targets,900,660,320)).toEqual([{kind:'item',id:'waterBowl'}]);
  expect(resolveRoomTargets(targets,850,590,320)).toEqual([{kind:'cat',id:ids[0]}]);
});
