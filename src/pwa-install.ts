export const INSTALL_REMINDER_KEY = 'cat-focus:install-reminder-v1';
export const INSTALL_OBSERVED_KEY = 'cat-focus:installed-v1';
export type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform?: string };
export interface InstallPromptEvent extends Event { prompt(): Promise<InstallChoice | void>; userChoice?: Promise<InstallChoice> }
export type InstallState = { installed: boolean; standalone: boolean; canPrompt: boolean; busy: boolean; message: string; reminder: boolean };

export function createInstallController() {
  let deferred: InstallPromptEvent | undefined, busy = false, destroyed = false, message = '', pending = false, reminder = false, allowed = false;
  const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
  const write = (key: string, value: boolean) => { try { if (value) localStorage.setItem(key, '1'); else localStorage.removeItem(key); return true; } catch { return false; } };
  let observed = read(INSTALL_OBSERVED_KEY), handled = read(INSTALL_REMINDER_KEY);
  const modes = ['standalone', 'fullscreen', 'minimal-ui'].map(mode => typeof window.matchMedia === 'function' ? window.matchMedia(`(display-mode: ${mode})`) : undefined);
  const standalone = () => modes.some(mode => mode?.matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const installed = () => observed || standalone();
  if (standalone()) { observed = true; write(INSTALL_OBSERVED_KEY, true); }
  const listeners = new Set<(state: InstallState) => void>();
  const snapshot = (): InstallState => ({ installed: installed(), standalone: standalone(), canPrompt: !!deferred && !installed(), busy, message, reminder });
  function emit() { if (!destroyed) listeners.forEach(listener => listener(snapshot())); }
  function checkReminder() {
    if (installed()) { pending = false; reminder = false; }
    else if (pending && allowed && !document.hidden && !handled && !read(INSTALL_REMINDER_KEY)) {
      // Persist before showing. If storage is unavailable, never risk repeated nudges.
      handled = true; pending = false; reminder = write(INSTALL_REMINDER_KEY, true);
    }
  }
  const beforeInstall = (event: Event) => {
    const candidate = event as InstallPromptEvent;
    if (typeof candidate.prompt !== 'function') return;
    event.preventDefault();
    if (standalone()) return;
    observed = false; write(INSTALL_OBSERVED_KEY, false); deferred = candidate; message = ''; emit();
  };
  const appInstalled = () => { observed = true; write(INSTALL_OBSERVED_KEY, true); handled = true; write(INSTALL_REMINDER_KEY, true); deferred = undefined; message = ''; checkReminder(); emit(); };
  const environmentChanged = () => { if (standalone()) { observed = true; write(INSTALL_OBSERVED_KEY, true); } checkReminder(); emit(); };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === INSTALL_REMINDER_KEY || event.key === null) { handled = read(INSTALL_REMINDER_KEY); if (handled) { pending = false; reminder = false; } }
    if (event.key === INSTALL_OBSERVED_KEY || event.key === null) { observed = read(INSTALL_OBSERVED_KEY); if (observed) deferred = undefined; }
    checkReminder(); emit();
  };
  window.addEventListener('beforeinstallprompt', beforeInstall); window.addEventListener('appinstalled', appInstalled);
  window.addEventListener('storage', storageChanged); window.addEventListener('pageshow', environmentChanged);
  document.addEventListener('visibilitychange', environmentChanged);
  modes.forEach(mode => mode?.addEventListener('change', environmentChanged));
  return {
    snapshot,
    subscribe(listener: (state: InstallState) => void) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async install() {
      if (destroyed || busy || !deferred || installed()) return;
      const event = deferred; deferred = undefined; busy = true; message = '';
      try {
        // Invoke in the click call stack, before yielding, to preserve user activation.
        const prompted = event.prompt(); emit();
        const result = await prompted; const choice = event.userChoice ? await event.userChoice : result;
        message = choice?.outcome === 'dismissed' ? '暂不安装也没关系，你可以继续使用网页版。' : '请按浏览器提示完成；也可以参考下方手动指引。';
      } catch { message = '当前未能调起安装提示，可以按下方指引操作，或继续使用网页版。'; }
      finally { busy = false; emit(); }
    },
    noteFocusSaved() { if (!handled && !installed()) pending = true; },
    updateContext(canShow: boolean) { allowed = canShow; if (!canShow) reminder = false; checkReminder(); emit(); },
    dismissReminder() { pending = false; reminder = false; handled = true; write(INSTALL_REMINDER_KEY, true); emit(); },
    destroy() {
      destroyed = true; deferred = undefined; listeners.clear();
      window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', appInstalled);
      window.removeEventListener('storage', storageChanged); window.removeEventListener('pageshow', environmentChanged);
      document.removeEventListener('visibilitychange', environmentChanged); modes.forEach(mode => mode?.removeEventListener('change', environmentChanged));
    },
  };
}
export type InstallController = ReturnType<typeof createInstallController>;
