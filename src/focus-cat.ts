import { catDisplayName } from './cat-names';
import { createCatPlayer } from './cat-player';
import { orangeWhiteCat, catSequence, type CatDefinition, type CatAnimation } from './cat-definition';

// Restore the original focus card while sharing the same image loader/player.
export function createFocusCat(state: CatAnimation, definition: CatDefinition = orangeWhiteCat) {
  const element = document.createElement('div');
  element.className = 'focus-cat-view';
  element.dataset.catId = definition.id;
  const image = document.createElement('img');
  image.id = 'cat'; image.draggable = false;
  image.src = catSequence(definition, state).frames[0].file;
  image.alt = `${catDisplayName(definition)}${state === 'sleep_loop' ? '正在睡觉' : '正在陪伴'}`;
  const floor = document.createElement('div'); floor.className = 'cat-floor';
  const error = document.createElement('small');
  error.className = 'focus-cat-error'; error.hidden = true;
  error.textContent = '猫咪画面加载失败，计时仍可使用。';
  element.append(image, floor, error);
  const player = createCatPlayer(image, state, { definition, onError: () => { error.hidden = false; } });
  return { element, catId: definition.id, updateState: player.updateState, refreshName: player.refreshName, destroy() { player.destroy(); element.remove(); } };
}
