// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstallController } from '../src/pwa-install';
import { createInstallView, initialInstallBrowser, installBrowsers } from '../src/pwa-install-view';
import { mockDialogs } from './dialog-mocks';
let controller: ReturnType<typeof createInstallController>, view: ReturnType<typeof createInstallView>;
beforeEach(() => { localStorage.clear(); mockDialogs(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.body.innerHTML = '<div data-install-card-slot></div><div data-install-reminder-slot></div>'; controller = createInstallController(); view = createInstallView(controller, () => true); view.mount(); });
afterEach(() => { view.destroy(); controller.destroy(); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
it('offers manual guidance with no event, all nine choices, fallback and unchanged background state', () => {
  const appState = document.createElement('input'); appState.value = 'draft duration'; document.body.append(appState);
  document.querySelector<HTMLButtonElement>('[data-install-guide]')!.click(); const dialog = document.querySelector('dialog')!;
  expect(dialog.open).toBe(true); expect(dialog.querySelector<HTMLButtonElement>('[data-native-install]')!.hidden).toBe(true); const select = dialog.querySelector('select')!;
  expect(select.options).toHaveLength(9); expect(installBrowsers).toHaveLength(9);
  for (const [id] of installBrowsers) { select.value = id; select.dispatchEvent(new Event('change')); expect(dialog.querySelectorAll('li')).toHaveLength(id === 'edge' ? 5 : 3); }
  select.value = 'safari'; select.dispatchEvent(new Event('change')); expect(dialog.querySelector('ol')!.textContent).toContain('分享'); expect(dialog.querySelector('ol')!.textContent).toContain('添加到主屏幕');
  dialog.querySelector<HTMLButtonElement>('[data-web-continue]')!.click(); expect(document.querySelector('dialog')).toBeNull(); expect(appState.value).toBe('draft duration');
});
it('uses browser detection only as an initial guide preference including iPad desktop user agents', () => {
  expect(initialInstallBrowser('iPhone', 'iPhone', 1)).toBe('safari'); expect(initialInstallBrowser('Macintosh', 'MacIntel', 5)).toBe('safari');
  expect(initialInstallBrowser('Android HuaweiBrowser', '', 0)).toBe('edge'); expect(initialInstallBrowser('Android MiuiBrowser', '', 0)).toBe('edge');
  expect(initialInstallBrowser('Android HeyTapBrowser', '', 0)).toBe('edge'); expect(initialInstallBrowser('Android VivoBrowser', '', 0)).toBe('edge'); expect(initialInstallBrowser('Android Quark', '', 0)).toBe('edge');
  expect(initialInstallBrowser('Android Chrome', '', 0)).toBe('edge'); expect(initialInstallBrowser('Desktop', '', 0)).toBe('other');
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

it('shows recommended platforms, complete images in the same dialog, and recovers from image failures', () => {
  view.open(); const dialog = document.querySelector('dialog')!;
  const edge = dialog.querySelector<HTMLButtonElement>('[data-platform="edge"]')!; edge.click();
  expect(edge.getAttribute('aria-pressed')).toBe('true');
  expect(dialog.querySelectorAll('ol li')).toHaveLength(5);
  expect(dialog.querySelector('[data-guide-troubleshoot]')?.textContent).toContain('无需开启');
  const shot = dialog.querySelector<HTMLButtonElement>('.install-shot')!; shot.focus(); shot.click();
  expect(document.querySelectorAll('dialog')).toHaveLength(1);
  expect(dialog.querySelector<HTMLElement>('[data-guide-content]')!.hidden).toBe(true);
  expect(dialog.querySelector<HTMLImageElement>('[data-image-slot] img')!.src).toContain('edge-menu.webp');
  dialog.querySelector<HTMLButtonElement>('[data-image-back]')!.click();
  expect(document.activeElement).toBe(shot); expect(dialog.querySelector<HTMLElement>('[data-guide-content]')!.hidden).toBe(false);
  shot.querySelector('img')!.dispatchEvent(new Event('error'));
  expect(shot.disabled).toBe(true); expect(shot.textContent).toContain('文字操作');
  dialog.querySelector<HTMLButtonElement>('[data-platform="safari"]')!.click();
  expect(dialog.querySelectorAll('ol li')).toHaveLength(3); expect(dialog.querySelectorAll('ol img')).toHaveLength(2);
  expect(dialog.querySelector('[data-guide-troubleshoot]')).toBeNull();
  expect(dialog.textContent).toContain('分享');
});
it('keeps the native button conditional on a real deferred event even in a recommended guide', () => {
  view.open(); const dialog = document.querySelector('dialog')!;
  dialog.querySelector<HTMLButtonElement>('[data-platform="edge"]')!.click();
  expect(dialog.querySelector<HTMLButtonElement>('[data-native-install]')!.hidden).toBe(true);
  const event = new Event('beforeinstallprompt', {cancelable:true});
  Object.assign(event, {prompt:vi.fn(async () => {}),userChoice:Promise.resolve({outcome:'dismissed'})});
  window.dispatchEvent(event);
  expect(dialog.querySelector<HTMLButtonElement>('[data-native-install]')!.hidden).toBe(false);
});

it('closes the full-image guide for backdrop cancellation while Escape still returns to steps',()=>{
  view.open();const dialog=document.querySelector<HTMLDialogElement>('dialog')!;dialog.querySelector<HTMLButtonElement>('[data-platform="edge"]')!.click();dialog.querySelector<HTMLButtonElement>('.install-shot')!.click();
  const escape=new Event('cancel',{cancelable:true});expect(dialog.dispatchEvent(escape)).toBe(false);expect(dialog.querySelector<HTMLElement>('[data-image-view]')!.hidden).toBe(true);
  dialog.querySelector<HTMLButtonElement>('.install-shot')!.click();expect(dialog.dispatchEvent(new CustomEvent('cancel',{cancelable:true,detail:{source:'backdrop'}}))).toBe(true);dialog.close();expect(document.querySelector('dialog')).toBeNull();
});
