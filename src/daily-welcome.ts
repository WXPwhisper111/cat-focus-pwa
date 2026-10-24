import { catDisplayName } from './cat-names';
import { icon } from './category-icons';
import { createCatPlayer } from './cat-player';
import type { CatDefinition } from './cat-definition';

export function createDailyWelcome(onStart: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'daily-welcome';
  dialog.setAttribute('aria-labelledby', 'welcome-title');
  dialog.setAttribute('aria-describedby', 'welcome-message');
  dialog.innerHTML = `<button type="button" id="welcome-close" class="welcome-close" aria-label="关闭每日欢迎">×</button><div class="welcome-eyebrow">新的一天，新的小小积累</div><div class="welcome-cat" aria-hidden="true"></div><h2 id="welcome-title">今日签到成功！</h2><div class="welcome-reward"><span aria-hidden="true">${icon('paw-coin')}</span> +5 <span>猫爪币</span></div><p id="welcome-message">今天也和猫咪一起，专注一会儿吧。</p><button type="button" id="welcome-start" class="primary wide">开始今天的专注</button><small>奖励已自动存入钱包，无需领取</small>`;
  document.body.append(dialog);
  let player: ReturnType<typeof createCatPlayer> | undefined;
  let previousFocus: HTMLElement | null = null;
  function stop() { player?.destroy(); player = undefined; }
  function hide() { stop(); if (dialog.open) dialog.close(); }
  dialog.querySelector<HTMLButtonElement>('#welcome-close')!.onclick = hide;
  dialog.querySelector<HTMLButtonElement>('#welcome-start')!.onclick = () => { hide(); onStart(); };
  dialog.addEventListener('close', () => { stop(); if (previousFocus?.isConnected) previousFocus.focus(); });
  dialog.addEventListener('cancel', () => { stop(); });
  return {
    show(cat?: CatDefinition) {
      if (dialog.open) return;
      dialog.querySelector('#welcome-message')!.textContent = `今天也和${cat ? catDisplayName(cat) : '猫咪'}一起，专注一会儿吧。`;
      stop(); previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const host = dialog.querySelector<HTMLElement>('.welcome-cat')!;
      host.replaceChildren();
      if (cat) {
        const image = document.createElement('img'); image.src = cat.preview; image.alt = '';
        host.append(image); player = createCatPlayer(image, 'idle', { definition: cat });
      } else { host.innerHTML = `<span class="welcome-paw" aria-hidden="true">${icon('paw-coin')}</span>`; }
      dialog.showModal(); dialog.querySelector<HTMLButtonElement>('#welcome-start')!.focus();
    },
    hide,
    destroy() { hide(); dialog.remove(); },
  };
}
