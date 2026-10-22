import { catDisplayName } from './cat-names';
import { getCatDefinition } from './cat-definition';

// A short-lived preview dialog; ownership and the saved companion stay in storage.
export function openCompanionPicker(ids: readonly string[], selectedId: string | null, save: (id: string) => Promise<void>) {
  if (document.querySelector('dialog[open]')) return;
  const returnFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog'); dialog.className = 'companion-picker';
  dialog.setAttribute('aria-label', '更换主陪猫');
  const heading = document.createElement('h2'); heading.textContent = '更换主陪猫';
  const note = document.createElement('p'); note.textContent = '只更换专注陪伴，不改变小屋入住和当前计时。';
  const choices = document.createElement('div'); choices.className = 'companion-choices';
  const feedback = document.createElement('p'); feedback.setAttribute('role', 'status');
  let busy = false;
  for (const id of ids) {
    const cat = getCatDefinition(id);
    if (!cat?.animations.idle.frames.length || !cat.preview) continue;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pickCompanion = id;
    button.setAttribute('aria-pressed', String(id === selectedId));
    const image = document.createElement('img'); image.src = cat.preview; image.alt = '';
    const name = document.createElement('span'); name.textContent = catDisplayName(cat);
    button.append(image, name); choices.append(button);
    button.onclick = async () => {
      if (busy) return;
      busy = true; choices.querySelectorAll('button').forEach(node => node.disabled = true);
      try { await save(id); dialog.close(); }
      catch (error) { feedback.textContent = `更换失败：${(error as Error).message}`; }
      finally { busy = false; choices.querySelectorAll('button').forEach(node => node.disabled = false); }
    };
  }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => dialog.close();
  dialog.append(heading, note, choices, feedback, close); document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, { once: true });
  dialog.showModal();
}
