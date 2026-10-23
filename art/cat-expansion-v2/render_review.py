"""Render standalone room animations at actual display sizes; no browser required."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PUBLIC=HERE/'resources'
(HERE/'validation').mkdir(exist_ok=True)
layout=json.loads((ROOT/'art/room-v0.1/scene-calibration/layout.json').read_text(encoding='utf-8'))
room_sources=[]
for layer in layout['layers']:
 if not layer.get('file') or layer['id']=='cat':continue
 room_sources.append((Image.open(ROOT/'public/room'/layer['file']).convert('RGBA'),layer['rect']))
backgrounds={}
for width in [390,430]:
 background=Image.new('RGBA',(width,(width*3+2)//4));ratio=width/1024
 for im,(x,y,w,h) in room_sources:background.alpha_composite(im.resize((round(w*ratio),round(h*ratio)),Image.Resampling.NEAREST),(round(x*ratio),round(y*ratio)))
 backgrounds[width]=background
gallery=[]
for cat in ['cat-04','cat-05','cat-06']:
 meta=json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'));gallery.append('<h2>'+meta['name']+'</h2><div class="grid">')
 for action,clip in meta['actions'].items():
  s=144/1254;target={'eat':(819,652),'drink':(914,652),'scratch':(884,538)}.get(action)
  if target:p=clip['contact']['spritePoint'];xy=(round(target[0]-p[0]*s),round(target[1]-p[1]*s))
  else:feet=(144,680) if action=='sleep' else (512,716);xy=(round(feet[0]-627*s),round(feet[1]-1200*s))
  sprites=[];cards=[]
  for f in clip['frames']:
   im=Image.open(PUBLIC/cat/f['mobileFile']).convert('RGBA');sprites.append(im);cards.append(im.resize((176,176),Image.Resampling.NEAREST))
  for width in [390,430]:
   frames=[];ratio=width/1024
   for sprite in sprites:
    scene=backgrounds[width].copy();scene.alpha_composite(sprite.resize((round(144*ratio),round(144*ratio)),Image.Resampling.NEAREST),(round(xy[0]*ratio),round(xy[1]*ratio)));frames.append(scene.convert('RGB'))
   dest=HERE/'room-previews'/cat;dest.mkdir(parents=True,exist_ok=True)
   frames[0].save(dest/(action+'-'+str(width)+'.webp'),'WEBP',save_all=True,append_images=frames[1:],duration=[f['durationMs']for f in clip['frames']],loop=0 if clip['loop'] else 1,lossless=True,exact=True)
  card=HERE/'card-previews'/cat;card.mkdir(parents=True,exist_ok=True);cards[0].save(card/(action+'.webp'),'WEBP',save_all=True,append_images=cards[1:],duration=[f['durationMs']for f in clip['frames']],loop=0 if clip['loop'] else 1,lossless=True,exact=True)
  gallery.append('<div class="card">'+action+'<br><img width="176" height="176" src="card-previews/'+cat+'/'+action+'.webp"><p><a href="room-previews/'+cat+'/'+action+'-390.webp">390 房间动画</a> · <a href="room-previews/'+cat+'/'+action+'-430.webp">430 房间动画</a></p></div>')
 gallery.append('</div>')
for width in [390,430]:
 height=(width*3+2)//4;board=Image.new('RGB',(width*3,height*2),'#f1e1cb')
 for row,action in enumerate(['sleep','scratch']):
  for col,cat in enumerate(['cat-04','cat-05','cat-06']):
   im=Image.open(HERE/'room-previews'/cat/(action+'-'+str(width)+'.webp'));im.seek(im.n_frames//2);board.paste(im.convert('RGB'),(col*width,row*height))
 board.save(HERE/'validation'/('room-'+str(width)+'.png'))
html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2 三猫动画画廊</title><style>body{background:#f5ecdf;color:#49382c;font:15px system-ui;margin:20px}.grid{display:flex;gap:12px;flex-wrap:wrap}.card{background:#fff7ea;padding:12px;border-radius:12px}img{image-rendering:pixelated}a{color:#785c3d}</style><h1>V2 三猫动画画廊</h1><p>以下为可直接播放的 176 像素动画，点击链接查看完整房间动画。抚摸为单次播放，重载页面可重播。</p>'+''.join(gallery)+'</html>'
(HERE/'gallery.html').write_text(html,encoding='utf-8',newline='\n')
fontpath=Path('C:/Windows/Fonts/msyh.ttc');font=ImageFont.truetype(str(fontpath) if fontpath.exists() else 'DejaVuSans.ttf',16)
names=['黑猫','珍珠','简州狸花白'] if fontpath.exists() else ['Black','Pearl','Tabby-white']
actionnames={'idle':'待机','sleep':'睡觉','eat':'进食','drink':'喝水','scratch':'磨爪','pet':'抚摸反馈'}
reel=[];durations=[]
metas={cat:json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'))for cat in ['cat-04','cat-05','cat-06']}
for action,clip in metas['cat-04']['actions'].items():
 for i,f in enumerate(clip['frames']):
  frame=Image.new('RGB',(560,240),'#f5ecdf');d=ImageDraw.Draw(frame);d.text((12,8),actionnames[action] if fontpath.exists() else action,font=font,fill='#49382c')
  for col,(cat,meta) in enumerate(metas.items()):
   im=Image.open(PUBLIC/cat/meta['actions'][action]['frames'][i]['mobileFile']).convert('RGBA').resize((176,176),Image.Resampling.NEAREST);frame.paste(im,(10+col*184,34),im);d.text((20+col*184,214),names[col],font=font,fill='#49382c')
  reel.append(frame);durations.append(f['durationMs'])
reel[0].save(HERE/'motion-reel.webp','WEBP',save_all=True,append_images=reel[1:],duration=durations,loop=0,lossless=True)
print('Rendered 36 room animations and 18 cards')
