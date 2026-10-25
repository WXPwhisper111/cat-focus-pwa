import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
const pathFor=name=>new URL(name,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
try{
  for(const width of [320,390,430]){
    const page=await browser.newPage({viewport:{width,height:740}});
    await page.goto('http://127.0.0.1:4239/art/cat-life-v1/ui-check.html');
    await page.getByRole('button',{name:'睡觉反馈',exact:true}).click();
    const bubble=page.locator('.room-scene [data-feedback=sleep]');await bubble.waitFor();
    assert.equal(await bubble.locator('svg').getAttribute('viewBox'),'0 0 32 24');
    assert.equal(await bubble.locator('svg').evaluate(element=>getComputedStyle(element).animationName),'none');
    const rect=await bubble.boundingBox(),scene=await page.locator('.room-scene').boundingBox();
    assert(rect.x>=scene.x&&rect.x+rect.width<=scene.x+scene.width+1);
    await page.screenshot({path:pathFor(`room-sleep-${width}.png`)});
    await page.getByRole('button',{name:'打断去喝水',exact:true}).click();await bubble.waitFor({state:'detached'});
    await page.getByRole('button',{name:'模拟发现新版本',exact:true}).click();
    const dialog=page.locator('.version-update-dialog[open]');await dialog.waitFor();
    assert.match(await dialog.innerText(),/每一天的小积累，都有新惊喜/);assert.match(await dialog.innerText(),/v10/);assert.equal(await dialog.locator('li').count(),5);
    await page.mouse.click(1,1);assert.equal(await dialog.count(),1);
    await page.screenshot({path:pathFor(`update-${width}.png`)});
    await dialog.locator('[data-release-later]').click();assert.equal(await dialog.count(),0);
    results.push({width,passed:true,checks:['real room sleep clip','moon within scene bounds','no heart pulse','manual interruption cleanup','current release notes and v10 notice','outside click does not close update','later closes']});await page.close();
  }
}finally{await writeFile(pathFor('scene-update-results.json'),JSON.stringify({realPhone:false,simulatedUpdate:true,results},null,2));await browser.close();}
console.log(JSON.stringify(results));
