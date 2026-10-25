// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {catDefinitions} from '../src/cat-definition';
import {stretchClip} from '../src/cat-stretch';
import {clipDuration,displayedRect} from '../src/cat-animation';
import {createCatPlayer} from '../src/cat-player';
import {createPetFeedback} from '../src/cat-pet-feedback';
import {installDialogDismiss} from '../src/dialog-dismiss';
import {mockDialogs} from './dialog-mocks';
import {createFocusCat} from '../src/focus-cat';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
it('maps all six real stretch clips without frame loss and keeps registration distinct from world feet',()=>{
  for(const cat of catDefinitions){const clip=stretchClip(cat.id)!;expect(clip.catId).toBe(cat.id);expect(clip.frames).toHaveLength(18);expect(clipDuration(clip)).toBe(3600);expect(clip.loop).toBe(false);
    for(const frame of clip.frames)expect(existsSync('public/'+frame.file.slice(2))).toBe(true);
    expect(readFileSync('public/'+clip.frames[0].file.slice(2))).toEqual(readFileSync('public/'+clip.frames.at(-1)!.file.slice(2)));
    const rect=displayedRect(clip,0,[512,716]);expect(rect[0]+clip.display!.anchor[0]*rect[2]/1254).toBeCloseTo(512);expect(rect[1]+clip.display!.anchor[1]*rect[3]/1254).toBeCloseTo(716);
  }
});
it('alternates at idle boundaries using the same RAF and lets real sleep preempt stretch',async()=>{
  vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.spyOn(Math,'random').mockReturnValue(0);
  const image=document.createElement('img'),frames=new Map<number,FrameRequestCallback>();let now=0,next=0;
  const player=createCatPlayer(image,'idle',{definition:catDefinitions[0],idleMotion:true},{loadImage:async()=>{},now:()=>now,requestFrame:fn=>{frames.set(++next,fn);return next;},cancelFrame:id=>{frames.delete(id);}});
  const advance=async(time:number)=>{now=time;for(const [id,fn]of [...frames]){frames.delete(id);fn(now);}await flush();};
  try{await flush();await advance(9260);expect(image.dataset.animation).toBe('idle');await advance(18520);expect(image.dataset.animation).toBe('stretch:once');expect(frames.size).toBe(1);
    await advance(22120);expect(image.dataset.animation).toBe('idle');await advance(40640);expect(image.dataset.animation).toBe('stretch:once');await player.updateState('sleep_loop');expect(image.dataset.animation).toBe('sleep_loop');expect(frames.size).toBe(1);
  }finally{player.destroy();expect(frames.size).toBe(0);}
});
it('shows the moon only during real sleep and renders a named toilet symbol with no click capture',()=>{
  vi.spyOn(document,'hidden','get').mockReturnValue(false);const host=document.createElement('div');document.body.append(host);const view=createPetFeedback(host);
  try{view.event('cat-04','sleep_loop','start');expect(host.querySelector('[data-feedback=sleep] .cat-sleep-moon')).not.toBeNull();expect(host.textContent).not.toContain('Zzz');view.event('cat-04','sleep_loop','stop');expect(host.children).toHaveLength(0);
    view.toilet('cat-04','吉吉',[1008,754]);expect(host.querySelector('[data-toilet-cat]')?.getAttribute('aria-label')).toBe('吉吉正在上厕所');view.refreshName('cat-04','新名字');expect(host.querySelector('[data-toilet-cat]')?.getAttribute('aria-label')).toBe('新名字正在上厕所');document.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pagehide'));expect(host.children).toHaveLength(0);
  }finally{view.destroy();}
});
it('dismisses the backdrop through cancel guards, excludes updates and rejects inside-to-outside drags',()=>{
  mockDialogs();const remove=installDialogDismiss();const dialog=document.createElement('dialog');dialog.innerHTML='<button>内容</button>';document.body.append(dialog);dialog.showModal();
  vi.spyOn(dialog,'getBoundingClientRect').mockReturnValue({left:50,right:250,top:50,bottom:250} as DOMRect);
  const down=(x:number,y:number,target:Element=dialog)=>target.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:x,clientY:y}));const click=(x:number,y:number)=>dialog.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));
  try{down(100,100,dialog.querySelector('button')!);click(10,10);expect(dialog.open).toBe(true);dialog.dataset.dismissOutside='false';down(10,10);click(10,10);expect(dialog.open).toBe(true);delete dialog.dataset.dismissOutside;
    const guard=(e:Event)=>e.preventDefault();dialog.addEventListener('cancel',guard);down(10,10);click(10,10);expect(dialog.open).toBe(true);dialog.removeEventListener('cancel',guard);down(10,10);click(10,10);expect(dialog.open).toBe(false);
  }finally{remove();}
});
it('pets the focus companion once, keeps repeated baseline updates stable and restores paused sleep',async()=>{
  let now=0,next=0;const frames=new Map<number,FrameRequestCallback>();vi.spyOn(document,'hidden','get').mockReturnValue(false);
  vi.spyOn(performance,'now').mockImplementation(()=>now);vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++next,fn);return next;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('Image',class{onload:(()=>void)|null=null;set src(_v:string){queueMicrotask(()=>this.onload?.());}decode(){return Promise.resolve();}});
  const focus=createFocusCat('idle',catDefinitions[3]);document.body.append(focus.element);
  try{await flush();const button=focus.element.querySelector('button')!;button.click();button.click();await flush();expect(focus.element.querySelector('img')!.dataset.animation).toBe('pet:once');await focus.updateState('idle');expect(focus.element.querySelector('img')!.dataset.animation).toBe('pet:once');
    now=2400;for(const [id,fn]of [...frames]){frames.delete(id);fn(now);}await flush();expect(focus.element.querySelector('img')!.dataset.animation).toBe('idle');await focus.updateState('sleep_loop');button.click();await flush();now+=2400;for(const [id,fn]of [...frames]){frames.delete(id);fn(now);}await flush();expect(focus.element.querySelector('img')!.dataset.animation).toBe('sleep_loop');
    window.dispatchEvent(new Event('pagehide'));await flush();expect(focus.element.querySelector('.cat-pet-bubble')).toBeNull();window.dispatchEvent(new Event('pageshow'));await flush();expect(focus.element.querySelector('[data-feedback=sleep]')).not.toBeNull();
  }finally{focus.destroy();expect(frames.size).toBe(0);}
});
