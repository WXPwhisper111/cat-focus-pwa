import { createPetFeedback } from './cat-pet-feedback';
import { catDisplayName } from './cat-names';
import layout from '../art/room-v0.1/scene-calibration/layout.json';
import { createCatPlayer, loadCatImage, type CatRuntime } from './cat-player';
import { orangeWhiteCat, catSequence, frameDuration, type CatDefinition, type CatAnimation } from './cat-definition';
import { roomItems, type InteractionItem, type InteractionTarget } from './room-interaction';
import { resolveRoomTargets, type HitTarget } from './room-hit-targets';
import { getInteractionClip, type InteractionBehavior, type InteractionPhase } from './cat-interactions';
import type { PlayOptions } from './cat-player';
import { rectAtAnchor, type AnimationClip, type AnimationPoint } from './cat-animation';
import type { BehaviorPort } from './room-behavior';

export type RoomAnimation = CatAnimation;
export type RoomTheme = 'day' | 'night';
export type RoomRect = readonly [number, number, number, number];
export type RoomItemId = typeof layout.layers[number]['id'];
export type RoomHotspot = { itemId: RoomItemId; rect: RoomRect; minTargetPx: number };
export type RoomOptions = {
  hotspots?: readonly RoomHotspot[];
  onItemAction?: (itemId: RoomItemId) => void;
  onCatAction?: (catId: string) => void;
  onTargetAmbiguity?: (targets: InteractionTarget[]) => void;
  cat?: CatDefinition;
  cats?: readonly CatDefinition[];
  homeOrder?: readonly string[];
  // Explicit override for development previews only; the application uses auto.
  theme?: RoomTheme | 'auto';
};
export const roomLayout = layout;
export const roomSprites = { states: orangeWhiteCat.animations };
export const roomThemeAt = (date = new Date()): RoomTheme => date.getHours() >= 7 && date.getHours() < 19 ? 'day' : 'night';
const outsideFile = (theme: RoomTheme) => `window_outside_${theme}.png`;
const roomLabel = (theme: RoomTheme, count = 1) => `${theme === 'day' ? '白天' : '夜晚'}的猫咪小屋，窗帘打开，屋内有${count === 1 ? '一' : count}只猫`;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

// Bounds are local fractions of each furniture layer, rather than duplicate scene coordinates.
const furnitureHotspot = (itemId: RoomItemId, local: RoomRect): RoomHotspot => {
  const [x, y, width, height] = layout.layers.find(layer => layer.id === itemId)!.rect;
  return { itemId, rect: [x + local[0] * width, y + local[1] * height, local[2] * width, local[3] * height], minTargetPx: 44 };
};
export const roomHotspots: readonly RoomHotspot[] = [
  furnitureHotspot('foodBowl', [25 / 128, 45 / 96, 81 / 128, 34 / 96]),
  furnitureHotspot('waterBowl', [25 / 128, 45 / 96, 81 / 128, 34 / 96]),
  furnitureHotspot('bed', [20 / 288, 80 / 216, 247 / 288, 110 / 216]),
  furnitureHotspot('scratcher', [58 / 224, 66 / 224, 110 / 224, 99 / 224]),
  furnitureHotspot('rug', [0.1, 0.35, 0.8, 0.25]),
  furnitureHotspot('curtains', [0, 0, 1, 1]),
];

export function roomRectStyle([x, y, width, height]: readonly number[]) {
  return `left:${x / layout.canvas[0] * 100}%;top:${y / layout.canvas[1] * 100}%;width:${width / layout.canvas[0] * 100}%;height:${height / layout.canvas[1] * 100}%;`;
}

export function roomCatRect(state: RoomAnimation, frame: number, definition: CatDefinition = orangeWhiteCat, slot = 0): RoomRect {
  const rect = layout.catReferencePoints[slot]?.spriteRect || layout.layers.find(layer => layer.id === 'cat')!.rect;
  const offset = catSequence(definition, state).frames[frame].offset;
  return [rect[0] + offset[0], rect[1] + offset[1], rect[2], rect[3]];
}

export function roomMarkup(state: RoomAnimation, theme: RoomTheme = 'day', definition: CatDefinition = orangeWhiteCat, residents: readonly CatDefinition[] = [definition]) {
  const cats = [...new Map([definition, ...residents].map(cat => [cat.id, cat])).values()].slice(0, 3);
  return `<div class="room-scene" data-theme="${theme}" data-cat-id="${escape(definition.id)}" role="group" aria-label="${roomLabel(theme, cats.length)}">${layout.layers.map(layer => {
    if (layer.id === 'cat') return cats.map((cat, slot) => ({ cat, slot })).sort((a, b) => layout.catReferencePoints[a.slot].feet[1] - layout.catReferencePoints[b.slot].feet[1]).map(({ cat, slot }) => `<img ${slot === 0 ? 'id="cat"' : ''} class="room-layer room-cat" data-room-object="cat" data-room-cat="${cat.id}" draggable="false" src="${catSequence(cat, state).frames[0].file}" alt="${escape(`${catDisplayName(cat)}${state === 'sleep_loop' ? '正在睡觉' : '正在陪伴'}`)}" style="${roomRectStyle(roomCatRect(state, 0, cat, slot))}"/>`).join('');
    if (layer.primitive) {
      const [x, y, width, height] = layer.rect;
      return `<div class="room-contact-shadow" data-room-object="${layer.id}" aria-hidden="true">${cats.map((cat, slot) => {
        const dx = layout.catReferencePoints[slot].feet[0] - layout.catReferencePoints[0].feet[0];
        const dy = layout.catReferencePoints[slot].feet[1] - layout.catReferencePoints[0].feet[1];
        return [[x + 10 + dx, y + dy, width - 20, height], [x + 4 + dx, y + 2 + dy, width - 8, height - 4], [x + dx, y + 4 + dy, width, height - 8]]
          .map(rect => `<span data-cat-shadow="${cat.id}" style="${roomRectStyle(rect)}"></span>`).join('');
      }).join('')}</div>`;
    }
    return `<img class="room-layer" data-room-object="${layer.id}" draggable="false" src="./room/${layer.id === 'outside' ? outsideFile(theme) : layer.file}" alt="" aria-hidden="true" style="${roomRectStyle(layer.rect)}"/>`;
  }).join('')}<div class="room-night-shade" aria-hidden="true"></div><div class="room-warm-light" aria-hidden="true"></div></div><div class="room-period"><span data-room-period>${theme === 'day' ? '白天' : '夜晚'}</span><small>随本地时间自动变化</small></div><p class="room-error" role="status" hidden>部分房间画面未能加载，请联网后重新打开；专注计时不受影响。</p>`;
}

export type RoomRuntime = CatRuntime & {
  date?: () => Date;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
};

export function createRoomScene(initialState: RoomAnimation, options: RoomOptions = {}, runtime: Partial<RoomRuntime> = {}) {
  const date = runtime.date || (() => new Date());
  const definition = options.cat || orangeWhiteCat;
  const definitions = [...new Map([definition, ...(options.cats || [])].map(cat => [cat.id, cat])).values()].slice(0, 3);
  const loadImage = runtime.loadImage || loadCatImage;
  const setTimer = runtime.setTimer || ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = runtime.clearTimer || (id => clearTimeout(id));
  const themeNow = () => options.theme && options.theme !== 'auto' ? options.theme : roomThemeAt(date());
  const element = document.createElement('div');
  element.className = 'room-view';
  let appliedTheme = themeNow();
  element.innerHTML = roomMarkup(initialState, appliedTheme, definition, definitions);
  const scene = element.querySelector<HTMLDivElement>('.room-scene')!;
  const petFeedback = createPetFeedback(scene);
  const outside = scene.querySelector<HTMLImageElement>('[data-room-object=outside]')!;
  const error = element.querySelector<HTMLParagraphElement>('.room-error')!;
  let destroyed = false, pageActive = true, themeRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const showError = () => { if (!destroyed) error.hidden = false; };
  const homeOrder = [...new Set([...(options.homeOrder || []).filter(id => definitions.some(cat => cat.id === id)), ...definitions.map(cat => cat.id)])];
  const homes = new Map(definitions.map(cat => [cat.id, [...layout.catReferencePoints[homeOrder.indexOf(cat.id)].feet] as unknown as AnimationPoint]));
  const feet = new Map(homes), rendered = new Map<string, { clip: AnimationClip; frame: number }>(definitions.map(cat => {
    const sequence = catSequence(cat, initialState);
    const clip: AnimationClip = { id: initialState, catId: cat.id, loop: true, sourceCanvas: cat.sourceCanvas, feetAnchor: cat.feetAnchor,
      frames: sequence.frames.map((frame, index) => ({ ...frame, durationMs: frameDuration(sequence, index) })) };
    return [cat.id, { clip, frame: 0 }];
  }));
  const setRect = (node: HTMLElement, rect: readonly number[]) => {
    const [x, y, width, height] = rect;
    node.style.left = `${x / layout.canvas[0] * 100}%`; node.style.top = `${y / layout.canvas[1] * 100}%`;
    node.style.width = `${width / layout.canvas[0] * 100}%`; node.style.height = `${height / layout.canvas[1] * 100}%`;
  };
  function paintPosition(id: string) {
    if (destroyed) return;
    const pose = rendered.get(id); if (!pose) return;
    const point = feet.get(id)!;
    const rect = rectAtAnchor(pose.clip, pose.clip.frames[pose.frame].sourceAnchor || pose.clip.feetAnchor, point, [144, 144]);
    const image = scene.querySelector<HTMLImageElement>(`[data-room-cat="${id}"]`)!; setRect(image, rect); image.style.zIndex = '1';
    petFeedback.position(id, rect);
    const hitRect: RoomRect = [rect[0] + rect[2] * .12, rect[1] + rect[3] * .06, rect[2] * .76, rect[3] * .9];
    const button = scene.querySelector<HTMLButtonElement>(`[data-room-cat-target="${id}"]`);
    if (button) {
      const [x, y, w, h] = hitRect; button.style.left = `${(x + w / 2) / layout.canvas[0] * 100}%`; button.style.top = `${(y + h / 2) / layout.canvas[1] * 100}%`;
      button.style.width = `${w / layout.canvas[0] * 100}%`; button.style.height = `${h / layout.canvas[1] * 100}%`;
    }
    const entry = targets.find(entry => entry.target.kind === 'cat' && entry.target.id === id); if (entry) entry.rect = hitRect;
    const [x, y, width, height] = layout.layers.find(layer => layer.id === 'catShadow')!.rect;
    const dx = point[0] - layout.catReferencePoints[0].feet[0], dy = point[1] - layout.catReferencePoints[0].feet[1];
    const shadows = [[x + 10 + dx, y + dy, width - 20, height], [x + 4 + dx, y + 2 + dy, width - 8, height - 4], [x + dx, y + 4 + dy, width, height - 8]];
    scene.querySelectorAll<HTMLElement>(`[data-cat-shadow="${id}"]`).forEach((node, index) => setRect(node, shadows[index]));
  }
  const players = definitions.map((cat, slot) => {
    const image = scene.querySelector<HTMLImageElement>(`[data-room-cat="${cat.id}"]`)!;
    return createCatPlayer(image, initialState, {
      definition: cat, onError: showError,
      onPlayback: (clip, event) => { petFeedback.event(cat.id, clip.id, event); paintPosition(cat.id); },
      onClipFrame: (clip, frame) => { rendered.set(cat.id, { clip, frame }); paintPosition(cat.id); },
    }, runtime);
  });
  async function refreshEnvironment() {
    if (destroyed) return;
    const revision = ++themeRevision;
    const theme = themeNow();
    if (theme === appliedTheme) return;
    try {
      await loadImage(`./room/${outsideFile(theme)}`);
      if (destroyed || revision !== themeRevision) return;
      appliedTheme = theme;
      outside.src = `./room/${outsideFile(theme)}`;
      scene.dataset.theme = theme;
      scene.setAttribute('aria-label', roomLabel(theme, definitions.length));
      element.querySelector('[data-room-period]')!.textContent = theme === 'day' ? '白天' : '夜晚';
    } catch { if (revision === themeRevision) showError(); }
  }
  function stopClock() { if (timer !== undefined) clearTimer(timer); timer = undefined; }
  function checkEnvironment() {
    stopClock();
    if (destroyed || !pageActive || document.hidden) return;
    void refreshEnvironment();
    if (!options.theme || options.theme === 'auto') {
      const now = date();
      const delay = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      timer = setTimer(checkEnvironment, delay);
    }
  }
  const pageHide = () => { pageActive = false; stopClock(); };
  const pageShow = () => { pageActive = true; checkEnvironment(); };
  document.addEventListener('visibilitychange', checkEnvironment);
  window.addEventListener('focus', checkEnvironment);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  checkEnvironment();
  for (const layer of layout.layers) {
    if (layer.file && layer.id !== 'cat') {
      const file = layer.id === 'outside' ? outsideFile(appliedTheme) : layer.file;
      void loadImage(`./room/${file}`).catch(showError);
    }
  }
  const targets: HitTarget[] = [];
  const buttonFor = (target: InteractionTarget, rect: RoomRect, label: string, minTargetPx = 44) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `room-hotspot ${target.kind === 'cat' ? 'room-cat-hit' : 'room-item-hit'}`;
    button.dataset.hitKind = target.kind; button.dataset.hitId = target.id;
    button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', 'false');
    const [x, y, width, height] = rect;
    button.style.cssText = `left:${(x + width / 2) / layout.canvas[0] * 100}%;top:${(y + height / 2) / layout.canvas[1] * 100}%;width:${width / layout.canvas[0] * 100}%;height:${height / layout.canvas[1] * 100}%;min-width:${minTargetPx}px;min-height:${minTargetPx}px;`;
    if (target.kind === 'cat') { const name = document.createElement('span'); name.textContent = getCatName(target.id); button.append(name); }
    scene.append(button); targets.push({ target, rect, minTargetPx }); return button;
  };
  const getCatName = (id: string) => catDisplayName(definitions.find(cat => cat.id === id)!);
  if (options.onItemAction && options.hotspots) {
    for (const hotspot of options.hotspots) {
      const item = roomItems[hotspot.itemId as InteractionItem];
      const button = buttonFor({ kind: 'item', id: hotspot.itemId as InteractionItem }, hotspot.rect, item ? `选择${item.zone}的${item.name}` : hotspot.itemId, hotspot.minTargetPx);
      button.dataset.roomItem = hotspot.itemId;
    }
  }
  if (options.onCatAction) definitions.forEach((cat, slot) => {
    const [x, y, width, height] = roomCatRect(initialState, 0, cat, slot);
    const button = buttonFor({ kind: 'cat', id: cat.id }, [x + width * .12, y + height * .06, width * .76, height * .9], `与${catDisplayName(cat)}互动`);
    button.dataset.roomCatTarget = cat.id;
  });
  const activate = (target: InteractionTarget) => target.kind === 'cat' ? options.onCatAction?.(target.id) : options.onItemAction?.(target.id);
  scene.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-hit-kind]');
    if (destroyed || !button) return;
    const direct = targets.find(entry => entry.target.kind === button.dataset.hitKind && entry.target.id === button.dataset.hitId)!;
    if (!event.detail) { activate(direct.target); return; }
    const bounds = scene.getBoundingClientRect();
    // An exposed part of a furniture button is already a deliberate furniture tap.
    // Do not reinterpret its enlarged touch area as a nearby cat's bounding box.
    const candidates = direct.target.kind === 'item' ? targets.filter(entry => entry.target.kind === 'item') : targets;
    const hits = resolveRoomTargets(candidates, (event.clientX - bounds.left) * layout.canvas[0] / bounds.width, (event.clientY - bounds.top) * layout.canvas[1] / bounds.height, bounds.width);
    if (hits.length === 1) activate(hits[0]);
    else if (hits.length > 1) options.onTargetAmbiguity?.(hits);
  };
  const playerFor = (id: string) => players[definitions.findIndex(cat => cat.id === id)];
  for (const cat of definitions) paintPosition(cat.id);
  const behaviorPort: BehaviorPort = {
    ids: definitions.map(cat => cat.id),
    home: id => homes.get(id)!, getFeet: id => feet.get(id)!, positions: () => new Map(feet),
    setFeet(id, point) {
      if (destroyed || !feet.has(id)) return;
      feet.set(id, [...point] as unknown as AnimationPoint); paintPosition(id);
      const shade = scene.querySelector('.room-night-shade')!;
      [...definitions].sort((a, b) => feet.get(a.id)![1] - feet.get(b.id)![1]).forEach(cat => scene.insertBefore(scene.querySelector(`[data-room-cat="${cat.id}"]`)!, shade));
      targets.sort((a, b) => a.target.kind === 'cat' && b.target.kind === 'cat' ? feet.get(b.target.id)![1] - feet.get(a.target.id)![1] : 0);
    },
    fadeElements: id => Array.from(scene.querySelectorAll<HTMLElement>(`[data-room-cat="${id}"],[data-cat-shadow="${id}"],[data-room-cat-target="${id}"]`)),
    preload: (id, clip) => playerFor(id).preload(clip), play: (id, clip, settings) => playerFor(id).play(clip, settings),
    stop: id => playerFor(id)?.stop(), idle: id => playerFor(id).updateState('idle'),
  };
  return {
    behaviorPort,
    refreshNames() {
      players.forEach(player => player.refreshName());
      scene.querySelectorAll<HTMLButtonElement>('[data-room-cat-target]').forEach(button => {
        const name = getCatName(button.dataset.roomCatTarget!);
        button.setAttribute('aria-label', `与${name}互动`);
        button.querySelector('span')!.textContent = name;
      });
    },
    element, catId: definition.id, residentKey: definitions.map(cat => cat.id).join('|'), updateState: (state: CatAnimation) => Promise.all(players.map(player => player.updateState(state))), refreshEnvironment,
    updateCatState: (id: string, state: CatAnimation) => players[definitions.findIndex(cat => cat.id === id)]?.updateState(state) ?? Promise.resolve(),
    // Resource-only entry point. Callers own location/behavior policy; no UI invokes this in 2A.
    playCatInteraction(id: string, behavior: InteractionBehavior, phase?: InteractionPhase, playOptions?: PlayOptions) {
      const player = players[definitions.findIndex(cat => cat.id === id)], clip = getInteractionClip(id, behavior, phase);
      if (!player || !clip) return Promise.resolve({ status: 'failed' as const, error: Error('当前猫咪或动画资源不存在') });
      return player.play(clip, playOptions);
    },
    stopCatAnimation: (id: string) => players[definitions.findIndex(cat => cat.id === id)]?.stop(),
    setSelected(catId: string | null, itemId: string | null = null) {
      if (destroyed) return;
      scene.querySelectorAll<HTMLButtonElement>('[data-hit-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.hitKind === 'cat' ? button.dataset.hitId === catId : button.dataset.hitId === itemId)));
    },
    destroy() {
      if (destroyed) return;
      petFeedback.destroy(); destroyed = true; ++themeRevision; stopClock(); players.forEach(player => player.destroy()); scene.onclick = null;
      document.removeEventListener('visibilitychange', checkEnvironment);
      window.removeEventListener('focus', checkEnvironment);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      element.remove();
    },
  };
}
