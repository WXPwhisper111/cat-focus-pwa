import { getCatDefinition } from './cat-definition';

export type CatHouseState = { ownedCatIds: string[]; residentCatIds: string[]; companionCatId: string | null };

export function validateCatHouseState(value: unknown): CatHouseState {
  if (!value || typeof value !== 'object') throw Error('猫咪小屋状态格式无效');
  const state = value as Partial<CatHouseState>;
  if (!Array.isArray(state.ownedCatIds) || !Array.isArray(state.residentCatIds) ||
      (state.companionCatId !== null && typeof state.companionCatId !== 'string')) throw Error('猫咪小屋状态字段无效');
  for (const ids of [state.ownedCatIds, state.residentCatIds]) {
    if (ids.some(id => typeof id !== 'string' || !getCatDefinition(id))) throw Error('猫咪小屋包含未知的猫咪 ID');
    if (new Set(ids).size !== ids.length) throw Error('猫咪小屋包含重复的猫咪 ID');
  }
  if (state.residentCatIds.length > 3) throw Error('最多允许三只猫入住');
  if (state.residentCatIds.some(id => !state.ownedCatIds!.includes(id))) throw Error('入住猫必须属于已拥有的猫');
  if (state.companionCatId !== null && !state.ownedCatIds.includes(state.companionCatId)) throw Error('主陪伴猫必须属于已拥有的猫');
  if (state.ownedCatIds.length && !state.companionCatId) throw Error('已有猫咪时必须指定主陪伴猫');
  return { ownedCatIds: [...state.ownedCatIds], residentCatIds: [...state.residentCatIds], companionCatId: state.companionCatId };
}

export const hasAdoptedCat = (state: CatHouseState | null | undefined) => !!state?.companionCatId;
export const catHouseSignature = (state: CatHouseState) => JSON.stringify([[...state.ownedCatIds].sort(), [...state.residentCatIds].sort(), state.companionCatId]);
