import { furnitureAnchors } from './room-anchors';
import { getCatDefinition } from './cat-definition';
// Cosmetic stable placements only. Ownership and economy remain in their existing stores.
export type RoomLocations = Record<string, string>;
export function validateRoomLocations(value: unknown): RoomLocations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('小屋位置数据无效');
  const result: RoomLocations = {}, groups = new Set<string>();
  for (const [id, anchorId] of Object.entries(value)) {
    if (getCatDefinition(id) && typeof anchorId === 'string' && /^(food|bed|play)-idle-[0-2]$/.test(anchorId)) continue; // Removed cosmetic slots normalize to default rug homes.
    const anchor = furnitureAnchors.find(entry => entry.id === anchorId);
    if (!getCatDefinition(id) || !anchor || groups.has(anchor.group)) throw Error('小屋位置数据无效');
    groups.add(anchor.group); result[id] = anchor.id;
  }
  return result;
}
