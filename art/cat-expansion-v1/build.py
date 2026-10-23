"""Build anchored standalone animations for cats 04–06 from approved prototypes and key poses."""
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
import math, json, shutil, zipfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'public/cat-expansion-v1'
S=1254; M=288; FOOT=[627,1200]
Y,X=np.mgrid[:S,:S].astype(np.float32)
CATS={
 'cat-04':dict(name='吉吉灵感黑猫',prototype='public/cat_04/cat_04_prototype.png',
   eat='exec-f82fb80b-983f-4262-b30b-0173ab0f815c.png',scratch='exec-902076f6-99e8-4659-9cb3-a85c8c165303.png',sleep='exec-3cb170c7-08ff-4f5a-9633-07fd01825015.png',
   eyes=[(737,320),(900,304)],lid='#2d2b35',line='#131219'),
 'cat-05':dict(name='珍珠·布偶猫',prototype='public/cat_05/cat_05_pearl_prototype.png',
   eat='exec-733a4349-abe1-4daa-9879-c2a7c27a113c.png',scratch='exec-8b563ce1-ecef-44d7-b127-240a2a8985c7.png',sleep='exec-0c338bce-e46f-49af-a373-f321bcb74062.png',
   eyes=[(736,380),(902,350)],lid='#a9958e',line='#584740'),
 'cat-06':dict(name='简州猫·狸花白',prototype='public/cat_06/cat_06_jianzhou_tabby_white_prototype.png',
   eat='exec-85d28413-4b69-41b0-98cd-178dda047c91.png',scratch='exec-d3fa3f62-99ef-4964-81db-b800ae513642.png',sleep='exec-c51ab2f9-28e7-4234-9fda-82f07092d1e1.png',
   eyes=[(765,329),(944,306)],lid='#a89b83',line='#4b392d'),
}

def smooth(v,a,b):
 t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)

def warp(image,dx=None,dy=None):
 if dx is None:dx=np.zeros_like(X)
 if dy is None:dy=np.zeros_like(Y)
 sx=np.clip(np.rint(X-dx).astype(np.int32),0,S-1)
 sy=np.clip(np.rint(Y-dy).astype(np.int32),0,S-1)
 return Image.fromarray(np.asarray(image)[sy,sx],'RGBA')

def normalize(file):
 source=Image.open(file).convert('RGBA')
 assert source.size==(S,S)
 a=source.getchannel('A').point(lambda v:0 if v<24 else v)
 source.putalpha(a)
 scaled=source.resize((1190,1190),Image.Resampling.NEAREST)
 alpha=np.asarray(scaled.getchannel('A'))
 ys,xs=np.where(alpha>=24)
 bottom=int(ys.max())
 canvas=Image.new('RGBA',(S,S),(0,0,0,0))
 canvas.alpha_composite(scaled,(32,1199-bottom))
 return canvas

def blink(source,cfg,kind):
 im=source.copy();draw=ImageDraw.Draw(im)
 for cx,cy in cfg['eyes']:
  w,h=(52,20) if kind=='half' else (54,30)
  draw.ellipse((cx-w,cy-h,cx+w,cy+h),fill=cfg['lid'])
  draw.arc((cx-w,cy-10,cx+w,cy+14),0,180,fill=cfg['line'],width=6)
 return im

def idle_frames(base,cfg):
 frames=[]
 times=[150]*44+[80,100,80]+[150]*16
 assert len(times)==63 and sum(times)==9260
 for i,d in enumerate(times):
  phase=math.sin(2*math.pi*(i%21)/21)
  chest=smooth(Y,500,700)*(1-smooth(Y,920,1100))*smooth(X,350,650)
  head=(1-smooth(Y,400,620))*smooth(X,420,650)
  moved=warp(base,dx=38*phase*chest,dy=-9*phase*head)
  if i in (44,46):moved=blink(moved,cfg,'half')
  if i==45:moved=blink(moved,cfg,'closed')
  frames.append((moved,d))
 return frames

def sleep_frames(base):
 frames=[]
 back=(1-smooth(Y,710,980))*smooth(X,100,250)*(1-smooth(X,740,980))
 for i in range(32):
  breath=(1-math.cos(2*math.pi*i/32))/2
  frames.append((warp(base,dy=-32*breath*back),150))
 return frames

def interaction_frames(base,action):
 n,d={'eat':(16,150),'drink':(20,150),'scratch':(16,120)}[action]
 frames=[]
 for i in range(n):
  phase=(1-math.cos(2*math.pi*i/n))/2
  if action=='scratch':
   paw=smooth(X,865,1060)*(1-smooth(Y,460,900))
   frame=warp(base,dy=-90*phase*paw,dx=20*phase*paw)
  else:
   head=smooth(X,660,900)*(1-smooth(Y,840,1100))
   frame=warp(base,dy=(64 if action=='eat' else 54)*phase*head)
   if action=='drink' and phase>.4:
    draw=ImageDraw.Draw(frame)
    draw.ellipse((1090,1065,1108,1090+round(20*phase)),fill='#dc858b',outline='#a96370',width=2)
  frames.append((frame,d))
 return frames

def pet_frames(base,cfg):
 frames=[]
 head=(1-smooth(Y,440,760))*smooth(X,440,650)
 for i in range(16):
  if i in (0,15):frame=base.copy()
  else:
   a=math.sin(math.pi*i/15)**2
   frame=warp(base,dx=65*a*head,dy=-22*a*head)
   if 5<=i<=10:frame=blink(frame,cfg,'closed')
   elif i in (3,4,11,12):frame=blink(frame,cfg,'half')
  frames.append((frame,150))
 return frames

def save(cat,action,frames,meta):
 folder=OUT/cat/action;mobile=OUT/cat/'mobile'/action
 folder.mkdir(parents=True,exist_ok=True);mobile.mkdir(parents=True,exist_ok=True)
 clip={'loop':action!='pet','frameCount':len(frames),'cycleDurationMs':sum(d for _,d in frames),
       'feetAnchor':FOOT,'facing':'right-three-quarter' if action in ('eat','drink','scratch') else 'front',
       'frames':[]}
 contacts={'eat':('muzzle','foodBowl',[1080,1120],[819,652]),
           'drink':('muzzle','waterBowl',[1080,1120],[914,652]),
           'scratch':('front-paw','scratcher',[1160,360],[884,538])}
 if action in contacts:
  kind,item,point,target=contacts[action]
  clip['contact']={'kind':kind,'targetItem':item,'spritePoint':point,
    'targetRoomPoint':target,'itemDisplayPoint':[112,98] if action=='scratch' else [64,45],
    'roomSpriteRect':[round(target[0]-point[0]*144/S,2),round(target[1]-point[1]*144/S,2),144,144]}
 previews=[]
 for i,(frame,d) in enumerate(frames,1):
  assert frame.size==(S,S)
  a=frame.getchannel('A');box=a.getbbox()
  assert box and box[0]>=0 and box[1]>=0 and box[2]<=S and box[3]<=S
  path=folder/f'{action}_{i:03}.png';frame.save(path)
  thumb=frame.resize((M,M),Image.Resampling.NEAREST);webp=mobile/f'{action}_{i:03}.webp'
  thumb.save(webp,'WEBP',lossless=True,method=4,exact=True)
  clip['frames'].append({'file':str(path.relative_to(OUT/cat)).replace('\\','/'),
   'mobileFile':str(webp.relative_to(OUT/cat)).replace('\\','/'),'durationMs':d})
  previews.append(thumb)
 pre=HERE/'previews'/cat;pre.mkdir(parents=True,exist_ok=True)
 previews[0].save(pre/f'{action}.webp','WEBP',save_all=True,append_images=previews[1:],
  duration=[d for _,d in frames],loop=0 if action!='pet' else 1,lossless=True,method=4,exact=True)
 meta[action]=clip

def build(cat,cfg):
 guides=HERE/'keyposes'/cat;guides.mkdir(parents=True,exist_ok=True)
 poses={}
 for role in ('eat','scratch','sleep'):
  source=guides/f'{role}.png'
  if not source.exists():
   raise FileNotFoundError(f'Missing saved key pose: {source}')
  poses[role]=normalize(source)
 prototype=Image.open(ROOT/cfg['prototype']).convert('RGBA')
 meta={}
 for action,frames in [('idle',idle_frames(prototype,cfg)),('sleep',sleep_frames(poses['sleep'])),
   ('eat',interaction_frames(poses['eat'],'eat')),('drink',interaction_frames(poses['eat'],'drink')),
   ('scratch',interaction_frames(poses['scratch'],'scratch')),('pet',pet_frames(prototype,cfg))]:
  save(cat,action,frames,meta)
 (OUT/cat/'animations.json').write_text(json.dumps({'id':cat,'name':cfg['name'],'version':'cat-expansion-v1',
  'canvas':[S,S],'feetAnchor':FOOT,'mobileCanvas':[M,M],
  'mobileFeetAnchor':[144,round(1200*M/S,5)],'timingMode':'per-frame-duration-ms',
  'sourcePrototype':cfg['prototype'],'actions':meta},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 print(cat,{a:m['frameCount'] for a,m in meta.items()},flush=True)

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 for cat,cfg in CATS.items():build(cat,cfg)
 (OUT/'index.json').write_text(json.dumps({'version':'cat-expansion-v1','cats':[
  {'id':cat,'name':cfg['name'],'manifest':f'{cat}/animations.json'} for cat,cfg in CATS.items()]},
  ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
