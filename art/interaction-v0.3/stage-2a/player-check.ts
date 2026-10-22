import { createCatPlayer } from '../../../src/cat-player';
import { catDefinitions } from '../../../src/cat-definition';
import { interactionClips } from '../../../src/cat-interactions';
import { pointOnCanvas } from '../../../src/cat-animation';

const host = document.querySelector('#cats')!, error = document.querySelector('#error')!;
const names = { eat: '吃饭循环', drink: '喝水循环', scratch: '抓挠循环', pet: '抚摸单次' };
const players = catDefinitions.map(cat => {
  const section = document.createElement('section'); section.dataset.cat = cat.id;
  section.innerHTML = `<h2>${cat.name}</h2><figure><img alt="${cat.name}" src="${cat.preview}"><i class="point feet"></i><i class="point contact" hidden></i></figure><p class="state" role="status">待机</p><small class="frame-info"></small><div class="clips"></div><button data-stop>停止</button><button data-idle>恢复待机</button>`;
  host.append(section);
  const status = section.querySelector('.state')!, info = section.querySelector('.frame-info')!;
  const feet = section.querySelector<HTMLElement>('.feet')!, contact = section.querySelector<HTMLElement>('.contact')!;
  let completions = 0;
  const player = createCatPlayer(section.querySelector('img')!, 'idle', { definition: cat,
    onError: reason => { error.textContent = reason?.message || '加载失败'; },
    onClipFrame: (clip, frame) => {
      info.textContent = `${clip.id} · 第${frame + 1}/${clip.frames.length}帧 · ${clip.frames[frame].durationMs}ms`;
      const pin = (element: HTMLElement, point: readonly number[]) => { const [x, y] = pointOnCanvas(clip, point, [100, 100]); element.style.left = `${x}%`; element.style.top = `${y}%`; };
      pin(feet, clip.feetAnchor); contact.hidden = !clip.contact || frame !== clip.contact.contactFrame;
      if (clip.contact) pin(contact, clip.contact.spritePoint);
    },
  });
  for (const clip of interactionClips.filter(clip => clip.catId === cat.id)) {
    const button = document.createElement('button'); button.textContent = names[clip.behavior]; button.dataset.clip = clip.behavior;
    button.onclick = async () => {
      completions = 0; status.textContent = '加载中';
      const result = await player.play(clip, { onComplete: () => { status.textContent = `已完成 · 回调${++completions}次`; } });
      if (result.status === 'started') status.textContent = `正在播放：${names[clip.behavior]}`;
      else if (result.status === 'failed') status.textContent = '加载失败，保留原画面';
    };
    section.querySelector('.clips')!.append(button);
  }
  section.querySelector<HTMLButtonElement>('[data-stop]')!.onclick = () => { player.stop(); status.textContent = '已停止'; };
  section.querySelector<HTMLButtonElement>('[data-idle]')!.onclick = async () => { await player.updateState('idle'); status.textContent = '待机'; };
  return player;
});
document.querySelector<HTMLButtonElement>('#preload')!.onclick = async () => {
  const audit = document.querySelector('#audit')!; audit.textContent = '解码中';
  try {
    await Promise.all(interactionClips.map(clip => players[catDefinitions.findIndex(cat => cat.id === clip.catId)].preload(clip)));
    audit.textContent = `成功：${interactionClips.length}段／${interactionClips.reduce((sum, clip) => sum + clip.frames.length, 0)}帧均已加载并解码`;
  } catch (reason) { audit.textContent = `失败：${String(reason)}`; }
};
window.addEventListener('pagehide', event => { if (!event.persisted) players.forEach(player => player.destroy()); });
