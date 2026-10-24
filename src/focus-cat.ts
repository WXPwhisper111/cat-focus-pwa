import { catDisplayName } from './cat-names';
import { createCatPlayer } from './cat-player';
import { createPetFeedback } from './cat-pet-feedback';
import { getInteractionClip } from './cat-interactions';
import { orangeWhiteCat, catSequence, type CatDefinition, type CatAnimation } from './cat-definition';

export function createFocusCat(state: CatAnimation, definition: CatDefinition = orangeWhiteCat) {
  const element=document.createElement('div');element.className='focus-cat-view';element.dataset.catId=definition.id;
  const image=document.createElement('img');image.id='cat';image.draggable=false;image.src=catSequence(definition,state).frames[0].file;
  const floor=document.createElement('div');floor.className='cat-floor';
  const error=document.createElement('small');error.className='focus-cat-error';error.hidden=true;error.textContent='猫咪画面加载失败，计时仍可使用。';
  const touch=document.createElement('button');touch.type='button';touch.className='focus-cat-touch';
  const feedback=createPetFeedback(element);let baseline=state,busy=false,destroyed=false,pageActive=true,revision=0;
  const refreshName=()=>{touch.setAttribute('aria-label',`抚摸${catDisplayName(definition)}`);player.refreshName();};
  element.append(image,floor,error,touch);
  const player=createCatPlayer(image,state,{definition,idleMotion:true,onError:()=>{error.hidden=false;},
    onPlayback:(clip,event)=>{if(!pageActive||document.hidden){feedback.clear(definition.id);return;}feedback.event(definition.id,clip.id,event);feedback.focusPosition(definition.id);},
    onClipFrame:clip=>{const d=clip.display;image.style.transformOrigin='0 0';image.style.transform=d?`translate(${(627-d.scale*d.anchor[0])/1254*100}%, ${(1200-d.scale*d.anchor[1])/1254*100}%) scale(${d.scale})`:'';},
  });
  refreshName();
  const restore=()=>{busy=false;touch.removeAttribute('aria-busy');void player.updateState(baseline);};
  touch.onclick=async()=>{
    if(busy||destroyed||document.hidden)return;const clip=getInteractionClip(definition.id,'pet');if(!clip)return;
    busy=true;touch.setAttribute('aria-busy','true');const token=++revision;
    const result=await player.play(clip,{onComplete:()=>{if(!destroyed&&token===revision)restore();}});
    if(result.status!=='started'&&!destroyed&&token===revision)restore();
  };
  const hidden=(event:Event)=>{if(document.hidden||event.type==='pagehide'){if(event.type==='pagehide')pageActive=false;++revision;player.stop();feedback.clear(definition.id);restore();}};
  const shown=()=>{pageActive=true;void player.updateState(baseline).then(()=>{if(!destroyed&&pageActive&&!document.hidden&&baseline==='sleep_loop'){feedback.event(definition.id,'sleep_loop','start');feedback.focusPosition(definition.id);}});};
  window.addEventListener('pageshow',shown);
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',hidden);
  return {element,catId:definition.id,refreshName,
    async updateState(next:CatAnimation){if(destroyed||next===baseline)return;baseline=next;++revision;busy=false;touch.removeAttribute('aria-busy');player.stop();await player.updateState(next);},
    destroy(){destroyed=true;++revision;feedback.destroy();player.destroy();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hidden);window.removeEventListener('pageshow',shown);element.remove();},
  };
}
