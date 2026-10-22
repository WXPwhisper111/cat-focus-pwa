import { catDisplayName } from './cat-names';
import { catDefinitions, getCatDefinition } from './cat-definition';
import { createCatPlayer } from './cat-player';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function createCatAdoption(confirm: (id: string) => Promise<void>) {
  const element = document.createElement('section');
  element.className = 'cat-adoption';
  let selectedId = catDefinitions[0].id, busy = false, destroyed = false, message = '';
  let player: ReturnType<typeof createCatPlayer> | undefined;
  function render() {
    if (destroyed) return;
    player?.destroy();
    element.innerHTML = `<header class="hero"><div class="eyebrow">从今天起，一起生活</div><h1>领养一位小伙伴</h1><p>选一只猫，陪你专注，也住进自己的小屋。</p></header>
      <div class="adoption-choices" role="group" aria-label="选择首次领养的猫咪">${catDefinitions.map(cat => `<button class="adoption-card" type="button" data-cat-choice="${escape(cat.id)}" aria-pressed="${selectedId === cat.id}" ${busy ? 'disabled' : ''}><img class="adoption-preview" src="${cat.preview}" alt="${escape(catDisplayName(cat))}预览" draggable="false"/><span class="adoption-card-text"><strong>${escape(catDisplayName(cat))}</strong><span>${escape(cat.description)}</span><small>${selectedId === cat.id ? '已选中 · 正在陪你打招呼' : '点击看看这位小伙伴'}</small></span><span class="adoption-check" aria-hidden="true">${selectedId === cat.id ? '✓' : ''}</span></button>`).join('')}</div>
      <p class="adoption-rule">确认后，这只猫会住进小屋并成为主陪伴猫。本阶段暂不提供重新选择。</p>
      <p class="adoption-error" role="alert" ${message ? '' : 'hidden'}>${escape(message)}</p>
      <button id="confirm-adoption" class="primary wide" type="button" ${busy ? 'disabled' : ''}>${busy ? '正在领养…' : `确认领养 · ${escape(catDisplayName(getCatDefinition(selectedId)!))}`}</button>`;
    const selected = element.querySelector<HTMLButtonElement>(`[data-cat-choice="${selectedId}"]`)!;
    player = createCatPlayer(selected.querySelector<HTMLImageElement>('img')!, 'idle', {
      definition: getCatDefinition(selectedId)!,
      onError: () => {
        if (!destroyed) {
          const error = element.querySelector<HTMLElement>('.adoption-error')!;
          error.hidden = false; error.textContent = '猫咪预览暂时无法加载，请联网后重试。';
        }
      },
    });
    element.querySelectorAll<HTMLButtonElement>('[data-cat-choice]').forEach(button => button.onclick = () => {
      if (busy || selectedId === button.dataset.catChoice) return;
      selectedId = button.dataset.catChoice!; message = ''; render();
      element.querySelector<HTMLButtonElement>(`[data-cat-choice="${selectedId}"]`)?.focus();
    });
    element.querySelector<HTMLButtonElement>('#confirm-adoption')!.onclick = async () => {
      if (busy || destroyed) return;
      busy = true; message = ''; render();
      try { await confirm(selectedId); }
      catch (error) { message = (error as Error).message || '领养未能保存，请重试。'; }
      finally { busy = false; if (!destroyed) render(); }
    };
  }
  render();
  return { element, destroy() { destroyed = true; player?.destroy(); element.remove(); } };
}
