import {createTimeline} from './timeline.mjs';
const cats=window.STRETCH_DATA.cats,cache=new Map(),players=[];
let paused=false,speed=1,last=performance.now();
function load(file){if(!cache.has(file))cache.set(file,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error(file));im.src=file;}));return cache.get(file);}
function buildRooms(){
 const width=Number(document.querySelector('#width').value),rooms=document.querySelector('#rooms');rooms.replaceChildren();
 const visible=players.filter(p=>p.cat.id===document.querySelector('#room-cat').value);for(const p of players)p.roomImage=null;
 for(let group=0;group<Math.ceil(visible.length/3);group++){
  const room=document.createElement('div');room.className='room';room.style.width=width+'px';room.style.height=(width*3/4)+'px';
  const indices=visible.slice(group*3,group*3+3);
  indices.forEach((p,i)=>{const img=document.createElement('img'),s=width/1024,anchor=indices.length===1?[512,716]:[[385,704],[512,716],[640,704]][i],size=144*p.cat.previewDisplayScale,feet=p.cat.previewAnchor;img.width=size*s;img.height=size*s;img.alt=p.cat.name;img.src=p.image.src;img.style.left=((anchor[0]-feet[0]*size/1254)*s)+'px';img.style.top=((anchor[1]-feet[1]*size/1254)*s)+'px';p.roomImage=img;room.append(img);});
  const text=document.createElement('div');text.className='room-caption';text.textContent=`${width} 像素房间 · ${indices.map(p=>p.cat.name).join(' / ')} · 按正式待机体型补偿统一留白`;
  rooms.append(text,room);
 }
}
for(const cat of cats){
 const panel=document.createElement('section');panel.className='panel';
 const title=document.createElement('h2');title.textContent=cat.name;panel.append(title);
 const views=document.createElement('div');views.className='views';
 const image=document.createElement('img');image.className='sprite card';image.width=176;image.height=176;image.alt=cat.name;image.src=cat.idle[0].file;
 const large=image.cloneNode();large.className='sprite large';large.width=288;large.height=288;views.append(image,large);panel.append(views);
 const status=document.createElement('p');status.className='status';status.textContent='预加载中';panel.append(status);
 const button=document.createElement('button');button.textContent='伸展一次';button.disabled=true;
 const inspect=document.createElement('input');inspect.type='range';inspect.min=0;inspect.max=cat.stretch.frames.length-1;inspect.value=0;inspect.disabled=true;inspect.setAttribute('aria-label',cat.name+'伸展逐帧');panel.append(button,inspect);
 const p={cat,image,large,status,button,timeline:createTimeline(cat),ready:false,inspect:false};players.push(p);
 button.onclick=()=>{p.inspect=false;p.timeline.stretchNow();paint(p);};
 inspect.oninput=()=>{p.inspect=true;const frame=cat.stretch.frames[Number(inspect.value)];show(p,frame.previewFile??frame.file);status.textContent=`逐帧 ${Number(inspect.value)+1}/${cat.stretch.frames.length} · ${frame.durationMs} ms`;};
 document.querySelector('#cats').append(panel);
 Promise.all([...new Set([...cat.idle.map(f=>f.file),...cat.stretch.frames.map(f=>f.previewFile??f.file)])].map(load)).then(()=>{p.ready=true;button.disabled=false;inspect.disabled=false;paint(p);}).catch(e=>{status.className='status error';status.textContent='素材加载失败，保持待机。请重新加载页面重试。';console.error(e);});
}
function show(p,file){p.image.src=file;p.large.src=file;if(p.roomImage)p.roomImage.src=file;}
function paint(p){const s=p.timeline.snapshot();show(p,s.file);p.status.dataset.completed=String(s.completed);p.status.dataset.state=s.state;p.status.textContent=(s.state==='idle'?`待机 · 已计时 ${(s.waited/1000).toFixed(1)} 秒 / 阈值 ${(s.threshold/1000).toFixed(1)} 秒；等待循环边界`:`伸懒腰 · ${(s.elapsed/1000).toFixed(2)} / 3.60 秒`)+` · 已完成 ${s.completed} 次`;}
for(const cat of cats){const option=document.createElement('option');option.value=cat.id;option.textContent=cat.name;document.querySelector('#room-cat').append(option);}
buildRooms();document.querySelector('#width').onchange=buildRooms;document.querySelector('#room-cat').onchange=buildRooms;
document.querySelector('#speed').onchange=e=>speed=Number(e.target.value);
document.querySelector('#pause').onclick=e=>{paused=!paused;e.target.textContent=paused?'继续':'暂停';last=performance.now();};
document.querySelector('#all').onclick=()=>players.filter(p=>p.ready).forEach(p=>{p.inspect=false;p.timeline.stretchNow();paint(p);});
document.addEventListener('visibilitychange',()=>last=performance.now());
function tick(now){const dt=Math.max(0,now-last);last=now;if(!paused&&!document.hidden)for(const p of players)if(p.ready&&!p.inspect){p.timeline.advance(dt*speed);paint(p);}document.querySelector('#notice').textContent=`已加载 ${players.filter(p=>p.ready).length}/${players.length} 只猫。176 px 专注卡与 288 px 放大预览如下；拖动滑杆可逐帧检查，点击伸展恢复播放。`;requestAnimationFrame(tick);}
requestAnimationFrame(tick);
