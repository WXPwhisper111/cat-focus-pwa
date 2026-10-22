import { catDisplayName } from './cat-names';
import { getCatDefinition } from './cat-definition';
import { roomItems, type InteractionItem, type InteractionTarget, type RoomInteraction } from './room-interaction';

export function createRoomInteractionPanel(controller: RoomInteraction) {
  const element = document.createElement('section'); element.className = 'room-interaction-panel';
  element.setAttribute('aria-label', '小屋互动');
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const targetName = (target: InteractionTarget) => target.kind === 'cat' ? catDisplayName(getCatDefinition(target.id)!) : roomItems[target.id].name;
  const render = (state: ReturnType<RoomInteraction['snapshot']>) => {
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = element.contains(focused) ? focused?.dataset.interactionChoice : undefined;
    element.hidden = !state.open;
    if (!state.open) { element.replaceChildren(); return; }
    const cat = getCatDefinition(state.selectedCatId);
    const candidates = state.choices.length ? state.choices : !cat ? state.residentIds.map(id => ({ kind: 'cat' as const, id })) : [];
    element.innerHTML = `<header><div><small>行动猫 · 不改变主陪猫</small><h2 tabindex="-1">${cat ? escape(catDisplayName(cat)) : '请选择互动猫咪'}</h2></div><button type="button" data-interaction-close aria-label="关闭互动面板">×</button></header>
      ${candidates.length ? `<p>${state.choices.length ? '这里有多个目标，请选择：' : '这次想和谁互动？'}</p><div class="interaction-choices">${candidates.map(target => `<button type="button" data-interaction-choice="${target.kind}:${target.id}">${escape(targetName(target))}</button>`).join('')}</div>` : ''}
      `;
    if (focusKey) (Array.from(element.querySelectorAll<HTMLElement>('[data-interaction-choice]')).find(button => button.dataset.interactionChoice === focusKey) || element.querySelector<HTMLElement>('h2'))?.focus();
  };
  const unsubscribe = controller.subscribe(render);
  element.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-interaction-close')) {
      const selected = controller.snapshot().selectedCatId;
      const focusTarget = Array.from(document.querySelectorAll<HTMLElement>('[data-room-cat-target]')).find(target => target.dataset.roomCatTarget === selected) || document.querySelector<HTMLElement>('.room-hotspot');
      controller.close(); focusTarget?.focus(); return;
    }
    const value = button.dataset.interactionChoice;
    if (value) { const [kind, id] = value.split(':'); controller.choose(kind === 'cat' ? { kind, id } : { kind: 'item', id: id as InteractionItem }); }
  };
  return { element, refreshNames() { render(controller.snapshot()); }, destroy() { unsubscribe(); element.onclick = null; element.remove(); } };
}
