// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createCategoryPicker } from '../src/category-picker';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { categoryColor, categoryIcon } from '../src/category-icons';
import { buildStatistics } from '../src/statistics';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('shares statistics colors with every picker icon and keeps custom assignments stable', () => {
  const custom = Array.from({ length: 30 }, (_, index) => ({ id: `custom-color-${index}`, name: `自定义${index}`, archived: false, order: index + 4 }));
  const categories = [...DEFAULT_CATEGORIES, ...custom];
  const select = document.createElement('select');
  for (const category of categories) select.add(new Option(category.name, category.id));
  document.body.append(select); const picker = createCategoryPicker(select);
  expect(DEFAULT_CATEGORIES.map(category => categoryColor(category.id))).toEqual(['#eb884b', '#f4bd62', '#9c9e70', '#b17b65']);
  const now = new Date(2026, 9, 21);
  const records = custom.map(category => ({ id: `record-${category.id}`, categoryId: category.id, category: category.name, mode: 'stopwatch' as const, targetMinutes: null, startedAt: now.toISOString(), endedAt: now.toISOString(), durationSeconds: 60, completed: false }));
  for (const range of ['today', 'week', 'month'] as const) {
    const model = buildStatistics(records, [...categories].reverse(), now, { range, month: '2026-10', selectedBucket: null });
    for (const category of model.categories) {
      const index = categories.findIndex(item => item.id === category.id);
      const badge = document.querySelector<HTMLElement>(`#category-option-${index} .category-option-icon`)!;
      expect(badge.style.getPropertyValue('--category-color')).toBe(category.color);
      const expected = document.createElement('span'); expected.innerHTML = categoryIcon(category.id, category.name);
      expect(badge.innerHTML).toBe(expected.innerHTML);
    }
  }
  expect(new Set(custom.map(category => categoryColor(category.id))).size).toBeGreaterThan(1);
  expect(new Set(custom.map(category => categoryIcon(category.id))).size).toBeGreaterThan(1);
  select.value = custom[0].id; select.dispatchEvent(new Event('change'));
  expect(document.querySelector<HTMLElement>('.category-picker-trigger .category-option-icon')!.style.getPropertyValue('--category-color')).toBe(categoryColor(custom[0].id));
  picker.destroy();
});
it('selects with keyboard and pointer, closes on Escape/outside/Tab, and cleans listeners', () => {
  document.body.innerHTML = '<select id="category"></select><input id="minutes" value="42" />';
  const select = document.querySelector('select')!;
  for (const category of DEFAULT_CATEGORIES) select.add(new Option(category.name, category.id));
  const changed = vi.fn(); select.addEventListener('change', changed);
  const picker = createCategoryPicker(select);
  const trigger = document.querySelector<HTMLButtonElement>('[role=combobox]')!;
  const key = (value: string) => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  expect(select.hidden).toBe(true); trigger.click();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[data-stats-icon=dumbbell]')).not.toBeNull();
  expect(document.querySelector('[data-stats-icon=math]')).not.toBeNull();
  key('End'); key('Enter');
  expect(select.value).toBe('builtin-math'); expect(changed).toHaveBeenCalledTimes(1);
  expect(trigger.textContent).toContain('数学'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); key('ArrowUp'); key('Enter'); expect(select.value).toBe('builtin-fitness');
  trigger.click(); key('Escape'); expect(select.value).toBe('builtin-fitness');
  trigger.click(); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); key('Tab'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); document.querySelector<HTMLButtonElement>('[data-category-index="0"]')!.click();
  expect(select.value).toBe('builtin-english'); expect(document.querySelector<HTMLInputElement>('#minutes')!.value).toBe('42');
  const remove = vi.spyOn(document, 'removeEventListener'); picker.destroy();
  expect(document.querySelector('.category-picker')).toBeNull(); expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function));
});

it('escapes long custom labels and keeps an external selection in sync', () => {
  const select = document.createElement('select');
  select.add(new Option('<img src=x>很长的自定义专注类别', 'custom-long-name'));
  select.add(new Option('数学', 'custom-math-category')); document.body.append(select);
  const picker = createCategoryPicker(select);
  expect(document.querySelector('.category-picker img')).toBeNull();
  select.value = 'custom-math-category'; select.dispatchEvent(new Event('change'));
  expect(document.querySelector('[role=combobox]')!.textContent).toContain('数学');
  expect(document.querySelector('[role=combobox] [data-stats-icon=math]')).not.toBeNull(); picker.destroy();
});
