import { getCatDefinition } from './cat-definition';
import type { CatHouseState } from './cat-house-state';
import { furnitureZones, getProduct, productName, shopProducts, type CommerceState, type ShopProduct } from './shop';
import { icon } from './category-icons';

export type ShopViewState = { balance: number; house: CatHouseState | null; commerce: CommerceState };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const preview = (product: ShopProduct) => product.kind === 'cat'
  ? `<img src="${getCatDefinition(product.catId)!.preview}" alt="${escape(productName(product))}"/>`
  : product.previews.map(file => `<img src="${file}" alt="${escape(product.name)}"/>`).join('');

export function createCatShop(initial: ShopViewState, actions: {
  back: () => void; buy: (id: string) => Promise<void>; companion: (id: string) => Promise<void>;
}) {
  let state = initial, tab: 'cats' | 'furniture' = 'cats', selected: string | null = null, busy = false, error = '', destroyed = false;
  const element = document.createElement('section'); element.className = 'cat-shop';
  const dialog = document.createElement('dialog'); dialog.className = 'shop-detail'; dialog.setAttribute('aria-labelledby', 'shop-detail-title');
  document.body.append(dialog);
  const owned = (product: ShopProduct) => product.kind === 'cat' ? !!state.house?.ownedCatIds.includes(product.catId) : state.commerce.inventory.ownedFurnitureIds.includes(product.id);
  function render() {
    if (destroyed) return;
    element.innerHTML = `<header class="shop-header"><button type="button" id="shop-back">‹ 返回小屋</button><div class="eyebrow">给陪伴留一个位置</div><h1>猫咪商城</h1><div class="shop-balance" aria-live="polite">${icon('paw')}<span>猫爪币余额 <strong>${state.balance}</strong></span></div></header>
      <div class="shop-tabs" role="group" aria-label="商品分类"><button type="button" data-shop-tab="cats" aria-pressed="${tab === 'cats'}">猫咪</button><button type="button" data-shop-tab="furniture" aria-pressed="${tab === 'furniture'}">家具</button></div>
      ${tab === 'cats' ? `<p class="hint">初始伙伴永久拥有，额外猫咪每只 80 猫爪币。有空位自动入住，满员可先购买，再到小屋管理入住。</p><div class="shop-cats">${shopProducts.filter(product => product.kind === 'cat').map(product => `<article class="shop-card" data-shop-product="${product.id}"><button type="button" class="shop-product-open" data-shop-detail="${product.id}"><div class="shop-preview">${preview(product)}</div><h2>${escape(productName(product))}</h2><span class="shop-status">${owned(product) ? state.house?.residentCatIds.includes(product.kind === 'cat' ? product.catId : '') ? '已拥有 · 已入住' : '已拥有 · 暂未入住' : `${product.price} 猫爪币`}</span></button>${product.kind === 'cat' && owned(product) ? `<button type="button" data-shop-companion="${product.catId}" ${state.house?.companionCatId === product.catId || busy ? 'disabled' : ''}>${state.house?.companionCatId === product.catId ? '主陪伴猫' : '设为主陪伴猫'}</button>` : ''}</article>`).join('')}</div>` : `<p class="hint">四个功能区的基础物品默认拥有并已装备。本次没有付费家具。</p><div class="shop-furniture">${furnitureZones.map(zone => {
        const product = getProduct(state.commerce.inventory.equipped[zone.id])!;
        return `<article class="shop-card"><div class="eyebrow">${zone.name}</div><div class="shop-preview furniture-preview">${preview(product)}</div><h2>${escape(productName(product))}</h2><span class="shop-status">默认拥有 · 已装备</span></article>`;
      }).join('')}</div>`}<p class="shop-error" role="status">${escape(error)}</p>`;
    element.querySelector<HTMLButtonElement>('#shop-back')!.onclick = actions.back;
    element.querySelectorAll<HTMLButtonElement>('[data-shop-tab]').forEach(button => button.onclick = () => { tab = button.dataset.shopTab as typeof tab; render(); });
    element.querySelectorAll<HTMLButtonElement>('[data-shop-detail]').forEach(button => button.onclick = () => { selected = button.dataset.shopDetail!; error = ''; renderDetail(); dialog.showModal(); });
    element.querySelectorAll<HTMLButtonElement>('[data-shop-companion]').forEach(button => button.onclick = async () => {
      if (busy) return; busy = true; error = ''; render();
      try { await actions.companion(button.dataset.shopCompanion!); } catch (failure) { error = (failure as Error).message; }
      finally { busy = false; render(); }
    });
  }
  function renderDetail() {
    if (!selected || destroyed) return;
    const product = getProduct(selected)!;
    const isOwned = owned(product), missing = Math.max(0, product.price - state.balance);
    dialog.innerHTML = `<button type="button" id="shop-detail-close" class="shop-detail-close" aria-label="关闭商品详情">×</button><div class="shop-preview detail-preview">${preview(product)}</div><h2 id="shop-detail-title">${escape(productName(product))}</h2>${product.kind === 'cat' ? `<p>${escape(getCatDefinition(product.catId)!.description)}</p>` : ''}<p class="shop-price">${product.price} 猫爪币</p><p>当前余额：<strong>${state.balance}</strong> 猫爪币</p><p class="shop-purchase-note">${isOwned ? '已永久拥有，无需重复购买。' : missing ? `余额不足，还差 ${missing} 猫爪币。` : '确认后扣除猫爪币，永久解锁；有空位自动入住，满员时暂不入住。'}</p><p class="shop-error" role="alert">${escape(error)}</p><button type="button" id="shop-buy" class="primary wide" ${isOwned || missing || busy || !state.house?.companionCatId ? 'disabled' : ''}>${isOwned ? '已拥有' : busy ? '正在购买…' : `确认购买 · ${product.price} 猫爪币`}</button>`;
    dialog.querySelector<HTMLButtonElement>('#shop-detail-close')!.onclick = () => {if(!busy)dialog.close();};
    dialog.querySelector<HTMLButtonElement>('#shop-buy')!.onclick = async () => {
      if (busy || isOwned || missing) return;
      const id = selected!; busy = true; error = ''; renderDetail();
      try { await actions.buy(id); } catch (failure) { error = (failure as Error).message; }
      finally { busy = false; render(); renderDetail(); }
    };
  }
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close', () => { const id = selected; selected = null; element.querySelector<HTMLButtonElement>(`[data-shop-detail="${id}"]`)?.focus(); });
  render();
  return {
    element,
    update(next: ShopViewState) { state = next; render(); if (dialog.open) renderDetail(); },
    destroy() { destroyed = true; if (dialog.open) dialog.close(); dialog.remove(); element.remove(); },
  };
}
