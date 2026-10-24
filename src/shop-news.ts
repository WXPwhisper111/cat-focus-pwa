import { shopProducts } from './shop';
const key='cat-focus-shop-seen-v1';
const baseline=['cat-orange-white','cat-cat-02','cat-cat-03','cat-cat-04','cat-cat-05','cat-cat-06','basic-bed','basic-tableware','basic-rug','basic-scratcher'];
export function createShopNews(storage?: Pick<Storage,'getItem'|'setItem'>) {
  try{storage??=globalThis.localStorage;}catch{}
  let seen=new Set(baseline);
  try{const raw=storage?.getItem(key);if(raw){const ids=JSON.parse(raw);if(Array.isArray(ids)&&ids.every(id=>typeof id==='string'))seen=new Set([...baseline,...ids]);}}catch{/* Optional local preference only. */}
  const listeners=new Set<()=>void>();
  const merge=()=>{try{const ids=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(ids))for(const id of ids)if(typeof id==='string')seen.add(id);}catch{}};
  const changed=(event:StorageEvent)=>{if(event.key===key){merge();listeners.forEach(fn=>fn());}};
  globalThis.addEventListener?.('storage',changed);
  return {
    has:(kind:'cat'|'furniture')=>shopProducts.some(p=>p.kind===kind&&!seen.has(p.id)),
    viewed(kind:'cat'|'furniture'){merge();for(const p of shopProducts)if(p.kind===kind)seen.add(p.id);try{storage?.setItem(key,JSON.stringify([...seen]));}catch{}listeners.forEach(fn=>fn());},
    subscribe(fn:()=>void){listeners.add(fn);return()=>listeners.delete(fn);},
    destroy(){globalThis.removeEventListener?.('storage',changed);listeners.clear();},
  };
}
