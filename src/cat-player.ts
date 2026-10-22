import { catDisplayName } from './cat-names';
import { validateClip, clipDuration, type AnimationClip } from './cat-animation';
import { orangeWhiteCat, catSequence, resolveCatAnimation, frameDuration, type CatAnimation, type CatDefinition } from './cat-definition';

export type CatRuntime = {
  loadImage: (url: string) => Promise<void>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
};
export type CatPlayerOptions = {
  definition?: CatDefinition;
  onPlayback?: (clip: AnimationClip, event: 'start' | 'complete' | 'stop' | 'switch' | 'hidden') => void;
  onFrame?: (state: CatAnimation, index: number) => void;
  onError?: (error?: Error) => void;
  onClipFrame?: (clip: AnimationClip, index: number) => void;
};

const imageLoads = new Map<string, Promise<void>>();
function loadImage(url: string): Promise<void> {
  let pending = imageLoads.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        // decode() ensures an already fetched frame can be painted before swapping.
        const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
        decoded.then(resolve, reject);
      };
      image.onerror = () => reject(Error(`无法加载 ${url}`));
      image.src = url;
    }).catch(error => { imageLoads.delete(url); throw error; });
    imageLoads.set(url, pending);
  }
  return pending;
}

export type PlayOptions = { onComplete?: () => void; iterations?: number };
export type PlaybackStart = { status: 'started' | 'cancelled' | 'failed'; error?: Error };

// One RAF owner per image. This layer plays frames; it never chooses a room zone.
export function createCatPlayer(image: HTMLImageElement, initialState: CatAnimation, options: CatPlayerOptions = {}, runtime: Partial<CatRuntime> = {}) {
  const definition = options.definition || orangeWhiteCat;
  const env: CatRuntime = {
    loadImage, requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id), now: () => performance.now(), ...runtime,
  };
  type Legacy = { actual: CatAnimation; requested: CatAnimation; fallback: boolean };
  type Playback = { clip: AnimationClip; legacy?: Legacy; onComplete?: () => void; completed: boolean; elapsed: number; iterations?: number };
  let active: Playback | undefined, frame = 0, playhead = 0, last = 0;
  let destroyed = false, stopped = false, pageActive = true, pendingFrame: number | undefined, revision = 0;
  let intent = '';
  const readyClips = new Set<AnimationClip>();
  const legacyClips = new Map<CatAnimation, AnimationClip>();
  function legacyClip(state: CatAnimation) {
    let clip = legacyClips.get(state);
    if (!clip) {
      const sequence = catSequence(definition, state);
      clip = { id: state, catId: definition.id, loop: true, sourceCanvas: definition.sourceCanvas, feetAnchor: definition.feetAnchor,
        frames: sequence.frames.map((frame, index) => ({ ...frame, durationMs: frameDuration(sequence, index) })) };
      legacyClips.set(state, clip);
    }
    return clip;
  }
  const showError = (error?: Error) => { if (!destroyed) options.onError?.(error); };
  const stopFrame = () => {
    if (pendingFrame !== undefined) env.cancelFrame(pendingFrame);
    pendingFrame = undefined;
  };
  function paint() {
    if (!active) return;
    image.src = active.clip.frames[frame].file;
    image.dataset.animation = active.legacy?.actual || active.clip.id;
    image.dataset.frame = String(frame);
    image.dataset.requestedAnimation = active.legacy?.requested || active.clip.id;
    image.dataset.staticFallback = String(active.legacy?.fallback || false);
    image.dataset.playback = active.completed ? 'completed' : stopped ? 'stopped' : 'playing';
    if (active.legacy) options.onFrame?.(active.legacy.actual, frame);
    options.onClipFrame?.(active.clip, frame);
  }
  function schedule() {
    if (!destroyed && !stopped && active && !active.completed && !active.legacy?.fallback && pageActive && !document.hidden && pendingFrame === undefined) pendingFrame = env.requestFrame(animate);
  }
  function animate(now: number) {
    pendingFrame = undefined;
    if (destroyed || stopped || !active || !pageActive || document.hidden) return;
    const playback = active, duration = clipDuration(playback.clip);
    const elapsed = Math.max(0, now - last); last = now;
    playback.elapsed += elapsed;
    const complete = playback.clip.loop ? playback.iterations !== undefined && playback.elapsed >= duration * playback.iterations : playback.elapsed >= duration;
    playhead = complete ? duration : playback.clip.loop ? playback.elapsed % duration : Math.min(duration, playback.elapsed);
    let remaining = playhead, next = 0;
    while (next < playback.clip.frames.length - 1 && remaining >= playback.clip.frames[next].durationMs) {
      remaining -= playback.clip.frames[next].durationMs; next++;
    }
    if (next !== frame || complete) { frame = next; playback.completed = complete; paint(); }
    if (complete) {
      // Mark completed before calling user code, which may stop, destroy or switch clips.
      if (!destroyed && active === playback && !stopped) { options.onPlayback?.(playback.clip, 'complete'); playback.onComplete?.(); }
      return;
    }
    schedule();
  }
  async function preload(clip: AnimationClip) {
    if (destroyed) return;
    validateClip(clip);
    if (clip.catId !== definition.id) throw Error('不能播放其他猫咪的动画');
    if (!readyClips.has(clip)) {
      await Promise.all(clip.frames.map(frame => env.loadImage(frame.file)));
      if (!destroyed) readyClips.add(clip);
    }
  }
  async function start(clip: AnimationClip, playOptions: PlayOptions = {}, legacy?: Legacy): Promise<PlaybackStart> {
    if (destroyed) return { status: 'cancelled' };
    const current = ++revision;
    intent = legacy ? `legacy:${legacy.requested}` : `clip:${clip.id}`;
    const previousAlt = image.alt;
    // Keep the existing focus-page accessibility state synchronous with pause/resume.
    if (legacy) image.alt = `${catDisplayName(definition)}${legacy.fallback ? '正在休息（暂无睡眠动画，显示本猫待机首帧）' : legacy.actual === 'sleep_loop' ? '正在睡觉' : '正在陪伴'}`;
    try {
      await preload(clip);
      if (playOptions.iterations !== undefined && (!Number.isSafeInteger(playOptions.iterations) || playOptions.iterations <= 0)) throw Error('动画循环次数无效');
      if (destroyed || current !== revision) return { status: 'cancelled' };
      if (active) options.onPlayback?.(active.clip, 'switch');
      stopFrame(); active = { clip, legacy, onComplete: playOptions.onComplete, completed: false, elapsed: 0, iterations: playOptions.iterations };
      stopped = false; frame = 0; playhead = 0; last = env.now();
      image.alt = legacy ? `${catDisplayName(definition)}${legacy.fallback ? '正在休息（暂无睡眠动画，显示本猫待机首帧）' : legacy.actual === 'sleep_loop' ? '正在睡觉' : '正在陪伴'}` : `${catDisplayName(definition)} · ${clip.id}`;
      paint(); options.onPlayback?.(clip, 'start'); schedule(); return { status: 'started' };
    } catch (reason) {
      const error = reason instanceof Error ? reason : Error(String(reason));
      if (destroyed || current !== revision) return { status: 'cancelled' };
      // Keep the old decoded pose/playback on loading failure.
      image.alt = previousAlt;
      showError(error); return { status: 'failed', error };
    }
  }
  async function updateState(state: CatAnimation) {
    const actual = resolveCatAnimation(definition, state);
    if (destroyed || (intent === `legacy:${state}` && active?.legacy?.requested === state && !stopped && !active.completed)) return;
    await start(legacyClip(actual), {}, { actual, requested: state, fallback: state !== actual });
  }
  const stop = () => {
    if (destroyed) return;
    ++revision; intent = ''; stopped = true; stopFrame();
    if (active) { options.onPlayback?.(active.clip, 'stop'); image.dataset.playback = 'stopped'; }
  };
  const visibility = () => { if (document.hidden && active) options.onPlayback?.(active.clip, 'hidden'); stopFrame(); if (!document.hidden) { last = env.now(); schedule(); } };
  const pageHide = () => { if (active) options.onPlayback?.(active.clip, 'hidden'); pageActive = false; stopFrame(); };
  const pageShow = () => { pageActive = true; visibility(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  void updateState(initialState);
  const other: CatAnimation = initialState === 'idle' ? 'sleep_loop' : 'idle';
  if (definition.animations[other]) void preload(legacyClip(other)).catch(showError);
  const imageError = () => showError(Error('猫咪画面加载失败'));
  image.addEventListener('error', imageError);
  return {
    updateState, preload,
    refreshName() {
      if (!active) return;
      const legacy = active.legacy;
      image.alt = legacy ? `${catDisplayName(definition)}${legacy.fallback ? '正在休息（暂无睡眠动画，显示本猫待机首帧）' : legacy.actual === 'sleep_loop' ? '正在睡觉' : '正在陪伴'}` : `${catDisplayName(definition)} · ${active.clip.id}`;
    },
    play: (clip: AnimationClip, playOptions: PlayOptions = {}) => start(clip, playOptions),
    stop, cancel: stop,
    getState: () => ({ clipId: active?.clip.id || null, frame, playheadMs: playhead, stopped, completed: active?.completed || false }),
    destroy() {
      if (destroyed) return;
      destroyed = true; ++revision; stopFrame(); active = undefined; readyClips.clear(); legacyClips.clear();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      image.removeEventListener('error', imageError);
    },
  };
}

export { loadImage as loadCatImage };
