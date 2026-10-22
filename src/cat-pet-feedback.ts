import type { RoomRect } from './room-scene';

// Presentation only: actual player lifecycle events drive this feedback.
export function createPetFeedback(scene: HTMLElement) {
  const entries = new Map<string, { node: HTMLElement; completed: boolean; timer?: ReturnType<typeof setTimeout> }>();
  const clear = (id: string) => { const entry = entries.get(id); if (!entry) return; clearTimeout(entry.timer); entry.node.remove(); entries.delete(id); };
  const clearAll = () => { for (const id of entries.keys()) clear(id); };
  const visibility = () => { if (document.hidden) clearAll(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', clearAll);
  return {
    event(id: string, clip: string, event: 'start' | 'complete' | 'stop' | 'switch' | 'hidden') {
      if (event === 'hidden') { clear(id); return; }
      const previous = entries.get(id);
      if (clip === 'pet:once' && event === 'start') {
        clear(id);
        if (document.hidden) return;
        const node = document.createElement('div'); node.className = 'cat-pet-bubble'; node.dataset.petCat = id;
        node.setAttribute('role', 'status'); node.setAttribute('aria-label', '很享受你的抚摸');
        node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z"/></svg>';
        scene.append(node); entries.set(id, { node, completed: false });
      } else if (clip === 'pet:once' && event === 'complete' && previous) {
        previous.completed = true;
        previous.timer = setTimeout(() => {
          previous.node.classList.add('is-leaving');
          previous.timer = setTimeout(() => clear(id), 160);
        }, 400);
      } else if (previous && !previous.completed) clear(id);
    },
    position(id: string, [x, y, width, height]: RoomRect) {
      const entry = entries.get(id); if (!entry) return;
      // Head is inside the transparent canvas. Offset sideways from the name tag.
      const label = scene.querySelector<HTMLElement>(`[data-room-cat-target="${id}"] span`);
      const offset = (label?.offsetWidth || 32) / 2 + 24;
      const center = (x + width * .5) / 1024 * 100;
      const flip = scene.clientWidth ? scene.clientWidth * center / 100 + offset + 22 > scene.clientWidth : center > 90;
      entry.node.style.left = `clamp(22px, calc(${center}% ${flip ? '-' : '+'} ${offset}px), calc(100% - 22px))`;
      entry.node.style.top = `clamp(36px, ${(y + height * .18) / 768 * 100}%, calc(100% - 22px))`;
      entry.node.classList.toggle('is-left', flip);
    },
    destroy() { clearAll(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', clearAll); },
  };
}
