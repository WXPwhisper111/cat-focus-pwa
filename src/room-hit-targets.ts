import type { InteractionTarget } from './room-interaction';
import layout from '../art/room-v0.1/scene-calibration/layout.json';
export type HitTarget = { target: InteractionTarget; rect: readonly number[]; minTargetPx: number };
export function resolveRoomTargets(targets: readonly HitTarget[], x: number, y: number, sceneWidth: number): InteractionTarget[] {
  if (sceneWidth <= 0) return [];
  const contains = (entry: HitTarget, expanded: boolean) => {
    const [left, top, width, height] = entry.rect;
    const minimum = expanded ? entry.minTargetPx * layout.canvas[0] / sceneWidth : 0;
    const hitWidth = Math.max(width, minimum), hitHeight = Math.max(height, minimum);
    return Math.abs(x - left - width / 2) <= hitWidth / 2 && Math.abs(y - top - height / 2) <= hitHeight / 2;
  };
  // Furniture's visible controls must remain reachable while a cat uses them.
  // The rug is behind cats; enlarged furniture bounds never swallow a cat tap.
  const visibleItems = targets.filter(entry => entry.target.kind === 'item' && contains(entry, false));
  const furniture = visibleItems.filter(entry => entry.target.id !== 'rug');
  if (furniture.length) return furniture.map(entry => entry.target);
  const visibleCats = targets.filter(entry => entry.target.kind === 'cat' && contains(entry, false));
  if (visibleCats.length) return [visibleCats[0].target];
  if (visibleItems.length) return visibleItems.map(entry => entry.target);
  return targets.filter(entry => contains(entry, true)).map(entry => entry.target);
}
