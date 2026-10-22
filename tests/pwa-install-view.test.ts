// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstallController } from '../src/pwa-install';
import { createInstallView, initialInstallBrowser, installBrowsers } from '../src/pwa-install-view';
import { mockDialogs } from './dialog-mocks';
let controller: ReturnType<typeof createInstallController>, view: ReturnType<typeof createInstallView>;
beforeEach(() => { localStorage.clear(); mockDialogs(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.body.innerHTML = '<div data-install-card-slot></div><div data-install-reminder-slot></div>'; controller = createInstallController(); view = createInstallView(controller, () => true); view.mount(); });
afterEach(() => { view.destroy(); controller.destroy(); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
it('offers manual guidance with no event, all eight choices, fallback and unchanged background state', () => {
  const appState = document.createElement('input'); appState.value = 'draft duration'; document.body.append(appState);
  document.querySelector<HTMLButtonElement>('[data-install-guide]')!.click(); const dialog = document.querySelector('dialog')!;
  expect(dialog.open).toBe(true); expect(dialog.querySelector<HTMLButtonElement>('[data-native-install]')!.hidden).toBe(true); const select = dialog.querySelector('select')!;
  expect(select.options).toHaveLength(8); expect(installBrowsers).toHaveLength(8);
  for (const [id] of installBrowsers) { select.value = id; select.dispatchEvent(new Event('change')); expect(dialog.querySelectorAll('li')).toHaveLength(3); }
  select.value = 'safari'; select.dispatchEvent(new Event('change')); expect(dialog.querySelector('ol')!.textContent).toContain('分享'); expect(dialog.querySelector('ol')!.textContent).toContain('添加到主屏幕');
  dialog.querySelector<HTMLButtonElement>('[data-web-continue]')!.click(); expect(document.querySelector('dialog')).toBeNull(); expect(appState.value).toBe('draft duration');
});
it('uses browser detection only as an initial guide preference including iPad desktop user agents', () => {
  expect(initialInstallBrowser('iPhone', 'iPhone', 1)).toBe('safari'); expect(initialInstallBrowser('Macintosh', 'MacIntel', 5)).toBe('safari');
  expect(initialInstallBrowser('Android HuaweiBrowser', '', 0)).toBe('huawei'); expect(initialInstallBrowser('Android MiuiBrowser', '', 0)).toBe('xiaomi');
  expect(initialInstallBrowser('Android HeyTapBrowser', '', 0)).toBe('oppo'); expect(initialInstallBrowser('Android VivoBrowser', '', 0)).toBe('vivo'); expect(initialInstallBrowser('Android Quark', '', 0)).toBe('quark');
  expect(initialInstallBrowser('Android Chrome', '', 0)).toBe('android'); expect(initialInstallBrowser('Desktop', '', 0)).toBe('other');
});
it('updates install status without recreating the dialog or changing the selected tutorial', () => {
  view.open(); const dialog = document.querySelector('dialog')!; const select = dialog.querySelector('select')!; select.value = 'vivo'; select.dispatchEvent(new Event('change'));
  window.dispatchEvent(new Event('appinstalled')); expect(dialog.querySelector('[data-install-result]')!.textContent).toContain('无需再次安装'); expect(select.value).toBe('vivo'); expect(document.querySelector('dialog')).toBe(dialog);
});

it('returns focus to timer controls when the reminder opener is now hidden', () => {
  const start = document.createElement('button'); start.id = 'start'; document.body.append(start);
  controller.noteFocusSaved(); controller.updateContext(true);
  const opener = document.querySelector<HTMLButtonElement>('[data-reminder-guide]')!; opener.focus(); opener.click();
  document.querySelector<HTMLButtonElement>('[data-web-continue]')!.click();
  expect(document.activeElement).toBe(start);
});
