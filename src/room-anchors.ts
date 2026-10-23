import layout from '../art/room-v0.1/scene-calibration/layout.json';
import { rectAtAnchor, type AnimationClip, type AnimationPoint } from './cat-animation';
import type { InteractionItem } from './room-interaction';

export type RoomAnchor = { id: string; itemId: InteractionItem; local: AnimationPoint; contact: boolean; group: string };
// Fractions of the actual furniture layer. Add anchors here, never in buttons.
export const furnitureAnchors: readonly RoomAnchor[] = [
  { id: 'food-0', itemId: 'foodBowl', local: [64 / 128, 45 / 96], contact: true, group: 'food' },
  { id: 'water-0', itemId: 'waterBowl', local: [64 / 128, 45 / 96], contact: true, group: 'food' },
  { id: 'scratch-0', itemId: 'scratcher', local: [112 / 224, 98 / 224], contact: true, group: 'play' },
  { id: 'bed-0', itemId: 'bed', local: [134 / 288, 169 / 216], contact: false, group: 'sleep' },
];
export function anchorFeet(anchor: RoomAnchor, clip: AnimationClip): AnimationPoint {
  const layer = layout.layers.find(layer => layer.id === anchor.itemId)!;
  const [x, y, width, height] = layer.rect;
  const point: AnimationPoint = [x + width * anchor.local[0], y + height * anchor.local[1]];
  if (!anchor.contact) return point;
  if (!clip.contact || clip.contact.targetItem !== anchor.itemId) throw Error('动作接触点与家具不匹配');
  const rect = rectAtAnchor(clip, clip.contact.spritePoint, point, [144, 144]);
  return [rect[0] + clip.feetAnchor[0] * 144 / clip.sourceCanvas[0], rect[1] + clip.feetAnchor[1] * 144 / clip.sourceCanvas[1]];
}
export function createAnchorManager(positions: () => ReadonlyMap<string, AnimationPoint>, definitions = furnitureAnchors, homes: ReadonlyMap<string, AnimationPoint> = new Map()) {
  const leases = new Map<string, { catId: string; anchor: RoomAnchor; feet: AnimationPoint; released: boolean }>();
  const overlap = positionsOverlap;
  function available(catId: string, itemId: InteractionItem, clip: AnimationClip, requestedId?: string) {
      for (const anchor of definitions.filter(anchor => anchor.itemId === itemId && (!requestedId || anchor.id === requestedId))) {
        const feet = anchorFeet(anchor, clip);
        if ([...leases.values()].some(lease => lease.catId !== catId && (lease.anchor.id === anchor.id || lease.anchor.group === anchor.group || overlap(lease.feet, feet)))) continue;
        if ([...positions()].some(([id, point]) => id.split('#')[0] !== catId && overlap(point, feet))) continue;
        if ([...homes].some(([id, point]) => id.split('#')[0] !== catId && overlap(point, feet))) continue;
        return { anchor, feet };
      }
      return undefined;
  }
  return {
    available,
    reserve(catId: string, itemId: InteractionItem, clip: AnimationClip, requestedId?: string) {
      const target = available(catId, itemId, clip, requestedId);
      if (!target) throw Error('目标位置正被占用，请稍后再试');
      const previous = leases.get(target.anchor.id);
      const lease = { catId, ...target, released: false }; leases.set(target.anchor.id, lease);
      return { ...lease, release() {
        if (lease.released) return; lease.released = true;
        if (leases.get(target.anchor.id) !== lease) return;
        if (previous && !previous.released) leases.set(target.anchor.id, previous); else leases.delete(target.anchor.id);
      } };
    },
    snapshot: () => [...leases.values()].map(lease => ({ ...lease })),
    clear: () => leases.clear(),
  };
}

export const positionsOverlap = (a:AnimationPoint,b:AnimationPoint) => Math.abs(a[0]-b[0])<88 && Math.abs(a[1]-b[1])<18;
const nearbyOffsets:Partial<Record<InteractionItem,readonly AnimationPoint[]>>={
  bed:[[1.04,.78],[.5,1.08]],foodBowl:[[.5,1.16],[-.4,1.2]],waterBowl:[[.5,1.16],[.8,.8]],scratcher:[[.5,1.12],[.05,1.04],[-.15,.75]],
};
export function nearbyCandidates(item:InteractionItem):AnimationPoint[]{
  const layer=layout.layers.find(layer=>layer.id===item)!;
  return (nearbyOffsets[item]||[]).map(([x,y])=>[layer.rect[0]+x*layer.rect[2],layer.rect[1]+y*layer.rect[3]] as AnimationPoint).filter(([x,y])=>x>=72&&x<=952&&y>=520&&y<=736);
}
