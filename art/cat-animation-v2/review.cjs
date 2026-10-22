// Isolated local review server and real-browser two-cycle playback checks.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.CAT_SCENE_PLAYWRIGHT||'playwright');
const ROOT=path.resolve(__dirname,'../..');
const QA=path.join(__dirname,'browser-qa');fs.mkdirSync(QA,{recursive:true});
const MIME={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.css':'text/css; charset=utf-8','.js':'text/javascript','.zip':'application/zip'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const target=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname));
  if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',MIME[path.extname(target)]||'application/octet-stream');res.end(data);});
});
async function review(port){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CAT_SCENE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];const report={playback:[],dimensions:[],screenshots:[],errors};
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  try{
    await page.goto(`http://127.0.0.1:${port}/art/cat-animation-v2/preview.html`);
    const ready=await page.evaluate(()=>window.previewReady);if(!ready||ready.cats!==3)throw Error('Preview failed to initialize');
    console.log(JSON.stringify({ready}),true);
    for(const width of [390,430]){
      await page.setViewportSize({width,height:844});
      for(const state of ['idle','sleep_loop']){
        await page.evaluate(({state})=>window.previewApi.set({cat:'all',state,context:'both',compare:true}),{state});
        await page.evaluate(()=>window.previewApi.resume());
        // All three cats and both contexts run concurrently; never pause offscreen.
        const wait=state==='idle'?19000:10000;
        await page.waitForTimeout(wait);
        const stats=await page.evaluate(()=>window.previewApi.stats());
        for(const cat of ['cat-01','cat-02','cat-03']){
          const events=stats.filter(s=>s.cat===cat);
          const loops=Math.max(...events.map(s=>s.loop));
          if(loops<2)throw Error(`Playback did not complete two cycles: ${width} ${state} ${cat}`);
          report.playback.push({width,state,cat,elapsedMs:wait,observedLoops:loops,paintEvents:events.length});
        }
        console.log(`${width}px ${state}: all three cats completed two cycles.`);
        for(const cat of ['cat-01','cat-02','cat-03']){
          await page.evaluate(({cat,state})=>window.previewApi.set({cat,state,context:'both',compare:true}),{cat,state});
          const dimensions=await page.evaluate(()=>window.previewApi.dimensions());
          const room=dimensions.find(d=>d.kind==='room');const focus=dimensions.find(d=>d.kind==='focus');
          if(Math.abs(focus.width-176)>0.1)throw Error('Focus-card real size changed');
          report.dimensions.push({width,state,cat,roomWidth:room.width,catCanvasCss:room.width*144/1024,focusWidth:focus.width});
          for(const [pose,t] of [['rest',0],['peak',state==='idle'?1500:2400]]){
            await page.evaluate(t=>window.previewApi.sample(t),t);
            const filename=`${cat}-${state}-${width}-${pose}.png`;
            await page.screenshot({path:path.join(QA,filename),fullPage:true});report.screenshots.push(filename);
          }
        }
      }
    }
    if(errors.length)throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(QA,'playback-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('Browser review passed; 24 real-size screenshots saved.');
  }finally{await browser.close();}
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  fs.writeFileSync(path.join(QA,'server.json'),JSON.stringify({port,url:`http://127.0.0.1:${port}/art/cat-animation-v2/preview.html`},null,2));
  console.log(`PREVIEW_URL=http://127.0.0.1:${port}/art/cat-animation-v2/preview.html`);
  try{if(!process.argv.includes('--serve-only'))await review(port);}
  catch(error){console.error(error);process.exitCode=1;server.close();return;}
  if(!process.argv.includes('--serve'))server.close();
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
