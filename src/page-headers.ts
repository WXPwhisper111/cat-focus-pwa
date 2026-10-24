export const pageHeaderAssets = {
  focus:'./page-headers-v1/header_focus.webp',
  stats:'./page-headers-v1/header_stats.webp',
  room:'./page-headers-v1/header_house.webp',
  settings:'./page-headers-v1/header_settings.webp',
} as const;

// Decorative only: reuse one image per page without changing document flow.
export function createPageHeaders() {
  const layers=new Map<string,HTMLDivElement>();
  return {
    mount(main:HTMLElement,page:string) {
      const source=pageHeaderAssets[page as keyof typeof pageHeaderAssets];
      main.classList.toggle('page-header-surface',!!source);
      main.querySelectorAll(':scope > .page-header-backdrop').forEach(node=>node.remove());
      if(!source){delete main.dataset.pageHeader;return;}
      main.dataset.pageHeader=page;
      let layer=layers.get(page);
      if(!layer){
        layer=document.createElement('div');layer.className='page-header-backdrop';layer.setAttribute('aria-hidden','true');
        const art=document.createElement('div');art.className='page-header-art';
        const image=document.createElement('img');image.alt='';image.width=1536;image.height=768;image.decoding='async';image.src=source;
        const target=layer;image.addEventListener('error',()=>{target.dataset.failed='true';});art.append(image);layer.append(art);
        for(const name of ['tint','wash','fade']){const overlay=document.createElement('div');overlay.className='page-header-'+name;layer.append(overlay);}
        layers.set(page,layer);
      }
      main.prepend(layer);
    },
    destroy(){for(const layer of layers.values())layer.remove();layers.clear();},
  };
}
