import {createRequire} from 'node:module';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:840}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.CAT_FOCUS_PRODUCTION_QA_URL||'http://127.0.0.1:4237';await page.goto(base+'/');await page.getByRole('button',{name:'开始今天的专注'}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByText('当前页面已是已检测到的最新版本。',{exact:true}).waitFor();
 assert.equal(await page.locator('.version-update-dialog[open]').count(),0);await page.getByText('查看本版本更新内容',{exact:true}).click();assert.match(await page.locator('.update-release-notes').innerText(),/陪伴有了更多小动作/);
 await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByText('当前页面已是已检测到的最新版本。',{exact:true}).waitFor();assert.equal(await page.locator('.version-update-dialog[open]').count(),0);
 const raw=await(await page.request.get(base+'/sw.js')).text();const config=JSON.parse(raw.split('const CONFIG = ')[1].split(';\n')[0]);assert.equal(config.release.id,'cat-life-v1');assert.equal(config.media.filter(p=>p.startsWith('./cat-stretch-v1/')).length,103);assert.deepEqual(errors,[]);
 const result={engine:'Edge headless',productionBuild:true,version:config.version,release:config.release.id,stretchMediaFiles:103,checks:['fresh install does not advertise update','worker-bound release notes visible in settings','refresh remains current','no page errors']};
 await writeFile(new URL('./production-browser-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();
}finally{await browser.close();}
