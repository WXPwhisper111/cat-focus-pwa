export type FocusCategory = {
  id: string;
  name: string;
  archived: boolean;
  order: number;
};

export const DEFAULT_CATEGORIES: readonly FocusCategory[] = [
  { id: 'builtin-english', name: '英语', archived: false, order: 0 },
  { id: 'builtin-computer', name: '计算机', archived: false, order: 1 },
  { id: 'builtin-fitness', name: '健身', archived: false, order: 2 },
  { id: 'builtin-math', name: '数学', archived: false, order: 3 },
];

export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

export function normalizeCategoryName(raw: string): string {
  const name = raw.trim().normalize('NFC');
  if (!name || [...name].length > 20 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw Error('类别名称须为 1–20 个字符，不能包含换行或控制字符');
  }
  return name;
}

export const categoryKey = (name: string) => name.normalize('NFC').toLowerCase();
export const sortCategories = (categories: FocusCategory[]) =>
  [...categories].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export function isCategory(value: unknown): value is FocusCategory {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FocusCategory>;
  if (!validId(item.id) || typeof item.name !== 'string' || typeof item.archived !== 'boolean' ||
      !Number.isSafeInteger(item.order) || item.order! < 0) return false;
  try { return normalizeCategoryName(item.name) === item.name; } catch { return false; }
}

export class ArchivedCategoryError extends Error {
  constructor(public readonly category: FocusCategory) {
    super(`“${category.name}”已停用，请恢复原类别`);
  }
}
