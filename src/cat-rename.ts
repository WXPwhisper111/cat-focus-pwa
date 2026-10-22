import { catDisplayName, normalizeCatName } from './cat-names';
import type { CatDefinition } from './cat-definition';

export function openCatRename(cat: CatDefinition, save: (name: string) => Promise<void>) {
  const dialog = document.createElement('dialog');
  dialog.className = 'companion-picker cat-rename';
  dialog.setAttribute('aria-labelledby', 'rename-cat-title');
  dialog.innerHTML = `<form><h2 id="rename-cat-title">修改猫咪名称</h2><p>只修改名称，不改变行动猫、主陪猫或当前动作。</p><label for="cat-new-name">猫咪名称（1–12 个字符）</label><input id="cat-new-name" name="name" autocomplete="off" required/><p role="alert" class="cat-rename-error"></p><div class="actions"><button type="button" data-cancel>取消</button><button class="primary" type="submit">保存名称</button></div></form>`;
  const input = dialog.querySelector('input')!;
  input.value = catDisplayName(cat);
  let busy = false;
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = close;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form')!.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const error = dialog.querySelector<HTMLElement>('[role=alert]')!;
    try {
      const name = normalizeCatName(input.value);
      busy = true; dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
      await save(name); busy = false; dialog.close();
    } catch (reason) {
      error.textContent = (reason as Error).message; busy = false;
      dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false); input.focus();
    }
  };
  document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
  return dialog;
}
