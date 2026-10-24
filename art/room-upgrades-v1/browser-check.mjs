import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base='http://127.0.0.1:4238',results=[];
const screenshot=(page,name)=>page.screenshot({path:new URL('./'+name+'.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
try{
 for(const viewport of [{width:320,height:690},{width:360,height:740},{width:390,height:844},{width:430,height:860},{width:844,height:390}]){
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#welcome-start').click();
  await page.locator('#manage-categories').click();assert.equal(await page.locator('#category-name').evaluate(el=>document.activeElement===el),false);
  const position=await page.locator('#manage-categories').boundingBox(),picker=await page.locator('.category-picker').boundingBox();assert(position.x>=picker.x+picker.width);assert(position.height>=44);
  await page.locator('#category-name').fill('阅读测试');await page.locator('.category-add button').click();await page.locator('.category-dialog').waitFor({state:'hidden'});
  await page.locator('#manage-categories').click();await page.getByRole('button',{name:'删除阅读测试',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('button',{name:'删除阅读测试',exact:true}).waitFor({state:'detached'});
  await page.locator('#category-name').fill('阅读测试');await page.locator('.category-add button').click();await page.locator('.category-dialog').waitFor({state:'hidden'});
  await page.locator('.focus-list-open').click();assert.equal(await page.locator('#new-focus-task').evaluate(el=>document.activeElement===el),false);
  await page.locator('#new-focus-task').fill('一个需要认真完成的长标题任务，测试手机排版与安全输入');await page.locator('.focus-task-add button').click();await page.locator('.focus-task-row').waitFor();
  await page.locator('.focus-task-actions button').filter({hasText:'编辑'}).click();assert.equal(await page.locator('.focus-task-editor input').evaluate(el=>document.activeElement===el),false);
  await page.locator('.focus-task-editor input').fill('任务编辑后立即保存');await page.locator('.focus-task-editor button').filter({hasText:'保存'}).click();await page.locator('.focus-task-editor').waitFor({state:'detached'});await page.locator('[data-list-close]').click();
  await page.getByRole('navigation').getByRole('button',{name:'猫咪小屋',exact:true}).click();await page.locator('#confirm-adoption').click();await page.locator('.room-scene').waitFor();
  assert.match(await page.locator('.house-actions [data-page=shop]').innerText(),/家具上新/);
  await page.locator('[data-rename-cat=orange-white]').click();assert.equal(await page.locator('#cat-new-name').evaluate(el=>document.activeElement===el),false);await page.locator('#cat-new-name').fill('测试喵');await page.locator('.cat-rename button[type=submit]').click();await page.locator('.cat-rename').waitFor({state:'detached'});
  await page.getByRole('navigation').getByRole('button',{name:'专注',exact:true}).click();await page.locator('[data-mode=stopwatch]').click();await page.locator('#start').click();await page.locator('#pause').waitFor();
  // Isolated test clock only: earn test currency through the actual settlement UI.
  await page.evaluate(()=>{window.testOriginalNow=Date.now;Date.now=()=>window.testOriginalNow()+40*300000;});
  await page.locator('#early').click();await page.locator('#summary-done').click();await page.evaluate(()=>{Date.now=window.testOriginalNow;delete window.testOriginalNow;});
  await page.getByRole('navigation').getByRole('button',{name:'猫咪小屋',exact:true}).click();await page.locator('.house-actions [data-page=shop]').click();
  assert.equal(await page.locator('[data-shop-tab=furniture] .shop-new').count(),1);await page.locator('[data-shop-tab=furniture]').click();assert.equal(await page.locator('.shop-new').count(),0);assert.equal(await page.locator('.shop-furniture .shop-card').count(),2);
  const pairs=[['sleep','advanced-bed'],['food','advanced-tableware'],['activity','advanced-rug'],['play','advanced-scratcher']];
  for(const [zone,id] of pairs){await page.locator(`[data-shop-zone=${zone}]`).click();await page.locator(`[data-shop-detail=${id}]`).click();await page.locator('#shop-buy').click();await page.waitForFunction(()=>document.querySelector('#shop-buy')?.textContent==='已拥有');await page.locator('#shop-detail-close').click();assert.equal(await page.locator(`[data-shop-equip=${id}]`).isDisabled(),true);}
  const balance=await page.locator('.shop-balance').innerText();assert.match(balance,/5\s*$/);
  await page.locator('[data-shop-zone=sleep]').click();await screenshot(page,'shop-'+viewport.width);
  await page.locator('[data-shop-equip=basic-bed]').click();await page.waitForFunction(()=>document.querySelector('[data-shop-equip=basic-bed]')?.disabled===true);await page.locator('[data-shop-equip=advanced-bed]').click();await page.waitForFunction(()=>document.querySelector('[data-shop-equip=advanced-bed]')?.disabled===true);
  await page.locator('#shop-back').click();await page.locator('[data-room-object=bed]').evaluate(im=>im.decode());assert.match(await page.locator('[data-room-object=bed]').getAttribute('src'),/advanced/);assert.match(await page.locator('[data-room-object=plant]').getAttribute('src'),/plant.webp/);
  const curtain=page.locator('[data-room-object=curtains]');await page.waitForFunction(()=>document.querySelector('[data-room-object=curtains]')?.src.includes('/curtains/'));const first=await curtain.getAttribute('src');await page.waitForTimeout(300);assert.notEqual(await curtain.getAttribute('src'),first);
  await screenshot(page,'room-'+viewport.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('[data-room-cat-target]').first().evaluate(el=>getComputedStyle(el).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('[data-room-object=curtains]')?.src.endsWith('curtains-static.webp'));await page.emulateMedia({reducedMotion:'no-preference'});
  await page.reload();await page.getByRole('navigation').getByRole('button',{name:'猫咪小屋',exact:true}).click();assert.equal(await page.locator('.house-actions .shop-new').count(),0);assert.match(await page.locator('[data-room-object=bed]').getAttribute('src'),/advanced/);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle!=='none'),true);
  assert.deepEqual(errors,[]);results.push({viewport,passed:true,checks:['manual input focus','category delete/re-add','task edit','rename','real test settlement','four furniture purchases','equip switch','new badges persist','curtain motion/reduced motion','no horizontal overflow','transparent touch highlight','keyboard focus remains visible','reload persistence']});await context.close();
 }
}finally{await writeFile(new URL('./browser-results.json',import.meta.url),JSON.stringify({engine:'Isolated headless Edge',realPhone:false,results},null,2));await browser.close();}
console.log(JSON.stringify(results));
