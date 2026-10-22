// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createStartup, STARTUP_THRESHOLD_MS } from '../src/startup';

const defer = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(initialize: () => Promise<void>) {
  const app = document.createElement('div'); app.innerHTML = '<nav><button>专注</button></nav>'; document.body.append(app);
  const ready = vi.fn(); const startup = createStartup(app, initialize, ready);
  return { app, ready, startup };
}
it('does not flash or hold back a fast initialization', async () => {
  vi.useFakeTimers(); const init = defer(); const f = fixture(() => init.promise); const running = f.startup.start();
  expect(f.app.hidden).toBe(true); expect(f.app.inert).toBe(true); expect(f.startup.element.hidden).toBe(true);
  vi.advanceTimersByTime(30); init.resolve(); await running;
  expect(f.app.hidden).toBe(false); expect(f.app.inert).toBe(false); expect(f.startup.element.isConnected).toBe(false); expect(f.ready).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('shows exact brand copy and the real icon after 120ms, then exits immediately without replay on foreground', async () => {
  vi.useFakeTimers(); const init = defer(); const initialize = vi.fn(() => init.promise); const f = fixture(initialize); const running = f.startup.start();
  vi.advanceTimersByTime(STARTUP_THRESHOLD_MS - 1); expect(f.startup.element.hidden).toBe(true);
  vi.advanceTimersByTime(1); expect(f.startup.element.hidden).toBe(false); expect(f.app.hidden).toBe(true);
  expect(f.startup.element.querySelector('h1')!.textContent).toBe('每一小步，都算数。');
  expect(f.startup.element.querySelector('.startup-eyebrow')!.textContent).toBe('今天也和猫咪一起');
  expect(f.startup.element.querySelector('.startup-subtitle')!.textContent).toBe('不用着急，慢慢积累，慢慢靠近自己想去的地方。');
  expect(f.startup.element.querySelector('footer')!.textContent).toBe('猫咪专注伙伴');
  expect(f.startup.element.querySelector('img')!.getAttribute('src')).toBe('./icon-512.png');
  init.resolve(); await running; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); await f.startup.start();
  expect(initialize).toHaveBeenCalledOnce(); expect(f.ready).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('shows a retry on failure, serializes attempts and recovers without reinitializing after success', async () => {
  vi.useFakeTimers(); const first = defer(), second = defer(); const initialize = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const f = fixture(initialize); const running = f.startup.start(); await f.startup.start(); expect(initialize).toHaveBeenCalledOnce();
  first.reject(Error('<img src=x onerror=alert(1)>')); await running;
  expect(f.startup.element.hidden).toBe(false); expect(f.startup.element.querySelector<HTMLElement>('.startup-error')!.hidden).toBe(false); expect(f.startup.element.querySelectorAll('img')).toHaveLength(1); expect(f.ready).not.toHaveBeenCalled();
  f.startup.element.querySelector('button')!.click(); f.startup.element.querySelector('button')!.click(); expect(initialize).toHaveBeenCalledTimes(2);
  second.resolve(); await vi.waitFor(() => expect(f.ready).toHaveBeenCalledOnce()); expect(f.app.hidden).toBe(false); expect(f.startup.element.isConnected).toBe(false);
});
it('cleans its pending display timer on disposal and ignores a late initialization result', async () => {
  vi.useFakeTimers(); const init = defer(); const f = fixture(() => init.promise); const running = f.startup.start(); f.startup.destroy(); init.resolve(); await running;
  expect(f.ready).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(f.startup.element.isConnected).toBe(false);
});
