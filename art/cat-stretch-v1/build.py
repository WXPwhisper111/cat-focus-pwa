"""Position-only registration of drawn poses; no image warping or tween morphing.

Each sheet uses one scale for ALL cells. A manually marked rear contact is
translated to the same target in every pose. The exact official idle is given
the SAME single reference transform for the endpoint and preview copies.
"""
from pathlib import Path
from collections import deque
import json, hashlib, shutil, argparse
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageFont
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];S=1254
def save_json(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),'utf-8',newline='\n')
def normalize_idle(im):
    a=np.array(im.convert('RGBA'));a[:,:,3]=np.where(a[:,:,3]<32,0,a[:,:,3]);a[a[:,:,3]==0,:3]=0
    return Image.fromarray(a)
def clean_cell(sheet,box):
    im=sheet.crop(box).convert('RGBA');a=np.array(im);a[:,:,3]=np.where(a[:,:,3]<32,0,np.where(a[:,:,3]>240,255,a[:,:,3]))
    # Select the subject component, not isolated alpha dust or another cell.
    solid=np.array(Image.fromarray((a[:,:,3]>160).astype('uint8')*255).filter(ImageFilter.MaxFilter(3)))>0
    ys,xs=np.where(solid);cx,cy=im.width/2,im.height*.60
    idx=np.argmin((xs-cx)**2+(ys-cy)**2);q=deque([(int(xs[idx]),int(ys[idx]))]);seen=np.zeros(solid.shape,dtype=bool);seen[ys[idx],xs[idx]]=True
    while q:
        x,y=q.popleft()
        for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=xx<im.width and 0<=yy<im.height and solid[yy,xx] and not seen[yy,xx]:seen[yy,xx]=True;q.append((xx,yy))
    near=np.array(Image.fromarray(seen.astype('uint8')*255).filter(ImageFilter.MaxFilter(21)))>0
    a[:,:,3]=np.where(near,a[:,:,3],0);a[a[:,:,3]==0,:3]=0
    return Image.fromarray(a)
def isolate_pose(sheet,seed):
    """Extract a whole connected cat across nominal grid lines, with no grid cut."""
    a=np.array(sheet);alpha=a[:,:,3]
    solid=np.array(Image.fromarray((alpha>160).astype('uint8')*255).filter(ImageFilter.MaxFilter(3)))>0
    ys,xs=np.where(solid);idx=np.argmin((xs-seed[0])**2+(ys-seed[1])**2)
    seen=np.zeros(solid.shape,dtype=bool);q=deque([(int(xs[idx]),int(ys[idx]))]);seen[ys[idx],xs[idx]]=True
    while q:
        x,y=q.popleft()
        for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=xx<sheet.width and 0<=yy<sheet.height and solid[yy,xx] and not seen[yy,xx]:seen[yy,xx]=True;q.append((xx,yy))
    near=np.array(Image.fromarray(seen.astype('uint8')*255).filter(ImageFilter.MaxFilter(11)))>0
    a[:,:,3]=np.where(near & (alpha>=32),np.where(alpha>240,255,alpha),0);a[a[:,:,3]==0,:3]=0
    im=Image.fromarray(a);box=im.getbbox()
    if not box or box[2]-box[0]>sheet.width*.45 or box[3]-box[1]>sheet.height*.4:raise ValueError('Subject components overlap; manual separation required')
    return im,box
def transform(im,scale,point,target):
    scaled=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST)
    dx=round(target[0]-point[0]*scale);dy=round(target[1]-point[1]*scale)
    out=Image.new('RGBA',(S,S));out.alpha_composite(scaled,(dx,dy))
    before=np.array(scaled)[:,:,3].sum(dtype=np.int64);after=np.array(out)[:,:,3].sum(dtype=np.int64)
    if before!=after:raise ValueError(f'Clipping: {before-after} alpha lost, placement {(dx,dy)}')
    return out
def run(ids=None):
    cfg=json.loads((HERE/'registration.json').read_text('utf-8'));inputs=json.loads((HERE/'inputs.json').read_text('utf-8'))['cats'];result=[]
    for cat in inputs:
        cid=cat['id']
        if cid not in cfg or (ids and cid not in ids):continue
        c=cfg[cid];source=normalize_idle(Image.open(HERE/'sources'/cid/'idle.png'));sheet=Image.open(HERE/c['sheet']).convert('RGBA')
        translation=c.get('idleTranslation',[0,0]);anchor=[627+translation[0],1200+translation[1]]
        base=transform(source,c['idleScale'],[627,1200],anchor)
        # The rear landmark target is a derivative of the approved idle, never a per-frame bbox.
        target=[anchor[0]+(c['sourceRear'][0]-627)*c['idleScale'],anchor[1]+(c['sourceRear'][1]-1200)*c['idleScale']]
        frames=[];poses=[base]
        extracted=[]
        for i,point in enumerate(c['rearPoints']):
            col=i%4;row=i//4;ox=round(col*sheet.width/4);oy=round(row*sheet.height/4)
            im,box=isolate_pose(sheet,[ox+180,oy+180]);a=np.array(im)
            rearx=ox+point[0]
            ys,xs=np.where(a[:,max(0,rearx-8):rearx+9,3]>200)
            reary=int(ys.max());rear=[rearx,reary]
            extracted.append(dict(index=i+1,sourceBox=box,rear=rear))
            try:poses.append(transform(im.crop(box),c['scale'],[rear[0]-box[0],rear[1]-box[1]],target))
            except ValueError as e:raise ValueError(f'{cid} pose {i+1}, box {box}, rear {rear}: {e}') from e
        save_json(HERE/'sources'/cid/'landmarks.json',extracted)
        poses.append(base.copy())
        out=HERE/'resources'/cid;out.mkdir(exist_ok=True,parents=True)
        for j,(im,ms) in enumerate(zip(poses,c['durationsMs'])):
            png=f'stretch/{j+1:03d}.png';webp=f'mobile/{j+1:03d}.webp';(out/'stretch').mkdir(exist_ok=True);(out/'mobile').mkdir(exist_ok=True)
            im.save(out/png);small=im.resize((288,288),Image.Resampling.NEAREST);small.save(out/webp,'WEBP',lossless=True,exact=True)
            frames.append(dict(file=png,mobileFile=webp,durationMs=ms,sourceAnchor=[627,1200],rearContact=[round(v,3) for v in target]))
        idle=[]
        for j,f in enumerate(cat['idle']):
            full=(ROOT/f'public/cat-animation-v2/{cid}/idle/idle_{j+1:03d}.png') if int(cid[-2:])<=3 else (ROOT/f'art/cat-expansion-v2/resources/{cid}/idle/idle_{j+1:03d}.png')
            original=normalize_idle(Image.open(full))
            # Endpoints use the ORIGINAL 1254 PNG, not an upscaled mobile image.
            if j==0:im=base
            else:im=transform(original,c['idleScale'],[627,1200],anchor)
            p=out/'preview-idle'/f'{j+1:03d}.webp';p.parent.mkdir(exist_ok=True);im.resize((288,288),Image.Resampling.NEAREST).save(p,'WEBP',lossless=True,exact=True)
            idle.append(dict(file=p.relative_to(HERE).as_posix(),durationMs=f['durationMs']))
        clip=dict(id='stretch',loop=False,sourceCanvas=[S,S],feetAnchor=[627,1200],rearContact=[round(v,3) for v in target],cycleDurationMs=sum(c['durationsMs']),frameCount=len(frames),startPose='approved-idle-registered',endPose='approved-idle-registered',frames=frames)
        meta=dict(version='stretch-v1',catId=cid,name=cat['name'],sourceCanvas=[S,S],feetAnchor=[627,1200],referenceScale=c['idleScale'],previewDisplayScale=1/c['idleScale'],previewAnchor=anchor,registration=c,actions={'stretch':clip})
        save_json(out/'animations.json',meta)
        preview=HERE/'previews'/cid;preview.mkdir(exist_ok=True,parents=True)
        for size,label in [(288,'stretch'),(176,'card')]:
            ims=[p.resize((size,size),Image.Resampling.NEAREST) for p in poses]
            ims[0].save(preview/f'{label}.webp','WEBP',save_all=True,append_images=ims[1:],duration=c['durationsMs'],loop=1,lossless=True,exact=True)
        board=Image.new('RGB',(288*6,320*3),'#f6eddf');d=ImageDraw.Draw(board)
        for j,im in enumerate(poses):
            small=im.resize((288,288),Image.Resampling.NEAREST);x=(j%6)*288;y=(j//6)*320;board.paste(small,(x,y),small);d.text((x+8,y+290),f'{j+1} / {c["durationsMs"][j]} ms',fill='#503c2b')
        (HERE/'validation').mkdir(exist_ok=True);board.save(HERE/'validation'/f'{cid}-registered.png')
        result.append(dict(id=cid,name=cat['name'],idle=idle,previewDisplayScale=1/c['idleScale'],previewAnchor=anchor,stretch={**clip,'frames':[{**f,'file':(out/f['file']).relative_to(HERE).as_posix(),'previewFile':(out/f['mobileFile']).relative_to(HERE).as_posix()}for f in frames]}))
        print(cid,'exported',len(frames),'frames',clip['cycleDurationMs'],'ms',flush=True)
    save_json(HERE/'manifest.json',dict(version='stretch-v1',cats=result))
    (HERE/'preview-data.js').write_text('window.STRETCH_DATA='+json.dumps(dict(cats=result),ensure_ascii=False)+';\n','utf-8',newline='\n')
    # Static room layers are a preview derivative, never a shipped app resource.
    layout=json.loads((ROOT/'art/room-v0.1/scene-calibration/layout.json').read_text('utf-8'));room=Image.new('RGBA',(1024,768))
    for layer in layout['layers']:
        if layer.get('file') and layer['id']!='cat':
            x,y,w,h=layer['rect'];im=Image.open(ROOT/'public/room'/layer['file']).convert('RGBA').resize((round(w),round(h)),Image.Resampling.NEAREST)
            canvas=Image.new('RGBA',room.size);canvas.paste(im,(round(x),round(y)));room.alpha_composite(canvas)
    room.convert('RGB').save(HERE/'room.png')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cat',action='append');run(p.parse_args().cat)
