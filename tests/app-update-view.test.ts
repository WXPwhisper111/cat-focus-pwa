// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createAppUpdateView } from '../src/app-update-view';
import type { AppUpdate, UpdateState } from '../src/app-update';
it('uses document flow, exposes real resource counts and blocks updates for a paused session', () => {
  document.body.innerHTML = '<div data-update-card-slot></div><div data-update-banner-slot></div>';
  let active = false, changed!: (state: UpdateState) => void;
  const state: UpdateState = { phase: 'ready', current: 'a', latest: 'b', message: '', applying: false, mediaPhase: 'error', cached: 3, total: 5 };
  const apply = vi.fn(); const unsubscribe = vi.fn();
  const controller = { snapshot: () => ({ ...state }), subscribe: (fn: typeof changed) => { changed = fn; fn(state); return unsubscribe; }, apply, check: vi.fn(), retryMedia: vi.fn() } as unknown as AppUpdate;
  const view = createAppUpdateView(controller, () => active); view.mount();
  expect(document.querySelector('[data-update-media]')!.textContent).toContain('3 / 5');
  active = true; view.mount(); expect([...document.querySelectorAll<HTMLButtonElement>('[data-update-apply]')].every(button => button.disabled)).toBe(true);
  active = false; state.message = '另一个窗口正在专注'; changed(state); expect(document.querySelector('.app-update-banner p')!.textContent).toContain('另一个窗口');
  document.querySelector<HTMLButtonElement>('.app-update-banner button')!.click(); expect(apply).toHaveBeenCalledOnce();
  view.destroy(); expect(unsubscribe).toHaveBeenCalledOnce(); document.body.replaceChildren();
});
