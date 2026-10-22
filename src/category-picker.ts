import { categoryColor, categoryIcon } from './category-icons';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function createCategoryPicker(select: HTMLSelectElement) {
  const element = document.createElement('div');
  element.className = 'category-picker';
  const options = [...select.options];
  let active = Math.max(0, select.selectedIndex), open = false;
  element.innerHTML = `<button type="button" class="category-picker-trigger" role="combobox" aria-label="专注类别" aria-expanded="false" aria-controls="category-options" aria-haspopup="listbox"></button><div id="category-options" class="category-options" role="listbox" aria-label="专注类别" hidden>${options.map((option, index) => `<button type="button" role="option" id="category-option-${index}" tabindex="-1" data-category-index="${index}" aria-selected="${option.selected}"><span class="category-option-icon" style="--category-color:${categoryColor(option.value, option.text)}">${categoryIcon(option.value, option.text)}</span><span class="category-option-name">${escape(option.text)}</span><span class="category-option-check" aria-hidden="true">✓</span></button>`).join('')}</div>`;
  select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  select.after(element);
  const trigger = element.querySelector<HTMLButtonElement>('.category-picker-trigger')!;
  const menu = element.querySelector<HTMLDivElement>('.category-options')!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>('[role=option]')];
  function paint() {
    const selected = options[select.selectedIndex];
    trigger.innerHTML = `<span class="category-option-icon" style="--category-color:${categoryColor(selected.value, selected.text)}">${categoryIcon(selected.value, selected.text)}</span><span class="category-option-name">${escape(selected.text)}</span><svg class="category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
    trigger.setAttribute('aria-expanded', String(open)); menu.hidden = !open;
    buttons.forEach((button, index) => {
      button.setAttribute('aria-selected', String(index === select.selectedIndex));
      button.classList.toggle('keyboard-active', open && index === active);
    });
    if (open) trigger.setAttribute('aria-activedescendant', buttons[active].id);
    else trigger.removeAttribute('aria-activedescendant');
  }
  function toggle(value: boolean) {
    open = value; active = Math.max(0, select.selectedIndex);
    if (open) {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 90, above = rect.top - 16;
      const upwards = below < Math.min(280, options.length * 50 + 14) && above > below;
      element.classList.toggle('opens-up', upwards);
      menu.style.maxHeight = `${Math.max(100, Math.min(280, (upwards ? above : below) - 12))}px`;
    }
    paint();
  }
  function choose(index: number) {
    select.selectedIndex = index; toggle(false); trigger.focus();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  trigger.onclick = () => toggle(!open);
  buttons.forEach((button, index) => button.onclick = () => choose(index));
  trigger.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); toggle(false); return; }
    if (event.key === 'Tab') { toggle(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { toggle(true); return; }
      active = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      paint(); buttons[active].scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (open) choose(active); else toggle(true);
    }
  };
  const outside = (event: Event) => { if (!element.contains(event.target as Node)) toggle(false); };
  const changed = () => { active = Math.max(0, select.selectedIndex); paint(); };
  document.addEventListener('pointerdown', outside);
  select.addEventListener('change', changed);
  paint();
  return { destroy() { document.removeEventListener('pointerdown', outside); select.removeEventListener('change', changed); element.remove(); } };
}
