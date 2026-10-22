export type UpdateReply = { ok: boolean; version: string; entry: string; media: { total: number; cached: number }; failed?: string[]; remaining?: number };
export type UpdateState = { phase: 'idle' | 'checking' | 'current' | 'ready' | 'offline' | 'error' | 'unsupported'; current: string; latest: string; message: string; applying: boolean; mediaPhase: 'pending' | 'downloading' | 'complete' | 'paused' | 'error'; cached: number; total: number };
export type UpdateOptions = { enabled: boolean; hasActiveSession: () => Promise<boolean>; canReload: () => boolean; reload?: () => void; container?: ServiceWorkerContainer; entry?: string; send?: (worker: ServiceWorker, action: string, payload?: object) => Promise<UpdateReply> };
export function workerMessage(worker: ServiceWorker, action: string, payload: object = {}, signal?: AbortSignal): Promise<UpdateReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer); channel.port1.close(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(Error('更新检查已取消')); };
    const timer = setTimeout(() => { finish(); reject(Error('更新响应超时')); }, action === 'WARM_MEDIA' ? 75_000 : 8000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = event => { finish(); event.data?.ok ? resolve(event.data) : reject(Error('更新资源暂未准备好')); };
    try { worker.postMessage({ type: 'CAT_FOCUS_UPDATE', action, ...payload }, [channel.port2]); }
    catch (error) { finish(); reject(error); }
  });
}
export function createAppUpdate(options: UpdateOptions) {
  const container = options.container ?? navigator.serviceWorker;
  const entry = options.entry ?? (document.querySelector<HTMLScriptElement>('script[type=module][src]')?.src || '');
  const localVersion = entry.split('/').pop()?.replace(/^index-|\.js$/g, '') || '当前页面';
  let cancellation = new AbortController();
  const send = options.send || ((worker: ServiceWorker, action: string, payload?: object) => workerMessage(worker, action, payload, cancellation.signal));
  const state: UpdateState = { phase: options.enabled && container ? 'idle' : 'unsupported', current: localVersion, latest: '', message: '', applying: false, mediaPhase: 'pending', cached: 0, total: 0 };
  const listeners = new Set<(state: UpdateState) => void>();
  const watched = new Map<ServiceWorker, () => void>();
  let registration: ServiceWorkerRegistration | undefined, registering: Promise<ServiceWorkerRegistration> | undefined;
  let checking: Promise<void> | undefined, warming: Promise<void> | undefined, lastCheck = -Infinity, destroyed = false;
  let generation = 0, probeRevision = 0;
  const failed = new Set<string>();
  const emit = () => { if (!destroyed) listeners.forEach(listener => listener({ ...state })); };
  const worker = () => container?.controller || registration?.active;
  function applyReply(reply: UpdateReply) {
    if (state.latest !== reply.version) { generation++; failed.clear(); }
    state.latest = reply.version; state.cached = reply.media.cached; state.total = reply.media.total;
    if (reply.entry === entry) state.current = reply.version;
    state.phase = entry && reply.entry !== entry ? 'ready' : 'current';
    if (state.cached === state.total) state.mediaPhase = 'complete';
    emit();
  }
  async function probe() {
    const active = worker(); if (!active) return;
    const revision = ++probeRevision;
    try { const reply = await send(active, 'STATUS', { entry }); if (!destroyed && revision === probeRevision && active === worker()) applyReply(reply); }
    catch (error) { if (!destroyed && revision === probeRevision && active === worker()) throw error; }
  }
  function watch(candidate: ServiceWorker | null) {
    if (!candidate || watched.has(candidate)) return;
    let activated = candidate.state === 'activated';
    const changed = () => {
      if (candidate.state === 'activated') { activated = true; void probe().then(() => warm()).catch(() => { if (!destroyed) { state.message = '更新状态暂未读取成功，可手动重试。'; emit(); } }); }
      else if (candidate.state === 'redundant' && !activated) { state.phase = 'error'; state.message = '新版核心资源下载未完成，当前版本仍可使用，请重试。'; emit(); }
    };
    candidate.addEventListener('statechange', changed); watched.set(candidate, changed);
  }
  const updateFound = () => watch(registration?.installing || null);
  async function ensureRegistration() {
    if (!registering) registering = container.register('./sw.js', { updateViaCache: 'none' }).catch(error => { registering = undefined; throw error; });
    const result = await registering;
    if (destroyed) throw Error('更新检查已取消');
    registration = result;
    registration.removeEventListener('updatefound', updateFound); registration.addEventListener('updatefound', updateFound);
    watch(registration.installing); watch(registration.waiting); return registration;
  }
  function warm(): Promise<void> {
    if (warming || destroyed || !state.latest || state.phase === 'unsupported' || document.hidden || navigator.onLine === false || !worker()) return warming || Promise.resolve();
    const runGeneration = generation;
    warming = (async () => {
      try {
        while (!destroyed && !document.hidden && navigator.onLine !== false && runGeneration === generation) {
          if (state.total && state.cached === state.total) { state.mediaPhase = 'complete'; emit(); return; }
          state.mediaPhase = 'downloading'; emit();
          const active = worker(); if (!active) return;
          const reply = await send(active, 'WARM_MEDIA', { skip: [...failed] });
          if (destroyed || active !== worker() || runGeneration !== generation) return;
          for (const path of reply.failed || []) failed.add(path);
          applyReply(reply);
          if (runGeneration !== generation) return;
          if (reply.media.cached === reply.media.total) { state.mediaPhase = 'complete'; emit(); return; }
          if (!reply.remaining) { state.mediaPhase = 'error'; emit(); return; }
        }
        if (!destroyed) { state.mediaPhase = 'paused'; emit(); }
      } catch { if (!destroyed && runGeneration === generation) { state.mediaPhase = 'error'; emit(); } }
    })().finally(() => {
      warming = undefined;
      if (!destroyed && generation !== runGeneration && !document.hidden) void warm();
    });
    return warming;
  }
  function check(force = false): Promise<void> {
    if (destroyed || state.phase === 'unsupported') return Promise.resolve();
    if (checking) return checking;
    if (!force && Date.now() - lastCheck < 60_000) { void warm(); return Promise.resolve(); }
    lastCheck = Date.now();
    checking = (async () => {
      if (navigator.onLine === false) { if (state.phase !== 'ready') state.phase = 'offline'; state.message = '当前离线，已缓存内容仍可使用，联网后可重试。'; emit(); return; }
      state.phase = 'checking'; state.message = ''; emit();
      try {
        const registered = await ensureRegistration(); await registered.update();
        if (destroyed) return;
        await probe();
        if (registered.installing) { state.message = '新版核心资源正在准备，完成后会提示刷新。'; emit(); }
        else if (!worker()) { state.message = '正在准备首次离线核心资源。'; emit(); }
        void warm();
      } catch { if (!destroyed) { state.phase = state.latest && entry ? (state.current !== state.latest ? 'ready' : 'current') : 'error'; state.message = '检查更新未完成，当前页面仍可使用，请稍后重试。'; emit(); } }
    })().finally(() => { checking = undefined; });
    return checking;
  }
  const controllerChanged = () => {
    if (destroyed) return;
    generation++; probeRevision++; cancellation.abort(); cancellation = new AbortController();
    void probe().then(() => warm()).catch(() => { if (!destroyed) { state.phase = 'error'; state.message = '更新状态读取失败，请重试。'; emit(); } });
  };
  const foreground = () => { if (!document.hidden) { failed.clear(); void check(); } };
  const online = () => { failed.clear(); void check(true); };
  const offline = () => { state.mediaPhase = 'paused'; if (state.phase !== 'ready') state.phase = 'offline'; emit(); };
  if (options.enabled && container) {
    container.addEventListener('controllerchange', controllerChanged); document.addEventListener('visibilitychange', foreground);
    window.addEventListener('pageshow', foreground); window.addEventListener('online', online); window.addEventListener('offline', offline);
  }
  return {
    snapshot: () => ({ ...state }),
    subscribe(listener: (state: UpdateState) => void) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
    start: () => check(), check: () => check(true),
    retryMedia() { failed.clear(); void probe().then(() => warm()).catch(() => { state.mediaPhase = 'error'; emit(); }); },
    async apply() {
      if (state.phase !== 'ready' || state.applying || destroyed) return;
      state.applying = true; emit();
      try {
        if (await options.hasActiveSession()) { state.message = '请先结束正在运行或暂停的专注，再更新。'; return; }
        if (!options.canReload()) { state.message = '请先关闭当前弹窗，再更新。'; return; }
        await probe();
        if (state.phase !== 'ready') return;
        if (await options.hasActiveSession() || !options.canReload()) { state.message = '当前状态暂不适合刷新，请结束专注并关闭弹窗后再试。'; return; }
        (options.reload || (() => location.reload()))();
      } catch { state.message = '未能确认安全更新状态，没有刷新页面，请重试。'; }
      finally { state.applying = false; emit(); }
    },
    destroy() {
      destroyed = true; cancellation.abort(); generation++; listeners.clear();
      registration?.removeEventListener('updatefound', updateFound); watched.forEach((callback, worker) => worker.removeEventListener('statechange', callback)); watched.clear();
      container?.removeEventListener('controllerchange', controllerChanged); document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('pageshow', foreground); window.removeEventListener('online', online); window.removeEventListener('offline', offline);
    },
  };
}
export type AppUpdate = ReturnType<typeof createAppUpdate>;
