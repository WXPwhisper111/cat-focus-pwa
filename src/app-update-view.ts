import type { AppUpdate, UpdateState } from './app-update';
export function createAppUpdateView(controller: AppUpdate, active: () => boolean) {
  const card = document.createElement('section'); card.className = 'panel app-update-card'; card.setAttribute('aria-label', '应用更新');
  card.innerHTML = '<h2>应用更新</h2><p data-update-version></p><p data-update-state role="status"></p><div class="actions"><button type="button" data-update-check>检查更新</button><button type="button" class="primary" data-update-apply hidden>立即更新</button></div><div class="update-media"><strong>离线素材</strong><p data-update-media></p><button type="button" data-update-retry>重试素材下载</button></div><p class="hint">动画和房间素材会分批下载。准备完成后可完整离线使用；更新不会清除本地记录。</p>';
  const banner = document.createElement('aside'); banner.className = 'app-update-banner'; banner.hidden = true;
  banner.innerHTML = '<div><strong>新版本已就绪</strong><p>刷新后使用；有专注会话时请先结束。</p></div><button type="button" data-update-apply>立即更新</button>';
  const labels = { idle: '准备检查更新', checking: '正在检查更新…', current: '当前页面已是已检测到的最新版本。', ready: '新版本已就绪，刷新后使用。', offline: '当前离线，联网后可以检查更新。', error: '检查更新未完成，可以重试。', unsupported: '当前环境不支持离线更新，请在可信 HTTPS 网站中使用。' };
  function update(state: UpdateState) {
    card.querySelector('[data-update-version]')!.textContent = `当前版本：${state.current}${state.phase === 'ready' ? ` · 新版本：${state.latest}` : ''}`;
    card.querySelector('[data-update-state]')!.textContent = `${labels[state.phase]}${state.message ? ' ' + state.message : ''}`;
    const check = card.querySelector<HTMLButtonElement>('[data-update-check]')!; check.disabled = state.phase === 'unsupported' || state.phase === 'checking';
    const mediaLabels = { pending: '尚未读取素材状态。', downloading: '正在下载', complete: '已准备完成，可以完整离线使用。', paused: '下载已暂停，回到前台并联网后继续。', error: '部分素材未下载完成，已完成部分会保留，可重试。' };
    card.querySelector('[data-update-media]')!.textContent = `${state.total ? `${state.cached} / ${state.total} 个文件 · ` : ''}${mediaLabels[state.mediaPhase]}`;
    card.querySelector<HTMLButtonElement>('[data-update-retry]')!.disabled = state.phase === 'unsupported' || state.mediaPhase === 'downloading' || state.mediaPhase === 'complete';
    banner.hidden = state.phase !== 'ready';
    banner.querySelector('p')!.textContent = state.message || '刷新后使用；有专注会话时请先结束。';
    for (const root of [card, banner]) root.querySelectorAll<HTMLButtonElement>('[data-update-apply]').forEach(button => {
      button.hidden = state.phase !== 'ready'; button.disabled = state.applying || active(); button.textContent = active() ? '专注结束后更新' : state.applying ? '正在确认…' : '立即更新';
    });
  }
  card.querySelector<HTMLButtonElement>('[data-update-check]')!.onclick = () => { void controller.check(); };
  card.querySelector<HTMLButtonElement>('[data-update-retry]')!.onclick = () => controller.retryMedia();
  for (const root of [card, banner]) root.querySelectorAll<HTMLButtonElement>('[data-update-apply]').forEach(button => button.onclick = () => { void controller.apply(); });
  const unsubscribe = controller.subscribe(update);
  return { mount() { document.querySelector('[data-update-card-slot]')?.append(card); document.querySelector('[data-update-banner-slot]')?.append(banner); update(controller.snapshot()); }, destroy() { unsubscribe(); card.remove(); banner.remove(); } };
}
