import { getCatDefinition, type CatDefinition } from './cat-definition';

export type CatNames = Record<string, string>;
export const CAT_NAMES_KEY = 'catNames';
export function normalizeCatName(value: unknown): string {
  if (typeof value !== 'string') throw Error('请输入猫咪名称');
  const name = value.trim();
  if (!name || Array.from(name).length > 12 || /[\u0000-\u001f\u007f]/u.test(name)) throw Error('名称需为 1–12 个字符，不能包含换行或控制字符');
  return name;
}
export function validateCatNames(value: unknown): CatNames {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('猫咪名称设置无效');
  const result: CatNames = {};
  for (const [id, name] of Object.entries(value)) {
    if (!getCatDefinition(id)) throw Error('名称设置包含未知猫咪');
    result[id] = normalizeCatName(name);
  }
  return result;
}
let names: CatNames = {};
export function applyCatNames(value: CatNames) { names = validateCatNames(value); }
export function catDisplayName(cat: CatDefinition): string { return names[cat.id] || cat.name; }
