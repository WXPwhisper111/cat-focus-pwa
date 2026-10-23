// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createAppUpdateView } from '../src/app-update-view';
import type { AppUpdate, UpdateState } from '../src/app-update';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
it('uses document flow, exposes real resource counts and blocks updates for a paused session', () => {
  document.body.innerHTML = '<div data-update-card-slot></div><div data-update-banner-slot></div>';
  vi.stubGlobal('matchMedia', () => ({matches:false}));
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

it('defers guidance behind welcome and dialogs, then navigates and starts one guarded update', async () => {
  vi.stubGlobal('matchMedia', () => ({matches:true})); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.body.innerHTML = '<div data-update-card-slot></div><div data-update-banner-slot></div><dialog></dialog>';
  let pendingWelcome = true, active = false, changed!: (state:UpdateState)=>void;
  const state: UpdateState = {phase:'ready',current:'old',latest:'new',message:'',applying:false,mediaPhase:'complete',cached:5,total:5};
  let finish!: ()=>void; const apply = vi.fn(() => new Promise<void>(resolve => { finish=resolve; }));
  const openSettings = vi.fn();
  const controller = {snapshot:()=>({...state}),subscribe:(fn:typeof changed)=>{changed=fn;fn(state);return ()=>{};},apply,check:vi.fn(),retryMedia:vi.fn()} as unknown as AppUpdate;
  const view = createAppUpdateView(controller,()=>active,{canShow:()=>!pendingWelcome&&!document.querySelector('dialog[open]'),openSettings}); view.mount();
  const banner = document.querySelector<HTMLElement>('.app-update-banner')!;
  expect(banner.hidden).toBe(true); pendingWelcome=false;
  const welcome = document.querySelector('dialog')!; welcome.setAttribute('open',''); changed(state); expect(banner.hidden).toBe(true);
  welcome.removeAttribute('open'); await vi.waitFor(()=>expect(banner.hidden).toBe(false));
  active=true; view.mount(); expect(banner.textContent).toContain('暂停');
  const button = banner.querySelector<HTMLButtonElement>('button')!; expect(button.disabled).toBe(false);
  button.click(); button.click(); expect(openSettings).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
  finish(); await Promise.resolve(); state.phase='current'; changed(state); expect(banner.hidden).toBe(true);
  view.destroy();
});
