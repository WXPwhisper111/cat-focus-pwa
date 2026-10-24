// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {createPageHeaders,pageHeaderAssets} from '../src/page-headers';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import audit from '../art/page-headers-v1/asset-audit.json';
afterEach(()=>document.body.replaceChildren());
it('maps exactly four real lossless runtime images to page-specific decorative layers',()=>{
  const headers=createPageHeaders();
  for(const page of ['focus','stats','room','settings'] as const){
    const main=document.createElement('main');main.innerHTML='<h1>页面标题</h1><button>操作</button>';document.body.append(main);headers.mount(main,page);
    expect(main.dataset.pageHeader).toBe(page);const layer=main.querySelector('.page-header-backdrop')!;expect(layer.getAttribute('aria-hidden')).toBe('true');expect(layer.querySelector('img')!.getAttribute('src')).toBe(pageHeaderAssets[page]);expect(main.querySelectorAll('h1')).toHaveLength(1);expect(layer.querySelectorAll('button')).toHaveLength(0);
  }
  for(const asset of audit.assets){const bytes=readFileSync('public/'+asset.runtime.slice(2));expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);expect(bytes.toString('ascii',0,4)).toBe('RIFF');}
  headers.destroy();
});
it('reuses loaded images through rerenders and keeps failed decoration out of business flows',()=>{
  const headers=createPageHeaders();const first=document.createElement('main');headers.mount(first,'focus');const image=first.querySelector('img')!;
  const second=document.createElement('main');const button=document.createElement('button');second.append(button);headers.mount(second,'focus');expect(second.querySelector('img')).toBe(image);expect(first.querySelector('img')).toBeNull();
  image.dispatchEvent(new Event('error'));expect(second.querySelector<HTMLElement>('.page-header-backdrop')!.dataset.failed).toBe('true');expect(second.querySelector('button')).toBe(button);
  headers.mount(second,'stats');expect(second.querySelectorAll('.page-header-backdrop')).toHaveLength(1);headers.mount(second,'shop');expect(second.querySelector('.page-header-backdrop')).toBeNull();expect(second.querySelector('button')).toBe(button);
  const shop=document.createElement('main');headers.mount(shop,'shop');expect(shop.classList.contains('page-header-surface')).toBe(false);expect(shop.children).toHaveLength(0);headers.destroy();expect(second.querySelector('img')).toBeNull();
});
