// Render existing PNG layers at explicit coordinates. No sprites are repainted.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const { chromium }=require(process.env.CAT_SCENE_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../../..');
const mime={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png'};
(async()=>{
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.CAT_SCENE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const page=await browser.newPage({viewport:{width:1060,height:850},deviceScaleFactor:1});
    page.on('pageerror',error=>console.error(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/art/room-v0.1/scene-calibration/scene.html`);
    const result=await page.evaluate(()=>window.sceneReady);
    if(!result || result.catCount!==1) throw new Error('Scene did not render successfully');
    for(const [id,name] of [['scene-a','room_scene_v01_clean.png'],['scene-b','room_scene_v01_annotated.png']]){
      const encoded=await page.locator('#'+id).evaluate(c=>c.toDataURL('image/png').split(',')[1]);
      fs.writeFileSync(path.join(__dirname,name),Buffer.from(encoded,'base64'));
    }
    console.log(JSON.stringify(result));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
