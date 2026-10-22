import type { InstallController, InstallState } from './pwa-install';
export const installBrowsers = [
  ['android', '通用 Android 浏览器'], ['huawei', '华为浏览器'], ['xiaomi', '小米浏览器'], ['oppo', 'OPPO 浏览器'],
  ['vivo', 'vivo 浏览器'], ['quark', '夸克浏览器'], ['safari', 'iOS Safari'], ['other', '其他浏览器'],
] as const;
export type InstallBrowser = typeof installBrowsers[number][0];
export function initialInstallBrowser(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints): InstallBrowser {
  if (/iPad|iPhone|iPod/i.test(ua) || /Mac/i.test(platform) && touch > 1) return 'safari';
  if (/HuaweiBrowser/i.test(ua)) return 'huawei'; if (/MiuiBrowser/i.test(ua)) return 'xiaomi';
  if (/HeyTapBrowser|OppoBrowser/i.test(ua)) return 'oppo'; if (/VivoBrowser/i.test(ua)) return 'vivo'; if (/Quark/i.test(ua)) return 'quark';
  return /Android/i.test(ua) ? 'android' : 'other';
}
export function installSteps(browser: InstallBrowser): string[] {
  if (browser === 'safari') return ['在 iPhone 或 iPad 上用 Safari 打开当前网址。', '打开 Safari 的分享菜单，查找“添加到主屏幕”。按钮位置可能随系统版本不同。', '按系统提示确认名称并添加；若未找到该选项，可检查分享菜单中的更多操作。'];
  if (browser === 'other') return ['打开当前浏览器菜单，查找“安装应用”“添加到桌面”或类似选项。', '如果没有找到，可换用手机的系统浏览器，或在 iPhone / iPad 上使用 Safari。', '桌面电脑可查看地址栏或浏览器菜单中的安装入口；没有入口也能继续使用网页。'];
  return ['用所选浏览器直接打开当前网址；若在聊天应用内打开，请先尝试在浏览器中打开。', '打开浏览器菜单，查找“添加到桌面”“添加到主屏幕”“安装应用”或类似选项。', '按浏览器提示完成。菜单名称和位置因设备及版本而异，可能添加的是网页快捷方式。'];
}
export function createInstallView(controller: InstallController, canRemind: () => boolean) {
  const card = document.createElement('section'); card.className = 'panel install-card'; card.setAttribute('aria-label', '添加到手机桌面');
  card.innerHTML = '<div class="install-card-heading"><img src="./icon-192.png" alt="" width="52" height="52"/><div><small>添加到手机桌面</small><h2>把猫咪带到桌面吧</h2></div></div><p>下次想专注时，点一下就能回来。</p><p data-install-status class="install-status"></p><button type="button" class="primary" data-install-guide>查看安装指引</button><p class="hint">暂时不想安装？直接在浏览器中使用也完全可以。</p>';
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
    dialog.innerHTML = `<header><div><small>添加到手机桌面</small><h2 id="install-guide-title">把猫咪带到桌面吧</h2></div><button type="button" data-guide-close aria-label="关闭安装指引">×</button></header><p>下次想专注时，点一下就能回来。</p><button type="button" class="primary" data-native-install hidden>安装到桌面</button><p data-install-result role="status"></p><label for="install-browser">选择你的浏览器</label><select id="install-browser">${installBrowsers.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><ol data-install-steps></ol><p class="hint">未出现安装按钮，不代表浏览器不支持添加到桌面。各浏览器菜单尚待手机实机验证，请以当前版本实际显示为准。</p><section class="install-fallback"><h3>暂时无法安装？</h3><p>继续在网页中使用也完全可以。你还可以在浏览器菜单中查找“添加书签”或“收藏”，方便下次访问。</p><p>以后可随时从“设置 → 查看安装指引”重新查看。</p><button type="button" data-web-continue>继续使用网页版</button></section>`;
    const select = dialog.querySelector<HTMLSelectElement>('select')!; select.value = browser;
    const steps = () => { const list = dialog!.querySelector('ol')!; list.replaceChildren(...installSteps(browser).map(text => { const item = document.createElement('li'); item.textContent = text; return item; })); };
    select.onchange = () => { browser = select.value as InstallBrowser; steps(); };
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
