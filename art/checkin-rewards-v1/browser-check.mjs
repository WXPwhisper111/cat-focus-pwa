import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const pathFor = name => new URL(name, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
try {
  for (const viewport of [{width:320,height:690},{width:360,height:740},{width:390,height:844},{width:430,height:860},{width:320,height:480},{width:844,height:390}]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4238/');
    await page.locator('.daily-welcome[open]').waitFor();
    assert.match(await page.locator('.welcome-reward').innerText(), /\+5/);
    assert.equal(await page.locator('.welcome-reward svg').getAttribute('viewBox'), '0 0 64 64');
    await page.locator('#welcome-start').click();
    await page.evaluate(() => { window.testOriginalNow=Date.now; window.testDay=window.testOriginalNow(); Date.now=()=>window.testDay; });
    for (let index=1;index<7;index++) {
      await page.evaluate(() => { const date=new Date(window.testDay); date.setDate(date.getDate()+1); window.testDay=date.getTime(); window.dispatchEvent(new Event('focus')); });
      await page.locator('.daily-welcome[open]').waitFor();
      await page.waitForFunction(expected=>document.querySelector('.welcome-progress')?.textContent.includes(`连续签到 ${expected} 天`),index+1);
      if(index<6) await page.locator('#welcome-close').click();
    }
    assert.match(await page.locator('.welcome-reward').innerText(), /\+30/);
    assert.match(await page.locator('.welcome-breakdown').innerText(), /基础 \+5 · 连续 \+15 · 累计 \+10/);
    const dialog=await page.locator('.daily-welcome').boundingBox(); assert(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=viewport.width+1&&dialog.y+dialog.height<=viewport.height+1);
    await page.screenshot({path:pathFor(`welcome-${viewport.width}x${viewport.height}.png`)});
    await page.locator('#welcome-start').click();
    await page.getByRole('navigation').getByRole('button',{name:'猫咪小屋',exact:true}).click();
    await page.locator('#confirm-adoption').click(); await page.locator('.room-scene').waitFor();
    await page.getByRole('navigation').getByRole('button',{name:'专注',exact:true}).click();
    await page.locator('[data-mode=stopwatch]').click(); await page.locator('#start').click(); await page.locator('#pause').click();
    await page.locator('.focus-cat-view [data-feedback=sleep] .cat-sleep-moon').waitFor();
    assert.equal(await page.locator('.focus-cat-view [data-feedback=sleep] svg').evaluate(element=>getComputedStyle(element).animationName),'none');
    await page.screenshot({path:pathFor(`sleep-${viewport.width}x${viewport.height}.png`)});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.focus-cat-view [data-feedback=sleep]').evaluate(element=>getComputedStyle(element).animationName),'none');
    await page.reload(); await page.locator('.focus-cat-view [data-feedback=sleep]').waitFor();
    assert.equal(await page.locator('.daily-welcome[open]').count(),0);
    await page.locator('#pause').click(); await page.locator('.focus-cat-view [data-feedback=sleep]').waitFor({state:'detached'});
    await page.locator('#discard').click(); await page.locator('#end-confirm').click();
    for(const name of ['统计','设置','猫咪小屋']) { await page.getByRole('navigation').getByRole('button',{name,exact:true}).click(); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); }
    assert.deepEqual(errors,[]); results.push({viewport,passed:true,checks:['seven committed calendar days','day7 +30 breakdown','formal SVG','scrollable dialog fits','focus pause moon','no sleep pulse','reduced motion','paused refresh recovery','resume cleanup','stats/settings/room navigation','no horizontal overflow']});
    await context.close();
  }
} finally {
  await writeFile(pathFor('browser-results.json'),JSON.stringify({realPhone:false,engine:'headless Edge',results},null,2));
  await browser.close();
}
console.log(JSON.stringify(results));
