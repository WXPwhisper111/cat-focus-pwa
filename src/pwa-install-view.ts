import type { InstallController, InstallState } from './pwa-install';
import { installBrowsers, initialInstallBrowser, renderGuide, fullGuideImage, type InstallBrowser } from './install-guide';
export { installBrowsers, initialInstallBrowser, installSteps } from './install-guide';
export function createInstallView(controller: InstallController, canRemind: () => boolean) {
  const card = document.createElement('section'); card.className = 'panel install-card'; card.setAttribute('aria-label', '添加到手机桌面');
  card.innerHTML = '<div class="install-card-heading"><img src="./icon-192.png" alt="" width="52" height="52"/><div><small>添加到手机桌面</small><h2>把猫咪带到桌面吧</h2></div></div><p>下次想专注时，点一下就能回来。</p><p class="hint">根据目前内测，iPhone / iPad 推荐 Safari，Android 推荐 Edge；不同设备和版本表现可能不同。</p><p data-install-status class="install-status"></p><button type="button" class="primary" data-install-guide>查看安装指引</button><p class="hint">暂时不想安装？直接在浏览器中使用也完全可以。</p>';
  const reminder = document.createElement('aside'); reminder.className = 'install-reminder'; reminder.hidden = true; reminder.setAttribute('aria-label', '桌面安装提醒');
  reminder.innerHTML = '<div><strong>把猫咪带到桌面吧</strong><p>下次想专注时，点一下就能回来。</p><button type="button" data-reminder-guide>查看安装指引</button></div><button type="button" data-reminder-close aria-label="关闭安装提醒">×</button>';
  let dialog: HTMLDialogElement | undefined, returnFocus: HTMLElement | null = null, browser = initialInstallBrowser();
  function update(state: InstallState) {
    card.querySelector('[data-install-status]')!.textContent = state.standalone ? '当前已在独立窗口中使用。' : state.installed ? '已记录安装完成，无需再次安装。' : '可按浏览器提示安装，或查看手动添加方法。';
    reminder.hidden = !state.reminder || !canRemind();
    if (!dialog) return;
    const native = dialog.querySelector<HTMLButtonElement>('[data-native-install]')!;
    native.hidden = !state.canPrompt && !state.busy; native.disabled = state.busy; native.textContent = state.busy ? '等待浏览器处理…' : '安装到桌面';
    dialog.querySelector('[data-install-result]')!.textContent = state.installed ? '当前无需再次安装；下方指引仍可查看。' : state.message;
  }
  const unsubscribe = controller.subscribe(update);
  function close() { dialog?.close(); }
  function open() {
    if (dialog?.open || document.querySelector('dialog[open]')) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; controller.dismissReminder();
    dialog = document.createElement('dialog'); dialog.className = 'install-dialog'; dialog.setAttribute('aria-labelledby', 'install-guide-title');
    dialog.innerHTML = `<header><div><small>添加到手机桌面</small><h2 id="install-guide-title">把猫咪带到桌面吧</h2></div><button type="button" data-guide-close aria-label="关闭安装指引">×</button></header><p>下次想专注时，点一下就能回来。</p><button type="button" class="primary" data-native-install hidden>安装到桌面</button><p data-install-result role="status"></p><div data-guide-content><div class="install-platforms" role="group" aria-label="推荐安装浏览器"><button type="button" data-platform="safari">iPhone / iPad · Safari</button><button type="button" data-platform="edge">Android · Edge</button></div><p class="hint">根据目前内测推荐以上浏览器，不保证所有设备和版本表现一致。</p><details data-other-browsers><summary>其他浏览器</summary><label for="install-browser">选择你的浏览器</label><select id="install-browser">${installBrowsers.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></details><p class="hint">截图示例，位置和名称可能因版本不同。请在可信 HTTPS 网站中操作；没有安装按钮也可查看手动指引。</p><ol data-install-steps></ol><section class="install-fallback"><h3>暂时无法安装？</h3><p>继续在网页中使用也完全可以。你还可以在浏览器菜单中查找“添加书签”或“收藏”，方便下次访问。</p><p>以后可随时从“设置 → 查看安装指引”重新查看。</p><button type="button" data-web-continue>继续使用网页版</button></section></div><section data-image-view hidden><button type="button" data-image-back>← 返回步骤</button><p data-image-title></p><div data-image-slot></div></section>`;
    const select = dialog.querySelector<HTMLSelectElement>('select')!; select.value = browser;
    let imageOpener: HTMLButtonElement | undefined, savedScroll = 0;
    const back = () => {
      dialog!.querySelector<HTMLElement>('[data-image-view]')!.hidden = true;
      dialog!.querySelector<HTMLElement>('[data-guide-content]')!.hidden = false;
      dialog!.querySelector('[data-image-slot]')!.replaceChildren();
      dialog!.scrollTop = savedScroll; imageOpener?.focus({ preventScroll: true });
    };
    const steps = () => {
      dialog!.querySelector('[data-guide-troubleshoot]')?.remove();
      dialog!.querySelector<HTMLDetailsElement>('[data-other-browsers]')!.open = !['edge','safari'].includes(browser);
      for (const button of dialog!.querySelectorAll<HTMLButtonElement>('[data-platform]')) button.setAttribute('aria-pressed', String(button.dataset.platform === browser));
      renderGuide(dialog!.querySelector('ol')!, browser, (id, title, opener) => {
        imageOpener = opener; savedScroll = dialog!.scrollTop;
        dialog!.querySelector<HTMLElement>('[data-guide-content]')!.hidden = true;
        dialog!.querySelector<HTMLElement>('[data-image-view]')!.hidden = false;
        dialog!.querySelector('[data-image-title]')!.textContent = title;
        dialog!.querySelector('[data-image-slot]')!.replaceChildren(fullGuideImage(id, title));
        dialog!.scrollTop = 0; dialog!.querySelector<HTMLButtonElement>('[data-image-back]')!.focus({ preventScroll: true });
      });
    };
    select.onchange = () => { browser = select.value as InstallBrowser; steps(); };
    dialog.querySelector<HTMLButtonElement>('[data-image-back]')!.onclick = back;
    dialog.addEventListener('cancel', event => {
      if (!dialog!.querySelector<HTMLElement>('[data-image-view]')!.hidden) { event.preventDefault(); back(); }
    });
    dialog.querySelectorAll<HTMLButtonElement>('[data-platform]').forEach(button => button.onclick = () => { browser = button.dataset.platform as InstallBrowser; select.value = browser; steps(); });
    dialog.querySelector<HTMLButtonElement>('[data-native-install]')!.onclick = () => { void controller.install(); };
    dialog.querySelector<HTMLButtonElement>('[data-guide-close]')!.onclick = close;
    dialog.querySelector<HTMLButtonElement>('[data-web-continue]')!.onclick = close;
    dialog.addEventListener('close', () => { dialog?.remove(); dialog = undefined; if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true }); else (document.querySelector<HTMLElement>('#start, #pause') || document.querySelector<HTMLElement>('[data-install-guide]'))?.focus({ preventScroll: true }); }, { once: true });
    steps(); update(controller.snapshot()); document.body.append(dialog); dialog.showModal();
  }
  card.querySelector<HTMLButtonElement>('[data-install-guide]')!.onclick = open;
  reminder.querySelector<HTMLButtonElement>('[data-reminder-guide]')!.onclick = open;
  reminder.querySelector<HTMLButtonElement>('[data-reminder-close]')!.onclick = () => controller.dismissReminder();
  const contextChanged = () => { controller.updateContext(canRemind()); };
  const afterClose = () => queueMicrotask(contextChanged);
  document.addEventListener('close', afterClose, true); document.addEventListener('visibilitychange', contextChanged);
  return {
    mount() {
      document.querySelector('[data-install-card-slot]')?.append(card);
      const slot = document.querySelector('[data-install-reminder-slot]');
      if (slot) slot.append(reminder); else reminder.remove();
      contextChanged();
    },
    open,
    destroy() { unsubscribe(); document.removeEventListener('close', afterClose, true); document.removeEventListener('visibilitychange', contextChanged); dialog?.remove(); dialog = undefined; card.remove(); reminder.remove(); },
  };
}
