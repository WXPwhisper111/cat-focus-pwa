// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstallController, INSTALL_OBSERVED_KEY, INSTALL_REMINDER_KEY, type InstallPromptEvent } from '../src/pwa-install';
let controller: ReturnType<typeof createInstallController> | undefined;
beforeEach(() => { localStorage.clear(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { controller?.destroy(); controller = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
function promptEvent(prompt = vi.fn(async () => ({ outcome: 'dismissed' as const }))) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  event.prompt = prompt; window.dispatchEvent(event); return { event, prompt };
}
it('captures a real-shaped event without prompting, invokes synchronously on user request and consumes it once', async () => {
  controller = createInstallController(); expect(controller.snapshot().canPrompt).toBe(false);
  const { event, prompt } = promptEvent(); expect(event.defaultPrevented).toBe(true); expect(prompt).not.toHaveBeenCalled(); expect(controller.snapshot().canPrompt).toBe(true);
  const started = controller.install(); expect(prompt).toHaveBeenCalledOnce(); await controller.install(); await started;
  expect(controller.snapshot()).toMatchObject({ canPrompt: false, installed: false, busy: false }); expect(controller.snapshot().message).toContain('继续使用网页版');
  await controller.install(); expect(prompt).toHaveBeenCalledOnce();
});
it('keeps manual fallback on prompt errors and does not infer installation from acceptance', async () => {
  controller = createInstallController(); promptEvent(vi.fn(async () => { throw Error('not available'); })); await controller.install();
  expect(controller.snapshot().message).toContain('下方指引'); expect(controller.snapshot().installed).toBe(false);
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  event.prompt = vi.fn(async () => {}); event.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(event); await controller.install(); expect(controller.snapshot().installed).toBe(false);
  window.dispatchEvent(new Event('appinstalled')); expect(controller.snapshot()).toMatchObject({ installed: true, canPrompt: false, reminder: false });
  expect(localStorage.getItem(INSTALL_OBSERVED_KEY)).toBe('1');
});
it('suppresses known installed promotion until a fresh valid install event proves availability', () => {
  localStorage.setItem(INSTALL_OBSERVED_KEY, '1'); controller = createInstallController(); controller.noteFocusSaved(); controller.updateContext(true);
  expect(controller.snapshot()).toMatchObject({ installed: true, reminder: false }); promptEvent(); expect(controller.snapshot()).toMatchObject({ installed: false, canPrompt: true });
});
it('recognizes independent display modes and iOS standalone without requiring install events', () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('standalone'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  controller = createInstallController(); promptEvent(); expect(controller.snapshot()).toMatchObject({ installed: true, standalone: true, canPrompt: false }); controller.destroy();
  vi.stubGlobal('matchMedia', undefined); Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  controller = createInstallController(); expect(controller.snapshot().standalone).toBe(true); delete (navigator as Navigator & { standalone?: boolean }).standalone;
});
it('waits for a valid settled focus and clear UI, persists once before showing and suppresses later visits', () => {
  controller = createInstallController(); controller.updateContext(true); expect(controller.snapshot().reminder).toBe(false);
  controller.noteFocusSaved(); controller.updateContext(false); expect(controller.snapshot().reminder).toBe(false); expect(localStorage.getItem(INSTALL_REMINDER_KEY)).toBeNull();
  controller.updateContext(true); expect(controller.snapshot().reminder).toBe(true); expect(localStorage.getItem(INSTALL_REMINDER_KEY)).toBe('1'); controller.updateContext(false); controller.updateContext(true); expect(controller.snapshot().reminder).toBe(false); controller.dismissReminder(); controller.destroy();
  controller = createInstallController(); controller.noteFocusSaved(); controller.updateContext(true); expect(controller.snapshot().reminder).toBe(false);
});
it('honors cross-tab dismissal and skips nudges when persistent storage cannot be written', () => {
  controller = createInstallController(); controller.noteFocusSaved(); controller.updateContext(true); expect(controller.snapshot().reminder).toBe(true);
  window.dispatchEvent(new StorageEvent('storage', { key: INSTALL_REMINDER_KEY, newValue: '1' })); expect(controller.snapshot().reminder).toBe(false); controller.destroy(); localStorage.clear();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); }); controller = createInstallController(); controller.noteFocusSaved(); controller.updateContext(true); expect(controller.snapshot().reminder).toBe(false);
});
it('removes listeners on disposal, so later browser events have no effect', () => {
  controller = createInstallController(); const listener = vi.fn(); controller.subscribe(listener); controller.destroy(); promptEvent(); window.dispatchEvent(new Event('appinstalled')); expect(listener).toHaveBeenCalledOnce();
});
