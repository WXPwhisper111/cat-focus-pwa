import { catSequence, frameDuration, getCatDefinition } from './cat-definition';
import { getInteractionClip } from './cat-interactions';
import type { AnimationClip } from './cat-animation';
import type { InteractionItem } from './room-interaction';

export const behaviorLimits = { maxActive: 2 };
export const teleportTiming = { outMs: 150, inMs: 180, watchdogMs: 4000 };
export type ManualBehavior = 'eat' | 'drink' | 'scratch' | 'pet' | 'sleep' | 'toilet';
export type BehaviorPlan = { item: InteractionItem | null; enter?: AnimationClip; loop?: AnimationClip; exit?: AnimationClip; once?: AnimationClip; minimumMs: number };
export const toiletTiming={initial:[60000,90000],cooldown:[120000,180000],durationMs:6000,weight:1,ordinaryWeight:4} as const;
export const behaviorTiming = { eat: 4800, drink: 6000, scratch: 3840, sleep: 9600, pet: 0 };
const base = new Map<string, AnimationClip>();
export function baseClip(catId: string, action: 'idle' | 'sleep_loop') {
  const cat = getCatDefinition(catId);
  if (!cat || !cat.animations[action]) return undefined;
  const key = `${catId}/${action}`;
  if (!base.has(key)) {
    const sequence = catSequence(cat, action);
    base.set(key, { id: action, catId, loop: true, sourceCanvas: cat.sourceCanvas, feetAnchor: cat.feetAnchor,
      frames: sequence.frames.map((frame, index) => ({ ...frame, durationMs: frameDuration(sequence, index) })) });
  }
  return base.get(key)!;
}
export function behaviorPlan(catId: string, action: ManualBehavior): BehaviorPlan | undefined {
  if(action==='toilet')return {item:null,minimumMs:toiletTiming.durationMs};
  if (action === 'sleep') {
    const clip = baseClip(catId, 'sleep_loop');
    return clip ? { item: 'bed', loop: clip, minimumMs: behaviorTiming.sleep } : undefined;
  }
  const clip = getInteractionClip(catId, action);
  if (!clip) return undefined;
  if (action === 'pet') return { item: null, once: clip, minimumMs: 0 };
  // V2 deliberately contains no enter/exit. Optional stages remain absent, never fabricated.
  return { item: clip.contact!.targetItem, loop: clip, minimumMs: behaviorTiming[action] };
}
