"""Fixed artwork + local drawn contours + rigid joint rotations. No displacement fields."""
from pathlib import Path
import json,math,hashlib,io
import numpy as np
from PIL import Image,ImageDraw,ImageChops,ImageFilter
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=HERE/'resources'
S=1254
FILTER=None
CFG={
 'cat-04':dict(name='黑猫',prototype='public/cat_04/cat_04_prototype.png',eyes=[(763,339),(901,314)],muzzle=(1310,795),arms=[([(930,480),(1030,350),(1120,320),(1170,410),(1010,570),(930,585)],(965,535),(1100,365)), ([(890,635),(1080,520),(1180,525),(1230,620),(980,740),(890,720)],(940,690),(1140,565))]),
 'cat-05':dict(name='珍珠',prototype='public/cat_05/cat_05_pearl_prototype.png',eyes=[(751,387),(906,358)],muzzle=(1310,770),arms=[([(1000,470),(1100,330),(1250,290),(1250,430),(1080,540),(1000,550)],(1030,510),(1160,350)), ([(950,620),(1100,490),(1230,470),(1240,570),(1060,720),(940,740)],(980,680),(1150,515))]),
 'cat-06':dict(name='简州狸花白',prototype='public/cat_06/cat_06_jianzhou_tabby_white_prototype.png',eyes=[(796,357),(941,319)],muzzle=(1340,800),arms=[([(1010,520),(1100,380),(1240,360),(1240,490),(1120,600),(1020,610)],(1050,565),(1160,425)), ([(940,680),(1100,550),(1240,530),(1250,650),(1060,785),(950,790)],(1000,730),(1180,590))])}

def clean(path,threshold=16):
 a=np.array(Image.open(path).convert('RGBA'));a[:,:,3]=np.where(a[:,:,3]<threshold,0,np.where(a[:,:,3]>=240,255,a[:,:,3]));a[a[:,:,3]==0,:3]=0
 return Image.fromarray(a)

def translate(im,dx,dy):
 out=Image.new('RGBA',(S,S));out.alpha_composite(im,(dx,dy));return out

def fitted(im,reference=None):
 l,t,r,b=(reference or im).getchannel('A').getbbox();factor=min(1090/(r-l),1110/(b-t));w,h=round((r-l)*factor),round((b-t)*factor);x=(S-w)//2;y=1200-h
 canvas=Image.new('RGBA',(S,S));canvas.alpha_composite(im.crop((l,t,r,b)).resize((w,h),Image.Resampling.NEAREST),(x,y))
 return canvas,lambda p:(round(x+(p[0]-l)*factor),round(y+(p[1]-t)*factor))

def hinge(base,points,pivot,angle,overlap=30,axis='x'):
 if abs(angle)<.00001:return base.copy()
 mask=Image.new('L',(S,S));ImageDraw.Draw(mask).polygon(points,fill=255)
 layer=base.copy();layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mask))
 erase=mask.copy();px,py=pivot;ImageDraw.Draw(erase).ellipse((px-overlap,py-overlap,px+overlap,py+overlap),fill=0)
 if axis=='x':ImageDraw.Draw(erase).rectangle((0,0,px+overlap,S),fill=0)
 else:ImageDraw.Draw(erase).rectangle((0,py-overlap,S,S),fill=0)
 rest=base.copy();rest.putalpha(ImageChops.subtract(rest.getchannel('A'),erase));rest.alpha_composite(layer.rotate(angle,resample=Image.Resampling.NEAREST,center=pivot))
 return rest

def eyes(base,donor,points,state):
 if not state:return base.copy()
 mask=Image.new('L',(S,S));d=ImageDraw.Draw(mask)
 for x,y in points:d.rectangle((x-68,y-57,x+68,y+(52 if state=='closed' else 1)),fill=255)
 return Image.composite(donor,base,mask)

def contour(base,peak,amount,kind):
 """Draw an outer fur strip; retain interior markings and all fixed regions exactly."""
 if amount<=0:return base.copy()
 a=np.array(base);donor=np.array(peak)
 if kind=='idle':
  for y in range(600,940):
   xs=np.where(a[y,:,3]>0)[0]
   if not len(xs):continue
   edge=int(xs[-1]);dx=np.where(donor[y,:,3]>128)[0]
   authored=max(22,min(24,int(dx[-1])-edge)) if len(dx) else 24
   shift=round(authored*amount*math.sin(math.pi*(y-600)/340)**2)
   if not shift:continue
   strip=a[y,edge-18:edge+1].copy();solid=np.where(a[y,max(0,edge-80):edge-18,3]>=240)[0]
   fill=a[y,max(0,edge-80)+int(solid[-1])] if len(solid) else a[y,edge-30]
   a[y,edge-18:edge+shift+1]=fill;a[y,edge+shift-18:edge+shift+1]=strip
 else:
  raise ValueError('Only the idle side-contour tool is supported; sleep uses a rigid back layer.')
 return Image.fromarray(a)

def back_breath(base,amount):
 # Rotate the upper-back layer rigidly; blend the seam inside the coat, away from head/tail.
 if amount<=0:return base.copy()
 mask=Image.new('L',(S,S));d=ImageDraw.Draw(mask)
 d.rectangle((170,0,620,690),fill=255);mask=mask.filter(ImageFilter.GaussianBlur(24));d=ImageDraw.Draw(mask);d.rectangle((690,0,S,S),fill=0);d.rectangle((0,760,S,S),fill=0)
 rotated=base.rotate(3*amount,resample=Image.Resampling.NEAREST,center=(120,900))
 return Image.composite(rotated,base,mask)

def tail(base,amount):return hinge(base,[(0,760),(365,760),(365,1045),(0,1045)],(280,1020),amount*5,35,'y')
def head(base,amount):return hinge(base,[(450,0),(1254,0),(1254,590),(450,590)],(805,565),amount*1.6,65,'y')

def jaw(base,point,amount,drink=False):
 im=base.copy();d=ImageDraw.Draw(im);x,y=point
 if drink:
  length=round(24*amount)
  if length:
   d.polygon([(x-14,y),(x+12,y),(x+14,y+length-4),(x+8,y+length),(x-6,y+length),(x-14,y+length-5)],fill='#d58d94',outline='#744e53')
   if length>10:d.line((x,y+4,x,y+length-5),fill='#ac6b73',width=2)
 elif amount>.08:
  h=round(24*amount);d.polygon([(x-20,y),(x+19,y),(x+14,y+h),(x-13,y+h+2)],fill='#563a36')
 return im

def save(cat,action,frames,times,meta,contact=None,tracks=None):
 if FILTER and action not in FILTER:return
 folder=OUT/cat/action;mobile=OUT/cat/'mobile'/action;folder.mkdir(parents=True,exist_ok=True);mobile.mkdir(parents=True,exist_ok=True)
 entry={'loop':action!='pet','frameCount':len(frames),'cycleDurationMs':sum(times),'feetAnchor':[627,1200],'facing':'right-three-quarter' if action in ('eat','drink','scratch') else 'front','frames':[]}
 if contact:entry['contact']={'kind':'front-paws' if action=='scratch' else 'muzzle','spritePoint':list(contact),'facing':'right'}
 if tracks:entry['contactPointsByFrame']=tracks
 if action=='pet':entry.update(startPose='idle-first-frame',endPose='idle-first-frame')
 thumbs=[];encoded={}
 for i,(im,duration) in enumerate(zip(frames,times),1):
  file=folder/f'{action}_{i:03}.png';webp=mobile/f'{action}_{i:03}.webp';key=hashlib.sha256(im.tobytes()).digest()
  small=im.resize((288,288),Image.Resampling.NEAREST)
  if key not in encoded:
   png=io.BytesIO();wp=io.BytesIO();im.save(png,'PNG',compress_level=6);small.save(wp,'WEBP',lossless=True,exact=True);encoded[key]=(png.getvalue(),wp.getvalue())
  file.write_bytes(encoded[key][0]);webp.write_bytes(encoded[key][1]);thumbs.append(small)
  entry['frames'].append({'file':file.relative_to(OUT/cat).as_posix(),'mobileFile':webp.relative_to(OUT/cat).as_posix(),'durationMs':duration})
 pre=HERE/'previews'/cat;pre.mkdir(parents=True,exist_ok=True)
 thumbs[0].save(pre/f'{action}.webp','WEBP',save_all=True,append_images=thumbs[1:],duration=times,loop=0 if action!='pet' else 1,lossless=True,exact=True)
 meta['actions'][action]=entry

def build(cat,cfg):
 src=HERE/'sources'/cat;base=clean(src/'prototype.png');closed=clean(src/'closed.png');assert base.size==closed.size==(S,S)
 dy=1200-base.getchannel('A').getbbox()[3];base=translate(base,0,dy);closed=translate(closed,0,dy);eye_points=[(x,y+dy)for x,y in cfg['eyes']]
 idle_peak=translate(clean(src/'idle_peak.png'),0,dy);rawsleep=clean(src/'sleep.png');sleep_base,_=fitted(rawsleep)
 meta={'id':cat,'name':cfg['name'],'version':'cat-expansion-v2','canvas':[S,S],'mobileCanvas':[288,288],'feetAnchor':[627,1200],'mobileFeetAnchor':[144,round(1200*288/S,5)],'timingMode':'per-frame-duration-ms','actions':{}}
 if FILTER:meta['actions']=json.loads((OUT/cat/'animations.json').read_text(encoding='utf-8'))['actions']
 frames=[];times=[150]*44+[80,100,80]+[150]*16
 for i in range(63):
  breath=(1-math.cos(2*math.pi*(i%21)/21))/2;im=head(contour(base,idle_peak,breath,'idle'),breath*.2)
  if 20<=i<=33:im=tail(im,math.sin(math.pi*(i-20)/13)**2)
  frames.append(eyes(im,closed,eye_points,'closed' if i==45 else 'half' if i in (44,46) else None))
 save(cat,'idle',frames,times,meta)
 save(cat,'sleep',[back_breath(sleep_base,(1-math.cos(2*math.pi*i/32))/2) for i in range(32)],[150]*32,meta)
 eat,trans=fitted(clean(src/'eat.png',240));mouth=trans(cfg['muzzle'])
 for action,n in [('eat',16),('drink',20)]:
  frames=[]
  for i in range(n):
   phase=(1-math.cos(2*math.pi*i/(8 if action=='eat' else 5)))/2;im=jaw(eat,mouth,phase,action=='drink')
   frames.append(im)
  save(cat,action,frames,[100 if action=='eat' else 75]*n,meta,mouth)
 scratch,trans=fitted(clean(src/'scratch.png',16));arms=[([trans(p) for p in pts],trans(pivot),trans(paw))for pts,pivot,paw in cfg['arms']]
 frames=[];tracks=[]
 for i in range(24):
  im=scratch.copy();contacts=[]
  for j,(points,pivot,paw) in enumerate(arms):
   angle=-9*(1-math.cos(2*math.pi*i/24+j*math.pi))/2;im=hinge(im,points,pivot,angle,42)
   rad=math.radians(angle);dx,dy=paw[0]-pivot[0],paw[1]-pivot[1];contacts.append([round(pivot[0]+math.cos(rad)*dx+math.sin(rad)*dy),round(pivot[1]-math.sin(rad)*dx+math.cos(rad)*dy)])
  frames.append(im);tracks.append(contacts)
 save(cat,'scratch',frames,[50]*24,meta,arms[0][2],tracks)
 frames=[]
 for i in range(24):
  amount=math.sin(math.pi*i/23)**2;im=eyes(base,closed,eye_points,'closed' if 6<=i<=16 else 'half' if 3<=i<=19 else None);im=tail(head(im,amount),amount)
  frames.append(base.copy() if i in (0,23) else im)
 save(cat,'pet',frames,[100]*24,meta)
 (OUT/cat/'animations.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(cat,'exported',flush=True)

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--action',action='append',choices=['idle','sleep','eat','drink','scratch','pet']);parser.add_argument('--cat',choices=list(CFG));args=parser.parse_args();FILTER=set(args.action) if args.action else None
 OUT.mkdir(parents=True,exist_ok=True)
 for cat,cfg in CFG.items():
  if not args.cat or args.cat==cat:build(cat,cfg)
 (OUT/'index.json').write_text(json.dumps({'version':'cat-expansion-v2','cats':[{'id':cat,'name':v['name'],'manifest':cat+'/animations.json'}for cat,v in CFG.items()]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 data={'cats':{cat:json.loads((OUT/cat/'animations.json').read_text(encoding='utf-8'))for cat in CFG},'layout':json.loads((ROOT/'art/room-v0.1/scene-calibration/layout.json').read_text(encoding='utf-8'))}
 (HERE/'preview-data.js').write_text('const PREVIEW='+json.dumps(data,ensure_ascii=False)+';\n',encoding='utf-8',newline='\n')
