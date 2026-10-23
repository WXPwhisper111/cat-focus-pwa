export const EXPANSION_KEY = 'catExpansion-v2';
export const newCatIds = ['cat-04','cat-05','cat-06'] as const;
export type ExpansionState = {version:1; eligible:boolean; claimed:{catId:string;claimedAt:number}|null};
export const expansionState = (eligible=false): ExpansionState => ({version:1,eligible,claimed:null});
export function validateExpansion(value:unknown, owned?:readonly string[]):ExpansionState {
  if (!value || typeof value!=='object') throw Error('新猫免费资格无效');
  const v=value as ExpansionState;
  if(v.version!==1 || typeof v.eligible!=='boolean' || v.eligible && owned!==undefined && !owned.length || v.claimed!==null && (!v.claimed || typeof v.claimed!=='object' || !v.eligible || !newCatIds.includes(v.claimed.catId as typeof newCatIds[number]) || !Number.isSafeInteger(v.claimed.claimedAt) || v.claimed.claimedAt<0 || owned && !owned.includes(v.claimed.catId))) throw Error('新猫领取记录与所有权不一致');
  return {version:1,eligible:v.eligible,claimed:v.claimed?{catId:v.claimed.catId,claimedAt:v.claimed.claimedAt}:null};
}
export function mergeExpansion(local:ExpansionState,incoming:ExpansionState):ExpansionState {
  if(local.claimed && incoming.claimed && (local.claimed.catId!==incoming.claimed.catId || local.claimed.claimedAt!==incoming.claimed.claimedAt)) throw Error('免费领取记录冲突，未导入任何数据');
  return {version:1,eligible:local.eligible||incoming.eligible,claimed:local.claimed||incoming.claimed};
}
