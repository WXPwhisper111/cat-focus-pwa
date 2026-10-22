export const STARTUP_THRESHOLD_MS = 120;

// Owns only the initial presentation, never timer/data recovery or foreground events.
export function createStartup(app: HTMLElement, initialize: () => Promise<void>, onReady: () => void) {
  const element = document.createElement('section');
  element.className = 'startup-screen'; element.hidden = true;
  element.setAttribute('aria-label', '猫咪专注伙伴启动');
  element.innerHTML = `<div class="startup-content"><p class="startup-eyebrow">今天也和猫咪一起</p><img class="startup-icon" src="./icon-512.png" width="512" height="512" alt=""/><div class="startup-copy"><h1>每一小步，都算数。</h1><p class="startup-subtitle">不用着急，慢慢积累，慢慢靠近自己想去的地方。</p></div><div class="startup-error" hidden><p role="alert">无法准备本地数据，请检查浏览器存储权限后重试。</p><button type="button">重试</button></div></div><footer>猫咪专注伙伴</footer>`;
  document.body.append(element);
  app.hidden = true; app.inert = true;
  let running = false, ready = false, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const error = element.querySelector<HTMLElement>('.startup-error')!;
  const retry = element.querySelector<HTMLButtonElement>('button')!;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  async function start() {
    if (running || ready || disposed) return;
    running = true; error.hidden = true; retry.disabled = true;
    timer = setTimeout(() => { timer = undefined; if (!disposed && running) element.hidden = false; }, STARTUP_THRESHOLD_MS);
    try {
      await initialize();
    } catch {
      if (disposed) return;
      clearTimer(); running = false; element.hidden = false; error.hidden = false; retry.disabled = false;
      retry.focus({ preventScroll: true });
      return;
    }
    if (disposed) return;
    clearTimer(); ready = true; running = false;
    element.remove(); app.hidden = false; app.inert = false;
    onReady();
  }

  retry.onclick = () => { void start(); };
  return { element, start, destroy() { disposed = true; clearTimer(); retry.onclick = null; element.remove(); } };
}
