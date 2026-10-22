const ROOT='../../public/';
const IDS=['cat-01','cat-02','cat-03'];
const $=id=>document.getElementById(id);
const error=$('error'),metric=$('metric');
const room=$('room'),focus=$('focus'),zoom=$('zoom');
const contexts=[room,focus,zoom].map(canvas=>{const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;return ctx;});
const imageCache=new Map();
const decodedImages=new Map();
const sequenceCache=new Map();
let rules,layout,manifests,roomBase,cats,selected='cat-01',three=true,autonomy=true,marker=false,speed=1;
let lastReal=performance.now(),randomSeed=731;

function random(){randomSeed=(Math.imul(1664525,randomSeed)+1013904223)>>>0;return randomSeed/4294967296;}
function randomRange([min,max]){return min+Math.floor(random()*(max-min+1));}
function showError(message){error.textContent=message;}
function clearError(){error.textContent='';}
function image(url){
  if(!imageCache.has(url))imageCache.set(url,new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>Promise.resolve(img.decode?.()).then(()=>{decodedImages.set(url,img);resolve(img);},reject);
    img.onerror=()=>reject(Error(`资源加载失败：${url}`));img.src=url;
  }).catch(reason=>{imageCache.delete(url);throw reason;}));
  return imageCache.get(url);
}
function sequence(cat,action){
  const key=`${cat}/${action}`;
  if(sequenceCache.has(key))return sequenceCache.get(key);
  const manifest=manifests[cat];
  const clip=action==='idle'||action==='sleep'?manifest.baseAnimations[action==='idle'?'idle':'sleep_loop']:
    manifest.actions[action][action==='pet'?'once':'loop'];
  const frames=clip.frames.map(frame=>({url:action==='idle'||action==='sleep'?
    ROOT+frame.file.replace(/^\.\//,''):ROOT+`cat-interactions-v2/${cat}/${frame.mobileFile}`,
    durationMs:frame.durationMs??1000/clip.fps}));
  const result={frames,total:frames.reduce((sum,frame)=>sum+frame.durationMs,0),contact:clip.contact||null,loop:action!=='pet'};
  sequenceCache.set(key,result);return result;
}
async function ensure(cat,action){await Promise.all(sequence(cat,action).frames.map(frame=>image(frame.url)));}
function frameAt(cat,action,playhead){
  const clip=sequence(cat,action);let t=clip.loop?playhead%clip.total:Math.min(playhead,clip.total-0.001);
  for(const frame of clip.frames){if(t<frame.durationMs)return decodedImages.get(frame.url);t-=frame.durationMs;}
  return decodedImages.get(clip.frames.at(-1).url);
}
function activityRect(cat){return [...layout.catReferencePoints[IDS.indexOf(cat)].spriteRect];}
function zoneFor(action){return rules.locations[action]||'activity';}
function rectFor(cat,action){
  if(action==='idle')return activityRect(cat);
  if(action==='sleep')return [62,523,144,144];
  return [...sequence(cat,action).contact.roomSpriteRect];
}
function activeIds(){return three?IDS:[selected];}
function freshCat(id){return{id,action:'idle',zone:'activity',rect:activityRect(id),mode:'autonomous',phase:'playing',opacity:1,
  playhead:0,deadline:randomRange(rules.autonomous.idleDurationMs),transition:null,pending:null,revision:0,
  awaitingAuto:false,lastRandom:null,status:'待机'};}
function zoneOwner(zone,exclude){
  if(zone==='activity')return null;
  return activeIds().map(id=>cats[id]).find(cat=>cat.id!==exclude&&
    (cat.zone===zone||cat.transition?.to.zone===zone))||null;
}
function durationFor(cat,action,minimum){
  if(action==='pet')return 2400;
  if(action==='idle')return minimum;
  const cycle=sequence(cat,action).total;
  return Math.ceil(minimum/cycle)*cycle;
}
function sleepDuration(cat){
  const cycle=sequence(cat,'sleep').total;
  const [min,max]=rules.autonomous.sleepDurationMs;
  return randomRange([Math.ceil(min/cycle),Math.floor(max/cycle)])*cycle;
}
function transitionTo(cat,action,mode,minimum){
  const target={action,zone:zoneFor(action),rect:rectFor(cat.id,action),mode,
    deadline:durationFor(cat.id,action,minimum)};
  if(cat.transition){
    cat.transition.to=target;
    if(cat.phase==='fading-in'){
      cat.phase='fading-out';cat.transition.elapsed=(1-cat.opacity)*rules.fadeMs.out;
    }
  }else{
    cat.transition={elapsed:0,to:target};cat.phase='fading-out';
  }
  cat.awaitingAuto=false;cat.status=`淡出 → ${action}`;
}
function idleAfterCommand(cat){
  cat.lastRandom=null;
  if(cat.action==='pet'&&cat.zone==='activity'){
    cat.action='idle';cat.mode='cooldown';cat.phase='playing';cat.opacity=1;cat.playhead=0;
    cat.deadline=rules.autonomous.postCommandIdleMs;cat.status='抚摸结束，原地待机';return;
  }
  transitionTo(cat,'idle','cooldown',rules.autonomous.postCommandIdleMs);
}
function weightedAction(previous,cat){
  let options=Object.entries(rules.autonomous.weights).filter(([action])=>
    action!==previous&&!zoneOwner(zoneFor(action),cat.id));
  if(!options.length)options=[['idle',rules.autonomous.weights.idle]];
  const total=options.reduce((sum,[,weight])=>sum+weight,0);let roll=random()*total;
  for(const [action,weight] of options){roll-=weight;if(roll<0)return action;}
  return options.at(-1)[0];
}
function beginAutonomy(cat){
  if(cat.awaitingAuto)return;
  if(!autonomy){
    if(cat.action==='idle'&&cat.zone==='activity'){
      cat.mode='autonomous';cat.deadline=Infinity;cat.status='自主行为已暂停';
    }else transitionTo(cat,'idle','autonomous',Infinity);
    return;
  }
  cat.awaitingAuto=true;
  const revision=cat.revision;
  let next=weightedAction(cat.lastRandom,cat);
  let duration=next==='idle'?randomRange(rules.autonomous.idleDurationMs):
    next==='sleep'?sleepDuration(cat.id):rules.commandMinimumMs[next];
  void ensure(cat.id,next).then(()=>{
    if(cat.revision!==revision||!cat.awaitingAuto)return;
    cat.awaitingAuto=false;
    if(zoneOwner(zoneFor(next),cat.id)){next='idle';duration=randomRange(rules.autonomous.idleDurationMs);}
    cat.lastRandom=next;
    if(next==='idle'&&cat.action==='idle'&&cat.zone==='activity'){
      cat.mode='autonomous';cat.playhead=0;cat.deadline=durationFor(cat.id,'idle',duration);cat.status='自主待机';
    }else transitionTo(cat,next,'autonomous',duration);
  }).catch(reason=>{cat.awaitingAuto=false;cat.deadline=Infinity;showError(String(reason));});
}
function processCommands(){
  for(const id of activeIds()){
    const cat=cats[id],pending=cat.pending;
    if(!pending?.ready)continue;
    const action=pending.action;
    if(action==='pet'){
      cat.pending=null;cat.transition=null;cat.action='pet';cat.mode='manual';cat.phase='playing';
      cat.opacity=1;cat.playhead=0;cat.deadline=2400;cat.awaitingAuto=false;cat.status='原地抚摸回应';continue;
    }
    const owner=zoneOwner(zoneFor(action),id);
    if(owner){
      if((owner.transition?.to.mode||owner.mode)==='manual'){
        cat.status=`等待${zoneFor(action)}空位`;continue;
      }
      if(owner.transition?.to.action!=='idle')transitionTo(owner,'idle','autonomous',rules.autonomous.postCommandIdleMs);
      cat.status='等待自主行为让位';continue;
    }
    cat.pending=null;
    transitionTo(cat,action,'manual',rules.commandMinimumMs[action]);
  }
}
async function command(id,action){
  if(!IDS.includes(id)||!['eat','drink','scratch','sleep','pet'].includes(action))throw Error('无效指令');
  if(!activeIds().includes(id))throw Error('请先显示这只猫');
  const cat=cats[id],revision=++cat.revision;
  cat.pending={action,ready:false};cat.awaitingAuto=false;cat.status=`加载${action}素材`;
  clearError();
  try{
    await ensure(id,action);
    if(cat.revision!==revision)return{accepted:false,reason:'已被更新指令取代'};
    cat.pending.ready=true;processCommands();draw();
    return{accepted:true,status:cat.status};
  }catch(reason){
    if(cat.revision===revision){cat.pending=null;showError(String(reason));}
    return{accepted:false,reason:String(reason)};
  }
}
function updateOne(cat,dt){
  if(cat.phase==='fading-out'){
    cat.transition.elapsed=Math.min(rules.fadeMs.out,cat.transition.elapsed+dt);
    cat.opacity=1-cat.transition.elapsed/rules.fadeMs.out;
    cat.playhead+=dt;
    if(cat.transition.elapsed>=rules.fadeMs.out){
      const target=cat.transition.to;
      cat.opacity=0;cat.action=target.action;cat.zone=target.zone;cat.rect=target.rect;cat.mode=target.mode;
      cat.deadline=target.deadline;cat.playhead=0;cat.transition.elapsed=0;cat.phase='fading-in';
      cat.status=`${target.action}：淡入`;
    }
    return;
  }
  if(cat.phase==='fading-in'){
    cat.transition.elapsed=Math.min(rules.fadeMs.in,cat.transition.elapsed+dt);
    cat.opacity=cat.transition.elapsed/rules.fadeMs.in;
    if(cat.transition.elapsed>=rules.fadeMs.in){cat.opacity=1;cat.phase='playing';cat.transition=null;cat.status=cat.action;}
    return;
  }
  cat.playhead+=dt;
  if(cat.pending||cat.awaitingAuto||cat.playhead<cat.deadline)return;
  if(cat.mode==='manual')idleAfterCommand(cat);
  else beginAutonomy(cat);
}
function advance(ms){
  let remaining=Math.max(0,ms);
  processCommands();
  while(remaining>0){const step=Math.min(20,remaining);remaining-=step;
    for(const id of activeIds())updateOne(cats[id],step);
    processCommands();
  }
  draw();return snapshot();
}
function snapshot(){return Object.fromEntries(IDS.map(id=>{const c=cats[id];return[id,{
  action:c.action,zone:c.zone,mode:c.mode,phase:c.phase,opacity:+c.opacity.toFixed(4),
  rect:[...c.rect],playheadMs:Math.round(c.playhead),deadlineMs:c.deadline,
  pending:c.pending?.action||null,status:c.status}];}));}
function draw(){
  if(!roomBase||!cats)return;
  const [r,f,z]=contexts;
  r.clearRect(0,0,1024,768);r.drawImage(roomBase,0,0);
  const visible=activeIds().map(id=>cats[id]).sort((a,b)=>a.rect[1]-b.rect[1]);
  for(const cat of visible){
    const frame=frameAt(cat.id,cat.action,cat.playhead);
    if(!frame)continue;
    r.save();r.globalAlpha=cat.opacity;
    const [x,y,w,h]=cat.rect;
    r.fillStyle='rgb(88 56 36 / 18%)';r.fillRect(x+w*.27,y+h*.95,w*.46,h*.055);
    r.drawImage(frame,x,y,w,h);r.restore();
    if(marker&&sequence(cat.id,cat.action).contact){
      const [cx,cy]=sequence(cat.id,cat.action).contact.targetRoomPoint;
      r.fillStyle='#e63b52';r.fillRect(cx-3,cy-3,6,6);
    }
  }
  const chosen=cats[selected],img=frameAt(chosen.id,chosen.action,chosen.playhead);
  for(const ctx of [f,z]){
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    if(img){ctx.save();ctx.globalAlpha=chosen.opacity;ctx.drawImage(img,0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();}
  }
  metric.textContent=`${innerWidth}px 视口 · 三猫 ${three?'开':'关'} · 自主 ${autonomy?'开':'关'} · 速度 ${speed}×\n`+
    visible.map(c=>`${manifests[c.id].name}：${c.action} / ${c.phase} / ${Math.round(c.opacity*100)}%${c.pending?' · 待执行 '+c.pending.action:''}`).join('  |  ');
}
function setThree(value){
  if(three===value)return;three=value;
  if(three){for(const id of IDS)if(id!==selected)cats[id]=freshCat(id);}
  draw();
}
function setAutonomy(value){
  autonomy=value;
  if(!value)for(const id of activeIds()){
    cats[id].awaitingAuto=false;
    if(cats[id].action==='idle'&&cats[id].mode==='autonomous')cats[id].deadline=Infinity;
  }
  if(value)for(const id of activeIds())if(cats[id].action==='idle'&&cats[id].deadline===Infinity)cats[id].deadline=randomRange(rules.autonomous.idleDurationMs);
  draw();
}
function setSelected(id){
  if(!IDS.includes(id))return;
  selected=id;$('catChoice').value=id;
  if(!three)cats[id]=freshCat(id);
  draw();
}
function tick(now){
  const dt=Math.min(100,Math.max(0,now-lastReal));lastReal=now;
  if(!document.hidden)advance(dt*speed);
  requestAnimationFrame(tick);
}
async function initialize(){
  [rules,layout]=await Promise.all([
    fetch('./behavior-rules.json').then(r=>r.json()),
    fetch('../room-v0.1/scene-calibration/layout.json').then(r=>r.json())]);
  manifests=Object.fromEntries(await Promise.all(IDS.map(async id=>[id,await fetch(`${ROOT}cat-interactions-v2/${id}/animations.json`).then(r=>r.json())])));
  const background=document.createElement('canvas');background.width=1024;background.height=768;
  const ctx=background.getContext('2d');ctx.imageSmoothingEnabled=false;
  for(const layer of layout.layers){
    if(!layer.file||layer.id==='cat')continue;
    const filename=layer.id==='outside'?'window_outside_day.png':layer.file;
    const img=await image(`${ROOT}room/${filename}`);ctx.drawImage(img,...layer.rect);
  }
  roomBase=background;
  cats=Object.fromEntries(IDS.map(id=>[id,freshCat(id)]));
  await Promise.all(IDS.map(id=>ensure(id,'idle')));
  document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>{void command(selected,button.dataset.command);});
  $('catChoice').onchange=e=>setSelected(e.target.value);
  $('threeCats').onchange=e=>setThree(e.target.checked);
  $('autonomy').onchange=e=>setAutonomy(e.target.checked);
  $('marker').onchange=e=>{marker=e.target.checked;draw();};
  $('speed').onchange=e=>{speed=Number(e.target.value);};
  document.addEventListener('visibilitychange',()=>{lastReal=performance.now();});
  window.previewApi={command,advance,snapshot,draw,setThree,setAutonomy,setSelected,
    setSpeed(value){speed=value;$('speed').value=String(value);},
    setMarker(value){marker=value;$('marker').checked=value;draw();},
    dimensions(){return[room,focus,zoom].map(c=>c.getBoundingClientRect().width);},
    rules:()=>rules,ids:()=>activeIds(),error:()=>error.textContent};
  draw();requestAnimationFrame(tick);
  return{cats:IDS.length,clips:12};
}
window.previewReady=initialize().catch(reason=>{showError(String(reason.stack||reason));throw reason;});
