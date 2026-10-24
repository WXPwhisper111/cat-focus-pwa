import assets from '../public/room-upgrades-v1/manifest.json';
import layout from '../art/room-v0.1/scene-calibration/layout.json';
import { defaultCommerce, getProduct, type FurnitureInventory, type FurnitureZone } from './shop';
import { furnitureAnchors } from './room-anchors';
import type { InteractionItem } from './room-interaction';
export { assets as roomUpgradeAssets };
export const furnitureZoneFor=(id:string):FurnitureZone=>id==='bed'?'sleep':id==='rug'?'activity':id==='scratcher'?'play':'food';
export const equipmentKey=(inventory: FurnitureInventory=defaultCommerce().inventory)=>JSON.stringify(inventory.equipped);
export function furnitureAvailable(inventory:FurnitureInventory,item:InteractionItem){
  const zone=furnitureZoneFor(item),id=inventory.equipped[zone],product=getProduct(id);
  return product?.kind==='furniture'&&product.zone===zone&&inventory.ownedFurnitureIds.includes(id);
}
export function equippedAnchors(inventory:FurnitureInventory=defaultCommerce().inventory){
  return furnitureAnchors.map(anchor=>anchor.itemId==='bed'&&inventory.equipped.sleep==='advanced-bed'?{...anchor,local:[anchor.local[0],anchor.local[1]+assets.sleepOffsetRoom[1]/216] as const}:anchor);
}
export function roomLayerAsset(layer: typeof layout.layers[number],inventory:FurnitureInventory=defaultCommerce().inventory){
  if(layer.id==='plant')return assets.plant;
  if(layer.id==='curtains')return {file:assets.curtains.fallback,rect:assets.curtains.rect};
  if(['bed','rug','scratcher','foodBowl','waterBowl'].includes(layer.id)&&inventory.equipped[furnitureZoneFor(layer.id)].startsWith('advanced-'))return assets.furniture[layer.id as keyof typeof assets.furniture];
  return {file:'./room/'+layer.file,rect:layer.rect};
}
