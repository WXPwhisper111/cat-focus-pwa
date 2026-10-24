// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createAppUpdate, type UpdateReply } from '../src/app-update';
let controller: ReturnType<typeof createAppUpdate> | undefined;
afterEach(() => { controller?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(latest = 'a') {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  let version = latest; const worker = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), { active: worker, installing: null, waiting: null, update: vi.fn(async () => {}) });
  const container = Object.assign(new EventTarget(), { controller: worker, register: vi.fn(async () => registration) });
  const send = vi.fn(async (_worker: any, _action: string): Promise<UpdateReply> => ({ ok: true, version, entry: `https://test/assets/${version}.js`, media: { total: 0, cached: 0 }, remaining: 0 }));
  const reload = vi.fn(), hasActiveSession = vi.fn(async () => false), canReload = vi.fn(() => true);
  controller = createAppUpdate({ enabled: true, container: container as unknown as ServiceWorkerContainer, entry: 'https://test/assets/a.js', send, reload, hasActiveSession, canReload });
  return { controller, container, registration, send, reload, hasActiveSession, canReload, version(value: string) { version = value; } };
}
it('checks on startup, throttles foreground checks to 60 seconds and allows manual checks', async () => {
  const f = fixture(); await f.controller.start(); expect(f.container.register).toHaveBeenCalledWith('./sw.js', { updateViaCache: 'none' }); expect(f.controller.snapshot().phase).toBe('current');
  document.dispatchEvent(new Event('visibilitychange')); await f.controller.start(); expect(f.registration.update).toHaveBeenCalledOnce();
  await f.controller.check(); expect(f.registration.update).toHaveBeenCalledTimes(2); expect(f.reload).not.toHaveBeenCalled();
});
it('announces a newer active worker but reloads only after a user command and two fresh session checks', async () => {
  const f = fixture('b'); await f.controller.start(); expect(f.controller.snapshot().phase).toBe('ready'); expect(f.reload).not.toHaveBeenCalled();
  await Promise.all([f.controller.apply(), f.controller.apply()]); expect(f.reload).toHaveBeenCalledOnce(); expect(f.hasActiveSession).toHaveBeenCalledTimes(2);
});
it('never refreshes during a running or paused session, an open dialog, or a newly started session', async () => {
  const f = fixture('b'); await f.controller.start(); f.hasActiveSession.mockResolvedValue(true); await f.controller.apply(); expect(f.reload).not.toHaveBeenCalled();
  f.hasActiveSession.mockResolvedValue(false); f.canReload.mockReturnValue(false); await f.controller.apply(); expect(f.reload).not.toHaveBeenCalled();
  f.canReload.mockReturnValue(true); f.hasActiveSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true); await f.controller.apply(); expect(f.reload).not.toHaveBeenCalled();
});
it('keeps cached use available while offline and reports failures without forcing reload', async () => {
  const f = fixture(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); await f.controller.start(); expect(f.controller.snapshot().phase).toBe('offline'); expect(f.container.register).not.toHaveBeenCalled();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); f.container.register.mockRejectedValueOnce(Error('offline')); await f.controller.check(); expect(f.controller.snapshot().phase).toBe('error'); expect(f.reload).not.toHaveBeenCalled();
});
it('cleans lifecycle listeners on disposal', async () => {
  const f = fixture(); await f.controller.start(); const listener = vi.fn(); f.controller.subscribe(listener); const before = listener.mock.calls.length;
  f.controller.destroy(); window.dispatchEvent(new Event('online')); f.container.dispatchEvent(new Event('controllerchange')); document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve(); expect(listener.mock.calls).toHaveLength(before);
});

it('shows incomplete media accurately and retries without forcing page reload', async () => {
  const f = fixture(); let warmed = false;
  f.send.mockImplementation(async (_worker: any, action: string) => {
    if (action === 'WARM_MEDIA') {
      if (!warmed) return { ok: true, version: 'a', entry: 'https://test/assets/a.js', media: { total: 1, cached: 0 }, failed: ['./room/a.png'], remaining: 0 };
      return { ok: true, version: 'a', entry: 'https://test/assets/a.js', media: { total: 1, cached: 1 }, remaining: 0 };
    }
    return { ok: true, version: 'a', entry: 'https://test/assets/a.js', media: { total: 1, cached: warmed ? 1 : 0 } };
  });
  await f.controller.start(); await vi.waitFor(() => expect(f.controller.snapshot().mediaPhase).toBe('error'));
  warmed = true; f.controller.retryMedia(); await vi.waitFor(() => expect(f.controller.snapshot().mediaPhase).toBe('complete')); expect(f.reload).not.toHaveBeenCalled();
});

it('does not let a late old-worker response overwrite the newly controlling version', async () => {
  const f = fixture(); await f.controller.start();
  let resolveOld!: (reply: UpdateReply) => void;
  f.send.mockImplementationOnce(() => new Promise<UpdateReply>(resolve => { resolveOld = resolve; }));
  const checking = f.controller.check(); await vi.waitFor(() => expect(resolveOld).toBeDefined());
  f.version('b'); f.container.controller = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn() });
  f.container.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(f.controller.snapshot().latest).toBe('b'));
  resolveOld({ ok: true, version: 'a', entry: 'https://test/assets/a.js', media: { cached: 0, total: 0 } }); await checking;
  expect(f.controller.snapshot()).toMatchObject({ phase: 'ready', latest: 'b' }); expect(f.reload).not.toHaveBeenCalled();
});

it('binds release notes to each worker version and clears them for legacy workers without metadata',async()=>{
  const f=fixture('b');const release={id:'life',label:'猫咪日常更新',title:'陪伴有了更多小动作',summary:['新的动作']};
  f.send.mockImplementation(async()=>({ok:true,version:'b',entry:'https://test/assets/b.js',media:{total:0,cached:0},release}));await f.controller.start();expect(f.controller.snapshot().release).toEqual(release);
  f.send.mockImplementation(async()=>({ok:true,version:'c',entry:'https://test/assets/c.js',media:{total:0,cached:0}}));await f.controller.check();expect(f.controller.snapshot().latest).toBe('c');expect(f.controller.snapshot().release).toBeUndefined();
});
