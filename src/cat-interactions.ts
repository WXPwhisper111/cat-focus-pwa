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
export const interactionClips: readonly InteractionClip[] = [...clips.values()];
export function getInteractionClip(catId: string, behavior: InteractionBehavior, phase: InteractionPhase = behavior === 'pet' ? 'once' : 'loop') {
  return clips.get(`${catId}/${behavior}:${phase}`);
}
