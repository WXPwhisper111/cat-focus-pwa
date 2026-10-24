// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {defaultCommerce,shopProducts,validateCommerce,type ShopProduct} from '../src/shop';
import {equipmentKey,equippedAnchors,furnitureAvailable,roomLayerAsset,roomUpgradeAssets} from '../src/room-furnishings';
import {anchorFeet} from '../src/room-anchors';
import {baseClip} from '../src/room-behavior-config';
import {catDefinitions} from '../src/cat-definition';
import {createCurtains} from '../src/room-curtains';
import {createShopNews} from '../src/shop-news';
import {openCatRename} from '../src/cat-rename';
import {mockDialogs} from './dialog-mocks';
import {icon} from '../src/category-icons';
import layout from '../art/room-v0.1/scene-calibration/layout.json';
import audit from '../art/room-upgrades-v1/asset-audit.json';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
it('ships exact approved runtime hashes, real 48 frame timings, alpha WebP and retained source masters',()=>{
  expect(roomUpgradeAssets.curtains.frames).toHaveLength(48);expect(roomUpgradeAssets.curtains.frames.reduce((n,f)=>n+f.durationMs,0)).toBe(6000);
  expect(roomUpgradeAssets.curtains.canvas).toEqual([576,416]);
  for(const item of audit.assets){const bytes=readFileSync('public/'+item.runtime.slice(2));expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(readFileSync(item.source).length).toBeGreaterThan(0);}
  expect(audit.runtimeBytes).toBeLessThan(5_000_000);
});
it('keeps six cat contact positions and basic sleep unchanged while raising only advanced sleep by 12',()=>{
  const inventory=defaultCommerce().inventory;
  const advanced=shopProducts.filter(p=>p.kind==='furniture'&&!p.defaultOwned);
  expect(advanced).toHaveLength(4);expect(advanced.map(p=>p.price)).toEqual([10,10,10,10]);
  const before=equipmentKey(inventory);inventory.ownedFurnitureIds.push(...advanced.map(p=>p.id));
  for(const p of advanced)if(p.kind==='furniture')inventory.equipped[p.zone]=p.id;
  expect(equipmentKey(inventory)).not.toBe(before);
  for(const id of ['bed','foodBowl','waterBowl','scratcher','rug'] as const)expect(furnitureAvailable(inventory,id)).toBe(true);
  for(const cat of catDefinitions){const clip=baseClip(cat.id,'sleep_loop')!;expect(anchorFeet(equippedAnchors().find(a=>a.itemId==='bed')!,clip)).toEqual([134,661]);expect(anchorFeet(equippedAnchors(inventory).find(a=>a.itemId==='bed')!,clip)).toEqual([134,649]);}
  for(const layer of layout.layers.filter(l=>['bed','rug','scratcher','foodBowl','waterBowl'].includes(l.id)))expect(roomLayerAsset(layer,inventory).rect).toEqual(layer.rect);
  expect(roomLayerAsset(layout.layers.find(l=>l.id==='plant')!).rect).toEqual(roomUpgradeAssets.plant.rect);
  const invalid=defaultCommerce();invalid.inventory.ownedFurnitureIds.push('advanced-bed');expect(()=>validateCommerce(invalid)).toThrow();
});
it('tracks furniture and future cat discoveries separately and tolerates unavailable preference storage',()=>{
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const news=createShopNews(storage);expect(news.has('cat')).toBe(false);expect(news.has('furniture')).toBe(true);news.viewed('cat');expect(news.has('furniture')).toBe(true);news.viewed('furniture');expect(news.has('furniture')).toBe(false);news.destroy();
  const restored=createShopNews(storage);expect(restored.has('furniture')).toBe(false);restored.destroy();
  const catalogue=shopProducts as ShopProduct[];catalogue.push({id:'cat-future',kind:'cat',catId:'future',price:80});
  try{const future=createShopNews(storage);expect(future.has('cat')).toBe(true);expect(future.has('furniture')).toBe(false);future.viewed('cat');expect(future.has('cat')).toBe(false);future.destroy();}finally{catalogue.pop();}
  const broken=createShopNews({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});expect(()=>broken.viewed('furniture')).not.toThrow();expect(broken.has('furniture')).toBe(false);broken.destroy();
});
it('plays curtains with one cancellable clock, pauses in background, respects reduced motion and falls back on load error',async()=>{
  let hidden=false,next=0,reduce=false;const frames=new Map<number,FrameRequestCallback>(),changes=new Set<()=>void>();
  vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++next,cb);return next;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('matchMedia',()=>({get matches(){return reduce;},addEventListener:(_name:string,fn:()=>void)=>changes.add(fn),removeEventListener:(_name:string,fn:()=>void)=>changes.delete(fn)}));
  const image=document.createElement('img');const load=vi.fn(async(_url:string)=>{});const player=createCurtains(image,load);await flush();expect(frames.size).toBe(1);expect(load.mock.calls.length).toBeLessThanOrEqual(2);
  const tick=(time:number)=>{const [id,cb]=[...frames][0];frames.delete(id);cb(time);};tick(1);tick(126);await flush();expect(image.getAttribute('src')).toBe(roomUpgradeAssets.curtains.frames[1].file);expect(frames.size).toBe(1);
  hidden=true;document.dispatchEvent(new Event('visibilitychange'));expect(frames.size).toBe(0);hidden=false;document.dispatchEvent(new Event('visibilitychange'));await flush();expect(frames.size).toBe(1);
  reduce=true;changes.forEach(fn=>fn());expect(frames.size).toBe(0);expect(image.getAttribute('src')).toBe(roomUpgradeAssets.curtains.fallback);player.destroy();expect(changes.size).toBe(0);
  reduce=false;const failing=createCurtains(image,async()=>{throw Error('offline');});await flush();expect(image.getAttribute('src')).toBe(roomUpgradeAssets.curtains.fallback);expect(frames.size).toBe(0);failing.destroy();
});
it('opens rename without focusing text, restores its trigger and provides a currency-specific vector',()=>{
  mockDialogs();const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const dialog=openCatRename(catDefinitions[0],async()=>{});expect(document.activeElement).toBe(dialog.querySelector('[data-cancel]'));const input=dialog.querySelector('input')!;input.focus();expect(document.activeElement).toBe(input);dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.click();expect(document.activeElement).toBe(trigger);expect(icon('paw-coin')).toContain('<circle');expect(icon('paw')).not.toBe(icon('paw-coin'));
});
