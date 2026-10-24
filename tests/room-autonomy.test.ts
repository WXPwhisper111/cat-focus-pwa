import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { autonomyTiming, createRoomAutonomy, type AutonomyPort } from '../src/room-autonomy';
const schedulers: ReturnType<typeof createRoomAutonomy>[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { schedulers.splice(0).forEach(item => item.destroy()); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
function fixture() {
  const busy = new Set<string>(), jobs = new Map<string, { done(): void; reject(error: Error): void }>();
  const log: { id: string; action: string; time: number }[] = [];
  let selected: string | null = null;
  const run = (id: string, action: string, signal: AbortSignal) => {
    busy.add(id); log.push({ id, action, time: Date.now() });
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { signal.removeEventListener('abort', abort); busy.delete(id); jobs.delete(id); error ? reject(error) : resolve(); };
      const abort = () => finish(new DOMException('cancel', 'AbortError'));
      jobs.set(id, { done: () => finish(), reject: finish }); signal.addEventListener('abort', abort, { once: true });
    });
  };
  const port: AutonomyPort = {
    ids: ['a', 'b', 'c'], activeCount: () => busy.size, busy: id => busy.has(id), protectedCat: () => selected,
    available: () => true, execute: run, atFurniture: () => false, vacate: (id, signal) => run(id, 'home', signal),
  };
  const scheduler = createRoomAutonomy(port, { random: () => 0 }); schedulers.push(scheduler);
  return { scheduler, port, jobs, busy, log, select(id: string | null) { selected = id; scheduler.changed(); } };
}
it('uses one room timer, delays starts, spaces them and caps active cats at two', async () => {
  const app = fixture(); app.scheduler.setActive(true);
  expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(7999); expect(app.log).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(app.log).toEqual([{ id: 'a', action: 'eat', time: 8000 }]);
  await vi.advanceTimersByTimeAsync(5000); expect(app.log.map(entry => entry.id)).toEqual(['a','b']);
  await vi.advanceTimersByTimeAsync(60000); expect(app.log).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
  app.jobs.get('a')!.done(); await vi.advanceTimersByTimeAsync(0); expect(app.log.at(-1)!.id).toBe('c');
});
it('protects selected cats and defers new starts after furniture interaction', async () => {
  const app = fixture(); app.select('a'); app.scheduler.setActive(true);
  await vi.advanceTimersByTimeAsync(7000); app.scheduler.userInteraction();
  await vi.advanceTimersByTimeAsync(7999); expect(app.log).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(app.log[0].id).toBe('b');
  app.select(null); app.jobs.get('b')!.done(); await vi.advanceTimersByTimeAsync(5000); expect(app.log.at(-1)!.id).toBe('a');
});
it('applies completion cooldown, avoids repeated actions, and never chooses pet', async () => {
  const app = fixture(); app.port.ids = ['a']; app.scheduler.setActive(true);
  await vi.advanceTimersByTimeAsync(8000); app.jobs.get('a')!.done(); await vi.advanceTimersByTimeAsync(9999); expect(app.log).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(app.log[1].action).toBe('drink'); expect(app.log.every(entry => entry.action !== 'pet')).toBe(true);
});
it('pauses, cancels, and restarts with a fresh initial delay without catching up', async () => {
  const app = fixture(); app.scheduler.setActive(true); await vi.advanceTimersByTimeAsync(8000);
  app.scheduler.setActive(false); await vi.advanceTimersByTimeAsync(600000); expect(app.busy.size).toBe(0); expect(app.log).toHaveLength(1);
  app.scheduler.setActive(true); await vi.advanceTimersByTimeAsync(7999); expect(app.log).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(app.log).toHaveLength(2);
  app.scheduler.destroy(); await vi.advanceTimersByTimeAsync(600000); expect(app.busy.size).toBe(0); expect(app.log).toHaveLength(2);
});
it('does not poll busy/manual cats and recomputes cooldown after manual completion', async () => {
  const app = fixture(); app.port.ids = ['a']; app.busy.add('a'); app.scheduler.setActive(true);
  expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(20000); expect(app.log).toEqual([]);
  app.busy.delete('a'); app.scheduler.settled('a'); await vi.advanceTimersByTimeAsync(9999); expect(app.log).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(app.log).toHaveLength(1);
});
it('waits when furniture is unavailable without automatically returning cats to the rug', async () => {
  const app = fixture(); app.port.ids=['a']; app.port.available=()=>false; app.port.atFurniture=()=>true;
  app.scheduler.setActive(true); await vi.advanceTimersByTimeAsync(60000);
  expect(app.log).toEqual([]); expect(vi.getTimerCount()).toBe(1);
  app.port.available=()=>true; await vi.advanceTimersByTimeAsync(10000); expect(app.log).toHaveLength(1);
  expect(app.log[0].action).not.toBe('home');expect(autonomyTiming.maxActive).toBe(2);
});

it('records the last manual action and waits a cooldown before choosing a different autonomous action',async()=>{
  const app=fixture();app.port.ids=['a'];app.scheduler.setActive(true);app.scheduler.settled('a','eat');
  await vi.advanceTimersByTimeAsync(9999);expect(app.log).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);expect(app.log[0].action).toBe('drink');
});

it('waits a full cooldown after execution failure instead of retrying in a loop',async()=>{
  const app=fixture();app.port.ids=['a'];app.scheduler.setActive(true);await vi.advanceTimersByTimeAsync(8000);
  app.jobs.get('a')!.reject(Error('unavailable'));await vi.advanceTimersByTimeAsync(9999);expect(app.log).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);expect(app.log).toHaveLength(2);expect(app.log[1].action).not.toBe(app.log[0].action);
});

it('allows toilet only after its initial grace period and enforces the longer cooldown',async()=>{
  const app=fixture();app.port.ids=['a'];app.port.available=(_id,action)=>action==='toilet';app.scheduler.setActive(true);
  await vi.advanceTimersByTimeAsync(59999);expect(app.log).toEqual([]);await vi.advanceTimersByTimeAsync(8001);expect(app.log[0]?.action).toBe('toilet');
  app.jobs.get('a')!.done();await vi.advanceTimersByTimeAsync(119999);expect(app.log).toHaveLength(1);
  // The normal scheduler only wakes at its configured cooldown, never high-frequency polls.
  await vi.advanceTimersByTimeAsync(30000);expect(app.log).toHaveLength(1);
});
