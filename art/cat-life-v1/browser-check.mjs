// Isolated browser QA. No existing browser profile or user IndexedDB is accessed.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.CAT_FOCUS_QA_URL||'http://127.0.0.1:4236';const output=new URL('./',import.meta.url);const results=[];
try {
 for(const width of [320,390,430]) {
  const context=await browser.newContext({viewport:{width,height:width===320?690:840}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/art/cat-life-v1/ui-check.html');await page.locator('[data-room-cat="cat-04"]').waitFor();
  await page.getByRole('button',{name:'模拟发现新版本',exact:true}).click();const update=page.locator('dialog[open]');await update.waitFor();assert.match(await update.innerText(),/陪伴有了更多小动作/);
  await page.mouse.click(2,2);assert.equal(await update.count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:new URL(`update-${width}.png`,output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await page.getByRole('button',{name:'稍后再说',exact:true}).click();await page.getByRole('button',{name:'普通弹窗',exact:true}).click();await page.locator('dialog[open]').waitFor();await page.mouse.click(2,2);assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByRole('button',{name:'睡觉反馈',exact:true}).click();await page.locator('[data-feedback="sleep"]').waitFor();
  if(width===390)await page.waitForTimeout(250);
  if(width===390)await page.locator('.room-card').screenshot({path:new URL('sleep-390.png',output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await page.getByRole('button',{name:'返回地毯',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-animation')==='idle');
  await page.getByRole('button',{name:'模拟自主如厕',exact:true}).click();await page.locator('[data-toilet-cat="cat-04"]').waitFor();assert.equal(await page.locator('[data-room-cat="cat-04"]').isVisible(),false);
  if(width===390)await page.waitForTimeout(250);
  if(width===390)await page.locator('.room-card').screenshot({path:new URL('toilet-390.png',output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  if(width===430){await page.waitForFunction(()=>!document.querySelector('[data-toilet-cat]'),null,{timeout:9000});assert.equal(await page.locator('[data-room-cat="cat-04"]').isVisible(),true);await page.waitForFunction(()=>{const cat=document.querySelector('[data-room-cat="cat-04"]');return cat?.getAttribute('data-playback')==='playing'&&cat?.getAttribute('data-animation')==='idle'&&!cat.hidden;});await page.getByRole('button',{name:'模拟自主如厕',exact:true}).click();await page.locator('[data-toilet-cat]').waitFor();}
  await page.getByRole('button',{name:'打断去喝水',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-animation')==='drink:loop');assert.equal(await page.locator('[data-room-cat="cat-04"]').isVisible(),true);assert.equal(await page.locator('[data-toilet-cat]').count(),0);
  await page.getByRole('button',{name:'抚摸喵呜',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.focus-cat-view img')?.getAttribute('data-animation')==='pet:once');await page.waitForFunction(()=>document.querySelector('.focus-cat-view img')?.getAttribute('data-animation')==='idle');
  await page.getByRole('button',{name:'返回地毯',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-animation')==='idle');
  await page.getByRole('button',{name:'查看伸懒腰',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-animation')==='stretch:once');
  if(width===390)await page.waitForFunction(()=>Number(document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-frame'))>=7);
  if(width===390)await page.locator('.room-card').screenshot({path:new URL('stretch-390.png',output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await page.waitForFunction(()=>document.querySelector('[data-room-cat="cat-04"]')?.getAttribute('data-animation')==='idle');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);results.push({width,passed:true,checks:['update modal and backdrop exception','ordinary backdrop dismissal','sleep Zzz','toilet disappearance and manual return','focus pet','stretch decode and recovery','no overflow or page errors']});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:840}});const page=await context.newPage();await page.goto(base+'/');await page.getByRole('button',{name:'开始今天的专注'}).click();await page.getByRole('button',{name:'猫咪小屋',exact:true}).click();assert.equal(await page.locator('[aria-label="选择首次领养的猫咪"] button').count(),6);
 await page.getByRole('button',{name:/铃铛预览 铃铛/}).click();await page.getByRole('button',{name:'确认领养 · 铃铛'}).click();await page.getByRole('button',{name:'专注',exact:true}).click();await page.getByRole('button',{name:'抚摸铃铛',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.focus-cat-view img')?.getAttribute('data-animation')==='pet:once');
 await page.getByRole('button',{name:'开始专注',exact:true}).click();await page.getByRole('button',{name:/暂停/,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.focus-cat-view img')?.getAttribute('data-animation')==='sleep_loop');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.focus-cat-view img')?.getAttribute('data-animation')==='sleep_loop');assert.match(await page.locator('main').innerText(),/铃铛/);await page.getByRole('button',{name:'猫咪小屋',exact:true}).click();await page.getByRole('button',{name:'管理入住与新伙伴',exact:true}).click();await page.locator('dialog.resident-manager[open]').waitFor();await page.mouse.click(2,2);assert.equal(await page.locator('dialog[open]').count(),0);results.push({integration:'real app initial adoption, pet, countdown pause and refreshed session/companion retention',passed:true});await context.close();
} finally {await browser.close();await writeFile(new URL('browser-results.json',output),JSON.stringify({engine:'Microsoft Edge headless, isolated contexts',realPhone:false,results},null,2));}
console.log(JSON.stringify(results));
