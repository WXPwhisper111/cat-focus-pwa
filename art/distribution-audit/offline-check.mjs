import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CAT_FOCUS_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={realPhone:false,engine:'Isolated headless Edge',passed:false};
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4238');
 await page.getByRole('button',{name:'开始今天的专注'}).click();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const warm=await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;
  let reply;
  for(let batch=0;batch<300;batch++) {
   reply=await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(Error('Media timeout')),75000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};registration.active.postMessage({type:'CAT_FOCUS_UPDATE',action:'WARM_MEDIA'},[channel.port2]);});
   if(!reply.ok||reply.failed?.length||!reply.remaining)break;
  }
  return reply;
 });
 assert.equal(warm.ok,true);result.warm=warm;
 const inventory=await page.evaluate(async()=>{
  const raw=await(await fetch('./sw.js')).text(),config=JSON.parse(raw.split('const CONFIG = ')[1].split(';\n')[0]);
  const media=await caches.open(config.mediaCache);const missing=[];
  for(const path of config.media)if(!await media.match(new URL(path,location.href).href))missing.push(path);
  return {version:config.version,count:config.media.length,missing};
 });assert.deepEqual(inventory.missing,[]);result.inventory=inventory;
 await context.setOffline(true);await page.reload();
 await page.getByRole('navigation').getByRole('button',{name:'统计',exact:true}).click();
 await page.locator('.page-header-art img').evaluate(image=>image.decode());
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'专注',exact:true}).click();
 await page.getByRole('button',{name:'开始专注',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('button',{name:'继续专注',exact:true}).click();
 result.passed=true;result.checks=['all 842 media cached','offline reload','offline background decode','offline navigation and timer start/pause/resume'];await context.close();
}finally{await browser.close();await writeFile(new URL('./offline-results.json',import.meta.url),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result));
