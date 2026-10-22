import { catDisplayName } from './cat-names';
import { catDefinitions, getCatDefinition } from './cat-definition';
import type { CatHouseState } from './cat-house-state';
import type { WalletSnapshot } from './wallet';

export type FurnitureZone = 'sleep' | 'food' | 'activity' | 'play';
export type ShopProduct = { id: string; price: number } & (
  { kind: 'cat'; catId: string } |
  { kind: 'furniture'; zone: FurnitureZone; name: string; previews: string[]; defaultOwned: boolean }
);
export const furnitureZones: readonly { id: FurnitureZone; name: string }[] = [
  { id: 'sleep', name: '睡觉区' }, { id: 'food', name: '吃饭区' }, { id: 'activity', name: '活动区' }, { id: 'play', name: '玩耍区' },
];
export const shopProducts: readonly ShopProduct[] = [
  ...catDefinitions.map(cat => ({ id: `cat-${cat.id}`, kind: 'cat' as const, catId: cat.id, price: 80 })),
  { id: 'basic-bed', kind: 'furniture', zone: 'sleep', name: '基础猫窝', previews: ['./room/zone_sleep_bed_basic.png'], defaultOwned: true, price: 0 },
  { id: 'basic-tableware', kind: 'furniture', zone: 'food', name: '基础餐具组', previews: ['./room/zone_food_bowl_basic.png', './room/zone_water_bowl_basic.png'], defaultOwned: true, price: 0 },
  { id: 'basic-rug', kind: 'furniture', zone: 'activity', name: '基础地毯', previews: ['./room/zone_activity_rug_basic.png'], defaultOwned: true, price: 0 },
  { id: 'basic-scratcher', kind: 'furniture', zone: 'play', name: '基础猫抓板', previews: ['./room/zone_play_scratcher_basic.png'], defaultOwned: true, price: 0 },
];
export const getProduct = (id: string) => shopProducts.find(product => product.id === id);
export const productName = (product: ShopProduct) => product.kind === 'cat' ? catDisplayName(getCatDefinition(product.catId)!) : product.name;
export type FurnitureInventory = { ownedFurnitureIds: string[]; equipped: Record<FurnitureZone, string> };
export type PurchaseRecord = { productId: string; price: number; transactionId: string; purchasedAt: number };
export type CommerceState = { version: 1; inventory: FurnitureInventory; purchases: PurchaseRecord[] };
export function defaultCommerce(): CommerceState {
  const basics = shopProducts.filter((product): product is Extract<ShopProduct, { kind: 'furniture' }> => product.kind === 'furniture' && product.defaultOwned);
  return { version: 1, inventory: { ownedFurnitureIds: basics.map(product => product.id), equipped: Object.fromEntries(basics.map(product => [product.zone, product.id])) as Record<FurnitureZone, string> }, purchases: [] };
}
export function validateCommerce(value: unknown): CommerceState {
  const fail = (): never => { throw Error('商城数据格式无效'); };
  if (!value || typeof value !== 'object') fail();
  const state = value as CommerceState;
  if (state.version !== 1 || !state.inventory || !Array.isArray(state.inventory.ownedFurnitureIds) || !state.inventory.equipped || !Array.isArray(state.purchases)) fail();
  const owned = state.inventory.ownedFurnitureIds;
  if (new Set(owned).size !== owned.length || owned.some(id => getProduct(id)?.kind !== 'furniture') ||
      defaultCommerce().inventory.ownedFurnitureIds.some(id => !owned.includes(id))) fail();
  for (const zone of furnitureZones) {
    const id = state.inventory.equipped[zone.id], product = getProduct(id);
    if (!owned.includes(id) || product?.kind !== 'furniture' || product.zone !== zone.id) fail();
  }
  const seen = new Set<string>();
  for (const receipt of state.purchases) {
    const product = receipt && getProduct(receipt.productId);
    if (!product || seen.has(receipt.productId) || product.price <= 0 || receipt.price !== product.price ||
        receipt.transactionId !== `spend:purchase_${product.id}` || !Number.isSafeInteger(receipt.purchasedAt) || receipt.purchasedAt < 0) fail();
    seen.add(receipt.productId);
  }
  return { version: 1, inventory: { ownedFurnitureIds: [...owned], equipped: Object.fromEntries(furnitureZones.map(zone => [zone.id, state.inventory.equipped[zone.id]])) as Record<FurnitureZone, string> },
    purchases: state.purchases.map(receipt => ({ productId: receipt.productId, price: receipt.price, transactionId: receipt.transactionId, purchasedAt: receipt.purchasedAt })) };
}
export const commerceSignature = (state: CommerceState) => {
  const canonical = validateCommerce(state);
  canonical.inventory.ownedFurnitureIds.sort(); canonical.purchases.sort((a, b) => a.productId.localeCompare(b.productId));
  return JSON.stringify(canonical);
};
export function validateCommerceLinks(shop: CommerceState, house: CatHouseState | undefined | null, wallet: WalletSnapshot) {
  for (const receipt of shop.purchases) {
    const product = getProduct(receipt.productId)!;
    const transaction = wallet.transactions.find(entry => entry.id === receipt.transactionId);
    const owned = product.kind === 'cat' ? house?.ownedCatIds.includes(product.catId) : shop.inventory.ownedFurnitureIds.includes(product.id);
    if (!owned || transaction?.kind !== 'spend' || transaction.amount !== -receipt.price || transaction.createdAt !== receipt.purchasedAt) throw Error('购买记录、所有权与钱包流水不一致');
  }
  for (const entry of wallet.transactions) {
    if (entry.kind === 'spend' && entry.sourceId.startsWith('purchase_') && !shop.purchases.some(receipt => receipt.transactionId === entry.id)) throw Error('钱包购买流水缺少购买记录');
  }
}
