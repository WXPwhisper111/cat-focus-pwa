import layout from '../art/room-v0.1/scene-calibration/layout.json';
import { furnitureAnchors } from './room-anchors';
import { rectAtAnchor } from './cat-animation';
import expansion from '../art/cat-expansion-v2/runtime.json';
import index from '../art/cat-interactions-v2/runtime-interactions.json';
import { getCatDefinition } from './cat-definition';
import { validateClip, clipDuration, type AnimationClip, type AnimationContact } from './cat-animation';

export type InteractionBehavior = 'eat' | 'drink' | 'scratch' | 'pet';
export type InteractionPhase = 'loop' | 'once';
type Manifest = {
  id: string; applicationCatId: string; version: string; canvas: number[]; feetAnchor: number[];
  manifest: string;
  actions: Record<string, Record<string, {
    loop: boolean; frameCount: number; cycleDurationMs: number; facing: string; feetAnchor: number[];
    frames: { file: string; mobileFile: string; durationMs: number }[]; contact?: AnimationContact;
  }>>;
};
export type InteractionClip = AnimationClip & { behavior: InteractionBehavior; phase: InteractionPhase; sourceManifest: string };
const clips = new Map<string, InteractionClip>();
for (const manifest of index.cats as unknown as Manifest[]) {
  if (index.version !== manifest.version || !getCatDefinition(manifest.applicationCatId)) throw Error('交互素材与猫咪配置不匹配');
  for (const [behavior, phases] of Object.entries(manifest.actions)) for (const [phase, source] of Object.entries(phases)) {
    if (!['eat', 'drink', 'scratch', 'pet'].includes(behavior) || !['loop', 'once'].includes(phase) || source.loop !== (phase === 'loop')) throw Error('交互动画阶段无效');
    const frames = source.frames.map(frame => {
      if (!/^mobile\/(eat|drink|scratch|pet)\/(loop|once)\/[a-z]+_\d{3}\.webp$/.test(frame.mobileFile) || !frame.mobileFile.startsWith(`mobile/${behavior}/${phase}/`)) throw Error('交互动画移动帧路径无效');
      return { file: `./cat-interactions-v2/${manifest.id}/${frame.mobileFile}`, durationMs: frame.durationMs };
    });
    const clip: InteractionClip = {
      id: `${behavior}:${phase}`, catId: manifest.applicationCatId, behavior: behavior as InteractionBehavior, phase: phase as InteractionPhase,
      sourceManifest: `./cat-interactions-v2/${manifest.manifest}`, loop: source.loop, frames,
      sourceCanvas: manifest.canvas, feetAnchor: source.feetAnchor, facing: source.facing,
      ...(source.contact ? { contact: source.contact } : {}),
    };
    validateClip(clip);
    if (frames.length !== source.frameCount || clipDuration(clip) !== source.cycleDurationMs) throw Error('交互动画帧数或总时长不一致');
    clips.set(`${clip.catId}/${clip.id}`, clip);
  }
}
for (const cat of expansion.cats) for (const behavior of ['eat','drink','scratch','pet'] as const) {
  const source = cat.actions[behavior], phase = behavior === 'pet' ? 'once' : 'loop';
  const clip: InteractionClip = {id:`${behavior}:${phase}`,catId:cat.id,behavior,phase,loop:source.loop,
    sourceManifest:`./cat-expansion-v2/${cat.id}/animations.json`,sourceCanvas:cat.sourceCanvas,feetAnchor:cat.feetAnchor,frames:source.frames,facing:source.facing,

    ...('contactPointsByFrame' in source ? {contactPointsByFrame:source.contactPointsByFrame} : {})};
  if('contact' in source) {
    const item=behavior==='eat'?'foodBowl':behavior==='drink'?'waterBowl':'scratcher';
    const anchor=furnitureAnchors.find(anchor=>anchor.itemId===item)!,layer=layout.layers.find(layer=>layer.id===item)!;
    const itemDisplayPoint=[anchor.local[0]*layer.rect[2],anchor.local[1]*layer.rect[3]] as const;
    const targetRoomPoint=[layer.rect[0]+itemDisplayPoint[0],layer.rect[1]+itemDisplayPoint[1]] as const;
    clip.contact={kind:behavior==='scratch'?'front-paw':'muzzle',spritePoint:source.contact.spritePoint as unknown as readonly [number,number],targetItem:item,itemDisplayPoint,targetRoomPoint,roomSpriteRect:rectAtAnchor(clip,source.contact.spritePoint,targetRoomPoint,[144,144])};
  }
  validateClip(clip); if (clipDuration(clip)!==source.cycleDurationMs || clip.frames.length!==source.frameCount) throw Error('新猫素材时长不一致');
  clips.set(`${cat.id}/${clip.id}`,clip);
}
export const interactionClips: readonly InteractionClip[] = [...clips.values()];
export function getInteractionClip(catId: string, behavior: InteractionBehavior, phase: InteractionPhase = behavior === 'pet' ? 'once' : 'loop') {
  return clips.get(`${catId}/${behavior}:${phase}`);
}
