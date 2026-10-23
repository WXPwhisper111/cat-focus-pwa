"""Validate decoded assets, fixed regions and timing, and render inspectable phase sheets."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,numpy as np
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PUBLIC=HERE/'resources'
OUT=HERE/'validation';OUT.mkdir(exist_ok=True)
ACTIONS=['idle','sleep','eat','drink','scratch','pet']
reports=[];contact=Image.new('RGB',(1200,660),'#f1e1cb');labels=ImageDraw.Draw(contact)
for row,cat in enumerate(['cat-04','cat-05','cat-06']):
 meta=json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'))
 assert meta['canvas']==[1254,1254] and meta['feetAnchor']==[627,1200]
 sheet=Image.new('RGB',(1000,1200),'#f1e1cb');d=ImageDraw.Draw(sheet)
 for ar,action in enumerate(ACTIONS):
  clip=meta['actions'][action];frames=clip['frames'];assert len(frames)==clip['frameCount'];assert sum(f['durationMs']for f in frames)==clip['cycleDurationMs']
  arrays=[]
  for f in frames:
   im=Image.open(PUBLIC/cat/f['file']).convert('RGBA');a=np.array(im);assert im.size==(1254,1254)
   assert a[:,:,3].min()==0 and a[:,:,3].max()==255
   box=im.getchannel('A').getbbox();assert box[0]>0 and box[1]>0 and box[2]<1254 and box[3]<1254,(cat,action,box)
   mobile=Image.open(PUBLIC/cat/f['mobileFile']).convert('RGBA');assert mobile.size==(288,288)
   assert np.array_equal(np.array(mobile),np.array(im.resize((288,288),Image.Resampling.NEAREST))),(cat,action,'WebP mismatch')
   arrays.append(a)
  reference=arrays[0]
  assert any(not np.array_equal(reference,a)for a in arrays[1:]),(cat,action,'static')
  if action in ('eat','drink'):
   x,y=clip['contact']['spritePoint'];fixed=np.ones(reference.shape[:2],dtype=bool);fixed[y-2:y+42,x-20:x+20]=False
   assert all(np.array_equal(reference[fixed],a[fixed])for a in arrays),(cat,action,'body outside muzzle changed')
  else:
   fixed=(slice(None),slice(780,None)) if action=='sleep' else (slice(1100,None),slice(None))
   assert all(np.array_equal(reference[fixed],a[fixed])for a in arrays),(cat,action,'fixed region changed')
   if action=='sleep':assert all(np.array_equal(reference[:,690:],a[:,690:]) and np.array_equal(reference[760:],a[760:])for a in arrays),(cat,action,'head or tail changed')
  if action=='pet':
   assert np.array_equal(arrays[0],arrays[-1]);idle=Image.open(PUBLIC/cat/meta['actions']['idle']['frames'][0]['file']);assert np.array_equal(arrays[0],np.array(idle))
  indices=[0,len(frames)//4,len(frames)//2,3*len(frames)//4,len(frames)-1]
  for col,i in enumerate(indices):
   im=Image.fromarray(arrays[i]).resize((176,176),Image.Resampling.NEAREST);sheet.paste(im,(col*200+12,ar*200+20),im);d.text((col*200+5,ar*200+3),action+' '+str(i+1),fill='#493b30')
  im=Image.fromarray(arrays[len(arrays)//2]).resize((190,190),Image.Resampling.NEAREST);contact.paste(im,(ar*200+5,row*220+23),im);labels.text((ar*200+4,row*220+4),cat+' '+action,fill='#493b30')
  seam=float(np.mean(np.abs(arrays[0].astype(float)-arrays[-1].astype(float))))
  reports.append({'cat':cat,'action':action,'frames':len(frames),'durationMs':clip['cycleDurationMs'],'fixedRegionIdentical':True,'losslessMobileMatchesPng':True,'loopEndpointMeanDifference':seam})
 sheet.save(OUT/(cat+'-phases-176.png'))
contact.save(HERE/'contact-sheet.png')
(OUT/'assets.json').write_text(json.dumps({'checks':reports,'status':'automated checks passed; see phase sheets for visual review'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('PASS:',len(reports),'clips; full-frame alpha, anchor, timing, fixed-region and lossless checks')
