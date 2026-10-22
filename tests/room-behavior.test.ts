// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createRoomBehavior, type BehaviorPort } from '../src/room-behavior';
import { behaviorPlan } from '../src/room-behavior-config';
import { getInteractionClip } from '../src/cat-interactions';
import type { AnimationPoint } from '../src/cat-animation';
import type { PlayOptions } from '../src/cat-player';
const ids = ['orange-white', 'cat-02', 'cat-03'];
const runners: ReturnType<typeof createRoomBehavior>[] = [];
afterEach(() => { runners.splice(0).forEach(runner => runner.destroy()); });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture() {
  const homes = new Map<string, AnimationPoint>([[ids[0], [512, 716]], [ids[1], [365, 688]], [ids[2], [659, 688]]]);
  const positions = new Map(homes), nodes = new Map(ids.map(id => [id, document.createElement('div')]));
  const pending = new Map<string, PlayOptions>(), played: string[] = [];
  const port: BehaviorPort = {
    ids, home: id => homes.get(id)!, getFeet: id => positions.get(id)!, setFeet: (id, point) => { positions.set(id, point); },
    positions: () => positions, fadeElements: id => [nodes.get(id)!], preload: vi.fn(async () => {}),
    play: vi.fn(async (id, clip, options = {}) => { played.push(`${id}/${clip.id}`); pending.set(id, options); return { status: 'started' as const }; }),
    stop: vi.fn(id => { pending.delete(id); }), idle: vi.fn(async () => {}),
  };
  const teleport = { move: vi.fn(async (id: string, target: AnimationPoint, _signal: AbortSignal, placed?: () => Promise<void>) => { port.setFeet(id, target); await placed?.(); }), isMoving: () => false, destroy: vi.fn() };
  const runner = createRoomBehavior(port, { teleport }); runners.push(runner);
  return { port, teleport, runner, positions, nodes, pending, played, finish(id = ids[0]) { pending.get(id)?.onComplete?.(); } };
}

it('all cats complete real loops, return home and release action occupancy', async () => {
  for (const id of ids) for (const action of ['eat', 'drink', 'scratch', 'sleep'] as const) {
    const app = fixture(), stages: string[] = [];
    const running = app.runner.execute({ catId: id, behavior: action, source: 'manual' }, new AbortController().signal, stage => stages.push(stage));
    await flush(); expect(app.runner.stage(id)).toBe('loop'); expect(app.runner.anchors.snapshot()).toHaveLength(1);
    expect(app.positions.get(id)).not.toEqual(app.port.home(id)); expect(app.pending.get(id)!.iterations).toBe(2);
    app.finish(id); await running;
    expect(app.positions.get(id)).toEqual(app.port.home(id)); expect(app.runner.anchors.snapshot()).toHaveLength(0);
    expect(stages).toEqual(['loading', 'teleporting', 'loop', 'recovering', 'recovering']);
    expect(app.played).toHaveLength(1); app.runner.destroy();
  }
});

it('queues the latest manual command during teleport without cutting fade-in or starting the stale action', async () => {
  const app = fixture(); let finishMove!: () => void;
  app.teleport.move.mockImplementationOnce(async (id, target) => { await new Promise<void>(resolve => { finishMove = resolve; }); app.port.setFeet(id, target); });
  const first = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal);
  const replaced = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await flush(); expect(app.played).toEqual([]); expect(app.runner.stage(ids[0])).toBe('teleporting');
  const second = app.runner.execute({ catId: ids[0], behavior: 'drink', source: 'manual' }, new AbortController().signal);
  await flush(); expect(app.teleport.move).toHaveBeenCalledTimes(1); expect(app.played).toEqual([]);
  finishMove(); await replaced; await flush(); expect(app.played).toHaveLength(1); expect(app.played[0]).toContain('drink');
  app.finish(); await second; expect(app.runner.anchors.snapshot()).toEqual([]);
});

it('plays pet once in place and keeps other cats independent', async () => {
  const app = fixture();
  const pet = app.runner.execute({ catId: ids[0], behavior: 'pet', source: 'manual' }, new AbortController().signal);
  const eat = app.runner.execute({ catId: ids[1], behavior: 'eat', source: 'manual' }, new AbortController().signal);
  await flush(); expect(app.runner.stage(ids[0])).toBe('once'); expect(app.pending.get(ids[0])!.iterations).toBeUndefined();
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));
  app.finish(); await pet; expect(app.runner.stage(ids[1])).toBe('loop'); app.finish(ids[1]); await eat;
});

it('hands occupied food furniture to the manual action cat without waiting for the other loop', async () => {
  const app = fixture();
  const eat = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal);
  const interrupted = expect(eat).rejects.toMatchObject({ name: 'AbortError' }); await flush();
  const drink = app.runner.execute({ catId: ids[1], behavior: 'drink', source: 'manual' }, new AbortController().signal);
  await interrupted; await flush();
  expect(app.runner.stage(ids[1])).toBe('loop'); expect(app.runner.stage(ids[0])).toBeUndefined();
  expect(app.positions.get(ids[0])).not.toEqual(app.positions.get(ids[1]));
  expect(app.runner.anchors.snapshot().map(lease=>lease.catId)).toEqual([ids[1]]);
  app.finish(ids[1]); await drink; expect(app.runner.anchors.snapshot()).toEqual([]);
});

it('cancels a loop back at home and permits the next action', async () => {
  const app = fixture(), abort = new AbortController();
  const running = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, abort.signal);
  const cancelled = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await flush(); abort.abort(); await cancelled;
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0])); expect(app.runner.anchors.snapshot()).toHaveLength(0);
  const drink = app.runner.execute({ catId: ids[0], behavior: 'drink', source: 'manual' }, new AbortController().signal); await flush(); app.finish(); await drink;
});

it('composes optional real stages in order without adding fake enter/exit to the V2 catalogue', async () => {
  const app = fixture(), sample = getInteractionClip(ids[0], 'pet')!;
  app.runner.destroy();
  const runner = createRoomBehavior(app.port, { teleport: app.teleport, plan: (id, action) => ({ ...behaviorPlan(id, action)!, enter: sample, exit: sample }) }); runners.push(runner);
  const stages: string[] = [], running = runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal, stage => stages.push(stage));
  await flush(); expect(runner.stage(ids[0])).toBe('enter'); app.finish(); await flush();
  expect(runner.stage(ids[0])).toBe('loop'); app.finish(); await flush();
  expect(runner.stage(ids[0])).toBe('exit'); app.finish(); await running;
  expect(stages.filter(stage => ['enter', 'loop', 'exit'].includes(stage))).toEqual(['enter', 'loop', 'exit']);
});

it('load failure, pending-load cancellation and destroy cannot strand leases or transparency', async () => {
  const app = fixture(); vi.mocked(app.port.preload).mockRejectedValueOnce(Error('decode failed'));
  await expect(app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal)).rejects.toThrow('decode');
  expect(app.runner.anchors.snapshot()).toEqual([]);
  let release!: () => void; vi.mocked(app.port.preload).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const abort = new AbortController(), loading = app.runner.execute({ catId: ids[0], behavior: 'drink', source: 'manual' }, abort.signal);
  const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' }); await flush(); abort.abort(); await rejected;
  release(); await flush(); expect(app.played).toEqual([]); expect(app.runner.anchors.snapshot()).toEqual([]);
  const running = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal);
  const destroyed = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await flush(); app.nodes.get(ids[0])!.style.opacity = '0';
  app.runner.destroy(); await destroyed; expect(app.nodes.get(ids[0])!.style.opacity).toBe('1'); expect(app.runner.anchors.snapshot()).toEqual([]);
});

it('manual requests safely interrupt an explicitly supplied autonomous loop, without creating a scheduler', async () => {
  const app = fixture();
  const automatic = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'autonomous' }, new AbortController().signal);
  const interrupted = expect(automatic).rejects.toMatchObject({ name: 'AbortError' }); await flush();
  const manual = app.runner.execute({ catId: ids[0], behavior: 'drink', source: 'manual' }, new AbortController().signal);
  await interrupted; await flush(); expect(app.played.at(-1)).toContain('drink'); app.finish(); await manual;
});

it('releases furniture and naturally returns home without requiring another request', async () => {
  const app = fixture();
  const run = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'autonomous' }, new AbortController().signal);
  await flush(); app.finish(); await run;
  expect(app.runner.locations()).toEqual({}); expect(app.runner.available(ids[1], 'drink')).toBe(true);
  expect(app.runner.available(ids[1], 'sleep')).toBe(true); expect(app.runner.activeCount()).toBe(0);
  await app.runner.vacate(ids[0], new AbortController().signal);
  expect(app.runner.locations()).toEqual({}); expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0])); expect(app.runner.available(ids[1], 'drink')).toBe(true);
});
it('queues manual priority until an autonomous fade has fully completed', async () => {
  const app = fixture(); let fadeIn!: () => void;
  app.teleport.move.mockImplementationOnce(async (id, point) => { await new Promise<void>(resolve => { fadeIn = resolve; }); app.port.setFeet(id, point); });
  const automatic = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'autonomous' }, new AbortController().signal);
  const cancelled = expect(automatic).rejects.toMatchObject({ name: 'AbortError' }); await flush();
  const manual = app.runner.execute({ catId: ids[0], behavior: 'drink', source: 'manual' }, new AbortController().signal);
  await flush(); expect(app.played).toEqual([]); expect(app.teleport.move).toHaveBeenCalledTimes(1);
  fadeIn(); await cancelled; await flush(); expect(app.played).toHaveLength(1); expect(app.played[0]).toContain('drink'); app.finish(); await manual;
});
it('enforces the global cap and gives a third manual cat a slot by safely retiring an autonomous loop', async () => {
  const app = fixture();
  const first = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'autonomous' }, new AbortController().signal);
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = app.runner.execute({ catId: ids[1], behavior: 'sleep', source: 'autonomous' }, new AbortController().signal);
  await flush(); expect(app.runner.activeCount()).toBe(2);
  await expect(app.runner.execute({ catId: ids[2], behavior: 'scratch', source: 'autonomous' }, new AbortController().signal)).rejects.toThrow('两只');
  const manual = app.runner.execute({ catId: ids[2], behavior: 'scratch', source: 'manual' }, new AbortController().signal);
  await cancelled; await flush(); expect(app.runner.activeCount()).toBe(2); app.finish(ids[1]); app.finish(ids[2]); await Promise.all([second, manual]);
});
it('suspends jobs without losing committed positions, opacity or idle ownership', async () => {
  const app = fixture();
  const running = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'autonomous' }, new AbortController().signal);
  const cancelled = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await flush(); const stable = app.positions.get(ids[0]);
  app.nodes.get(ids[0])!.style.opacity = '0'; await app.runner.setSuspended(true); await cancelled;
  expect(app.runner.activeCount()).toBe(0); expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0])); expect(app.runner.locations()).toEqual({}); expect(app.nodes.get(ids[0])!.style.opacity).toBe('1');
  expect(app.runner.available(ids[1], 'sleep')).toBe(false); await app.runner.setSuspended(false); expect(app.runner.available(ids[1], 'sleep')).toBe(true);
});
it('restores stable positions without permitting missing resources, unequipped items or conflicting anchors', () => {
  const app = fixture(); app.runner.destroy(); const onLocations = vi.fn();
  const runner = createRoomBehavior(app.port, { teleport: app.teleport, initialLocations: { [ids[0]]: 'food-0', [ids[1]]: 'water-0', [ids[2]]: 'bed-0' }, onLocations,
    equipped: item => item !== 'bed' }); runners.push(runner);
  expect(runner.locations()).toEqual({}); expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0])); expect(app.positions.get(ids[1])).toEqual(app.port.home(ids[1])); expect(runner.available(ids[2], 'sleep')).toBe(false); expect(onLocations).not.toHaveBeenCalled();
});

it('failed replay preserves the home position without occupying the furniture', async () => {
  const app = fixture();
  const initial = app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal);
  await flush(); app.finish(); await initial;
  vi.mocked(app.port.preload).mockRejectedValueOnce(Error('offline'));
  await expect(app.runner.execute({ catId: ids[0], behavior: 'eat', source: 'manual' }, new AbortController().signal)).rejects.toThrow('offline');
  expect(app.runner.anchors.snapshot()).toHaveLength(0); expect(app.runner.available(ids[1], 'drink')).toBe(true);
  await app.runner.vacate(ids[0], new AbortController().signal); expect(app.runner.anchors.snapshot()).toEqual([]);
});

it('deduplicates repeated commands at the same furniture without restarting the player', async () => {
  const app=fixture(), request={catId:ids[0],behavior:'drink' as const,source:'manual' as const};
  const first=app.runner.execute(request,new AbortController().signal);await flush();
  const second=app.runner.execute(request,new AbortController().signal);expect(second).toBe(first);
  expect(app.played).toHaveLength(1);app.finish();await Promise.all([first,second]);expect(app.runner.anchors.snapshot()).toEqual([]);
});
it('finishes the exit stage then runs only the last valid command received during exit', async () => {
  const app=fixture(), sample=getInteractionClip(ids[0],'pet')!;app.runner.destroy();
  const runner=createRoomBehavior(app.port,{teleport:app.teleport,plan:(id,action)=>({...behaviorPlan(id,action)!,exit:sample})});runners.push(runner);
  const first=runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);
  const replaced=expect(first).rejects.toMatchObject({name:'AbortError'});await flush();
  const second=runner.execute({catId:ids[0],behavior:'drink',source:'manual'},new AbortController().signal);
  const skipped=expect(second).rejects.toMatchObject({name:'AbortError'});await flush();expect(runner.stage(ids[0])).toBe('exit');
  const before=app.teleport.move.mock.calls.length;
  const third=runner.execute({catId:ids[0],behavior:'scratch',source:'manual'},new AbortController().signal);
  await flush();expect(runner.stage(ids[0])).toBe('exit');expect(app.teleport.move).toHaveBeenCalledTimes(before);
  app.finish();await replaced;await skipped;await flush();
  expect(app.played.some(value=>value.includes('drink'))).toBe(false);expect(app.played.at(-1)).toContain('scratch');
  app.finish();await flush();expect(runner.stage(ids[0])).toBe('exit');app.finish();await third;
  expect(runner.anchors.snapshot()).toEqual([]);expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));
});
it('serializes two cats requesting the same water bowl and sends its previous user home', async () => {
  const app=fixture();
  const a=app.runner.execute({catId:ids[0],behavior:'drink',source:'manual'},new AbortController().signal);
  const interrupted=expect(a).rejects.toMatchObject({name:'AbortError'});await flush();
  const b=app.runner.execute({catId:ids[1],behavior:'drink',source:'manual'},new AbortController().signal);
  await interrupted;await flush();expect(app.runner.anchors.snapshot().map(value=>value.catId)).toEqual([ids[1]]);
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));expect(app.runner.stage(ids[0])).toBeUndefined();
  app.finish(ids[1]);await b;expect(app.runner.anchors.snapshot()).toEqual([]);
});
it('rejects an invalid new target without interrupting the current valid action', async()=>{
  const app=fixture();const current=app.runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);await flush();
  await expect(app.runner.execute({catId:ids[0],behavior:'drink',itemId:'bed',source:'manual'},new AbortController().signal)).rejects.toThrow();
  expect(app.runner.stage(ids[0])).toBe('loop');expect(app.played).toHaveLength(1);app.finish();await current;
});
it('restores default homes and permits return to a rug already holding the other two cats',async()=>{
  const app=fixture();const run=app.runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);await flush();app.finish();await run;
  const locations=app.runner.locations(), point=app.positions.get(ids[0]);app.runner.destroy();
  const runner=createRoomBehavior(app.port,{teleport:app.teleport,initialLocations:locations});runners.push(runner);
  expect(runner.locations()).toEqual(locations);expect(app.positions.get(ids[0])).toEqual(point);expect(runner.anchors.snapshot()).toEqual([]);
  await runner.execute({catId:ids[0],behavior:'return-home',source:'manual'},new AbortController().signal);
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));expect(app.positions.get(ids[1])).toEqual(app.port.home(ids[1]));expect(app.positions.get(ids[2])).toEqual(app.port.home(ids[2]));
});

it('recovers a failed departure fade without leaving opacity or furniture locked',async()=>{
  const app=fixture();app.teleport.move.mockImplementationOnce(async(id,point)=>{app.port.setFeet(id,point);});
  app.teleport.move.mockRejectedValueOnce(Error('fade failed'));
  const run=app.runner.execute({catId:ids[0],behavior:'drink',source:'manual'},new AbortController().signal);await flush();app.finish();await run;
  expect(app.runner.anchors.snapshot()).toEqual([]);expect(app.nodes.get(ids[0])!.style.opacity).toBe('1');
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));expect(app.runner.available(ids[1],'drink')).toBe(true);
});

it('switches eat to scratch with exactly one direct transfer and no intermediate idle or home',async()=>{
  const app=fixture();const first=app.runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);
  const replaced=expect(first).rejects.toMatchObject({name:'AbortError'});await flush();
  const origin=app.positions.get(ids[0]);vi.mocked(app.port.idle).mockClear();app.teleport.move.mockClear();
  const next=app.runner.execute({catId:ids[0],behavior:'scratch',source:'manual'},new AbortController().signal);
  await replaced;await flush();expect(app.runner.stage(ids[0])).toBe('loop');
  expect(app.teleport.move).toHaveBeenCalledTimes(1);expect(app.teleport.move.mock.calls[0][1]).not.toEqual(app.port.home(ids[0]));
  expect(app.positions.get(ids[0])).not.toEqual(origin);expect(app.port.idle).not.toHaveBeenCalled();
  app.finish();await next;expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));
});
it('keeps the old furniture locked until its displaced user has actually reached the rug',async()=>{
  const app=fixture();const first=app.runner.execute({catId:ids[0],behavior:'drink',source:'manual'},new AbortController().signal);
  const displaced=expect(first).rejects.toMatchObject({name:'AbortError'});await flush();
  let finishHome!:()=>void;app.teleport.move.mockImplementationOnce(async(id,target)=>{await new Promise<void>(resolve=>finishHome=resolve);app.port.setFeet(id,target);});
  const next=app.runner.execute({catId:ids[1],behavior:'drink',source:'manual'},new AbortController().signal);await flush();
  expect(app.runner.anchors.snapshot().map(value=>value.catId)).toEqual([ids[0]]);expect(app.played.filter(value=>value.startsWith(ids[1]))).toEqual([]);
  finishHome();await displaced;await flush();expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));
  expect(app.runner.anchors.snapshot().map(value=>value.catId)).toEqual([ids[1]]);app.finish(ids[1]);await next;
});
it('serializes crossed manual handovers without deadlock or overlapping leases',async()=>{
  const app=fixture();
  const a=app.runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);
  const b=app.runner.execute({catId:ids[1],behavior:'sleep',source:'manual'},new AbortController().signal);
  const interruptedA=expect(a).rejects.toMatchObject({name:'AbortError'}),interruptedB=expect(b).rejects.toMatchObject({name:'AbortError'});await flush();await flush();
  const aNext=app.runner.execute({catId:ids[0],behavior:'sleep',source:'manual'},new AbortController().signal);
  const bNext=app.runner.execute({catId:ids[1],behavior:'eat',source:'manual'},new AbortController().signal);
  await Promise.all([interruptedA,interruptedB]);await flush();await flush();
  expect(app.runner.stage(ids[0])).toBe('loop');expect(app.runner.stage(ids[1])).toBe('loop');
  expect(new Set(app.runner.anchors.snapshot().map(value=>value.anchor.group)).size).toBe(2);
  app.finish(ids[0]);app.finish(ids[1]);await Promise.all([aNext,bNext]);expect(app.runner.anchors.snapshot()).toEqual([]);
});
it('returns a replacement with failed loading to home and frees the previous furniture',async()=>{
  const app=fixture();const first=app.runner.execute({catId:ids[0],behavior:'eat',source:'manual'},new AbortController().signal);
  const replaced=expect(first).rejects.toMatchObject({name:'AbortError'});await flush();vi.mocked(app.port.preload).mockRejectedValueOnce(Error('offline target'));
  const next=app.runner.execute({catId:ids[0],behavior:'drink',source:'manual'},new AbortController().signal);
  await expect(next).rejects.toThrow('offline target');await replaced;
  expect(app.positions.get(ids[0])).toEqual(app.port.home(ids[0]));expect(app.runner.anchors.snapshot()).toEqual([]);expect(app.runner.busy(ids[0])).toBe(false);
});
