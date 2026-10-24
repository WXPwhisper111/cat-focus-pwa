import { roomUpgradeAssets } from './room-furnishings';
import { loadCatImage } from './cat-player';
// Environment decoration owns one clock and only preloads the next frame, not all decoded frames.
export function createCurtains(image:HTMLImageElement,load=loadCatImage) {
  const clip=roomUpgradeAssets.curtains, motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed=false,active=true,failed=false,raf:number|undefined,last=0,elapsed=0,index=0,revision=0;
  const stop=()=>{if(raf!==undefined)window.cancelAnimationFrame(raf);raf=undefined;last=0;++revision;};
  const fallback=()=>{if(disposed)return;failed=true;stop();image.src=clip.fallback;};
  const schedule=()=>{if(!disposed&&active&&!document.hidden&&!motion?.matches&&!failed&&raf===undefined&&window.requestAnimationFrame)raf=window.requestAnimationFrame(tick);};
  const show=async(frame:number)=>{const token=++revision;try{await load(clip.frames[frame].file);if(disposed||token!==revision||!active||document.hidden||motion?.matches)return;image.src=clip.frames[frame].file;void load(clip.frames[(frame+1)%clip.frames.length].file).catch(fallback);}catch{if(!disposed&&token===revision)fallback();}};
  function tick(now:number){raf=undefined;if(disposed||!active||document.hidden||motion?.matches)return;if(last)elapsed+=Math.max(0,now-last);last=now;let next=index;while(elapsed>=clip.frames[next].durationMs){elapsed-=clip.frames[next].durationMs;next=(next+1)%clip.frames.length;}if(next!==index){index=next;void show(index);}schedule();}
  const sync=()=>{stop();if(disposed)return;if(motion?.matches||failed){image.src=clip.fallback;return;}if(active&&!document.hidden){elapsed=0;void show(index);schedule();}};
  const hide=()=>{active=false;stop();};const resume=()=>{active=true;sync();};
  document.addEventListener('visibilitychange',sync);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',resume);motion?.addEventListener?.('change',sync);sync();
  return {destroy(){disposed=true;stop();document.removeEventListener('visibilitychange',sync);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',resume);motion?.removeEventListener?.('change',sync);}};
}
