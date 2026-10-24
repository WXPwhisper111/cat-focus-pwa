import { createUpdateDialog } from './update-dialog';
import currentRelease from '../release-notes.json';
import type { AppUpdate, UpdateState } from './app-update';
export function createAppUpdateView(controller: AppUpdate, active: () => boolean, guide?: { canShow: () => boolean; openSettings: () => void }) {
  const card = document.createElement('section'); card.className = 'panel app-update-card'; card.setAttribute('aria-label', '应用更新'); card.id = 'app-update-section';
  card.innerHTML = '<div class="eyebrow">版本与离线使用</div><h2 tabindex="-1">应用更新</h2><p data-update-version></p><p data-update-state role="status"></p><div class="actions"><button type="button" data-update-check>检查更新</button><button type="button" class="primary" data-update-apply hidden>立即更新</button></div><div class="update-media"><strong>离线素材</strong><p data-update-media></p><button type="button" data-update-retry>重试素材下载</button></div><p class="hint">动画和房间素材会分批下载。准备完成后可完整离线使用；更新不会清除本地记录。</p><button type="button" id="diagnostics">复制诊断信息</button><details class="update-release-notes"><summary>查看本版本更新内容</summary><h3></h3><ul></ul></details>';
  const banner = document.createElement('aside'); banner.className = 'app-update-banner'; banner.hidden = true;
  banner.setAttribute('aria-label', '更新指引'); banner.setAttribute('role', 'status');
  banner.innerHTML = '<div><strong>发现新版本</strong><p>前往设置更新，保留现有数据。</p></div><button type="button" data-update-guide>前往更新</button>';
  let guideBusy = false, disposed = false;
  const labels = { idle: '准备检查更新', checking: '正在检查更新…', current: '当前页面已是已检测到的最新版本。', ready: '新版本已就绪，刷新后使用。', offline: '当前离线，联网后可以检查更新。', error: '检查更新未完成，可以重试。', unsupported: '当前环境不支持离线更新，请在可信 HTTPS 网站中使用。' };
  let updateDialog:ReturnType<typeof createUpdateDialog>|undefined;
  function update(state: UpdateState) {
    if (disposed) return;
    const notes=state.release || (state.phase==='current'?currentRelease:undefined);
    card.querySelector('.update-release-notes h3')!.textContent=notes?.title||'更新内容暂不可用';
    const list=card.querySelector('.update-release-notes ul')!;list.replaceChildren();for(const text of notes?.summary||[]){const li=document.createElement('li');li.textContent=text;list.append(li);}
    updateDialog?.update(state);
    card.querySelector('[data-update-version]')!.textContent = `当前版本：${state.current}${state.phase === 'ready' ? ` · 新版本：${state.latest}` : ''}`;
    card.querySelector('[data-update-state]')!.textContent = `${labels[state.phase]}${state.message ? ' ' + state.message : ''}`;
    const check = card.querySelector<HTMLButtonElement>('[data-update-check]')!; check.disabled = state.phase === 'unsupported' || state.phase === 'checking';
    const mediaLabels = { pending: '尚未读取素材状态。', downloading: '正在下载', complete: '已准备完成，可以完整离线使用。', paused: '下载已暂停，回到前台并联网后继续。', error: '部分素材未下载完成，已完成部分会保留，可重试。' };
    card.querySelector('[data-update-media]')!.textContent = `${state.total ? `${state.cached} / ${state.total} 个文件 · ` : ''}${mediaLabels[state.mediaPhase]}`;
    card.querySelector<HTMLButtonElement>('[data-update-retry]')!.disabled = state.phase === 'unsupported' || state.mediaPhase === 'downloading' || state.mediaPhase === 'complete';
    banner.hidden = state.phase !== 'ready' || document.hidden || !!guide && !guide.canShow();
    banner.querySelector('p')!.textContent = state.message || (active() ? '前往设置查看；请先结束正在运行或暂停的专注，再更新。' : '点击进入设置并开始更新，现有数据会保留。');
    banner.querySelector<HTMLButtonElement>('[data-update-guide]')!.disabled = guideBusy || state.applying;
    for (const root of [card, banner]) root.querySelectorAll<HTMLButtonElement>('[data-update-apply]').forEach(button => {
      button.hidden = state.phase !== 'ready'; button.disabled = state.applying || active(); button.textContent = active() ? '专注结束后更新' : state.applying ? '正在确认…' : '立即更新';
    });
  }
  card.querySelector<HTMLButtonElement>('[data-update-check]')!.onclick = () => { void controller.check(); };
  card.querySelector<HTMLButtonElement>('[data-update-retry]')!.onclick = () => controller.retryMedia();
  for (const root of [card, banner]) root.querySelectorAll<HTMLButtonElement>('[data-update-apply]').forEach(button => button.onclick = () => { void controller.apply(); });
  async function openUpdate() {
    if (guideBusy || controller.snapshot().phase !== 'ready' || guide && !guide.canShow()) return;
    guideBusy = true; update(controller.snapshot());
    try {
      guide?.openSettings();
      const heading = card.querySelector<HTMLElement>('h2')!;
      card.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      heading.focus({ preventScroll: true });
      await controller.apply();
    } finally { guideBusy = false; update(controller.snapshot()); }
  }
  banner.querySelector<HTMLButtonElement>('[data-update-guide]')!.onclick=()=>void openUpdate();
  if(guide)updateDialog=createUpdateDialog(active,guide.canShow,async()=>{await openUpdate();});
  const refreshContext = () => queueMicrotask(() => update(controller.snapshot()));
  const observer = new MutationObserver(refreshContext);
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });
  document.addEventListener('close', refreshContext, true); document.addEventListener('visibilitychange', refreshContext);
  const unsubscribe = controller.subscribe(update);
  return { mount() { document.querySelector('[data-update-card-slot]')?.append(card); document.querySelector('[data-update-banner-slot]')?.append(banner); update(controller.snapshot()); }, destroy() { disposed = true; updateDialog?.destroy(); observer.disconnect(); document.removeEventListener('close', refreshContext, true); document.removeEventListener('visibilitychange', refreshContext); unsubscribe(); card.remove(); banner.remove(); } };
}
