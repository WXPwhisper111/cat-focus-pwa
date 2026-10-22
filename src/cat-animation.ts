export type AnimationPoint = readonly [number, number];
export type AnimationFrame = { file: string; durationMs: number; sourceAnchor?: readonly number[]; offset?: readonly number[] };
export type AnimationContact = {
  kind: 'muzzle' | 'front-paw'; spritePoint: AnimationPoint;
  targetItem: 'foodBowl' | 'waterBowl' | 'scratcher'; itemDisplayPoint: AnimationPoint;
  targetRoomPoint: AnimationPoint; roomSpriteRect: readonly [number, number, number, number];
  contactFrame: number; // Source generator uses a zero-based reference frame index.
};
export type AnimationClip = {
  id: string; catId: string; loop: boolean; sourceCanvas: readonly number[];
  feetAnchor: readonly number[]; frames: readonly AnimationFrame[];
  contact?: AnimationContact; facing?: string;
};
export function clipDuration(clip: AnimationClip) { return clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0); }
export function validateClip(clip: AnimationClip) {
  if (!clip.id || !clip.catId || !clip.frames.length || clip.sourceCanvas.length !== 2 ||
      clip.sourceCanvas.some(value => !Number.isFinite(value) || value <= 0) ||
      clip.feetAnchor.length !== 2 || clip.feetAnchor.some(value => !Number.isFinite(value)) ||
      clip.frames.some(frame => !frame.file || !Number.isFinite(frame.durationMs) || frame.durationMs <= 0) ||
      !Number.isFinite(clipDuration(clip))) throw Error('动画资源或逐帧时长无效');
}
// Pure coordinate conversions. The caller chooses the anchor and its world position.
// Contact references are NOT frame offsets; do not pin an animated muzzle every frame.
export function pointOnCanvas(clip: AnimationClip, point: readonly number[], canvas: readonly number[]): AnimationPoint {
  return [point[0] * canvas[0] / clip.sourceCanvas[0], point[1] * canvas[1] / clip.sourceCanvas[1]];
}
export function rectAtAnchor(clip: AnimationClip, anchor: readonly number[], target: readonly number[], size: readonly number[]): readonly [number, number, number, number] {
  const point = pointOnCanvas(clip, anchor, size);
  return [target[0] - point[0], target[1] - point[1], size[0], size[1]];
}
