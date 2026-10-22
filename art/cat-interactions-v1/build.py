"""Build independent, anchored interaction art from approved poses and edited key art."""
from pathlib import Path
import hashlib, json, math, shutil, sys, zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'public/cat-interactions-v1'
GEN=Path('C:/Users/28262/.codex/generated_images/01a15783-9213-7bc1-88dd-bcb81cdfc954')
sys.path.insert(0,str(ROOT/'art/cat-animation-v2'))
import build as previous

SIZE=1254; MOBILE=288; ANCHOR=[627,1200]
CONFIG={
 'cat-01':dict(name='橘白短毛猫 V4',old='cat_01',scale=.91,
    bowl='exec-556b2bb7-bef9-4e05-81e0-83a7063e27ee.png',
    scratch='exec-b850030a-6bcd-4458-b8bb-549ae662e27d.png',
    neutral='exec-770983d2-4ec4-44de-b35b-d4431f51b25e.png',
    bowl_mouth=[1110,930],scratch_paw=[1200,395]),
 'cat-02':dict(name='蓝眼灰白长毛猫',old='cat_02',scale=.89,
    bowl='exec-9abb3f1b-7da0-4868-9266-0cde671ec9e9.png',
    scratch='exec-5a5bc054-0499-48d7-837c-181bf03e37b8.png',
    neutral='exec-73557813-675e-4162-8e5f-007936877e2d.png',
    bowl_mouth=[1120,950],scratch_paw=[1200,315]),
 'cat-03':dict(name='奶油长毛猫',old='cat_03',scale=.87,
    bowl='exec-bebe0f66-1fba-4ea6-a725-8d06236e72ac.png',
    scratch='exec-79152b95-97fc-4992-98c3-5e13dc56c78d.png',
    neutral='exec-e816a76e-cce5-4ebc-93e1-11d2d49a5262.png',
    bowl_mouth=[1130,930],scratch_paw=[1190,365]),
}

Y,X=previous.Y,previous.X
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def smooth(v,a,b):
    t=np.clip((v-a)/(b-a),0,1)
    return t*t*(3-2*t)
def spline(v,a,b,c,d):return smooth(v,a,b)*(1-smooth(v,c,d))
def fieldwarp(source,dx=None,dy=None):
    if dx is None:dx=np.zeros_like(X)
    if dy is None:dy=np.zeros_like(Y)
    if not np.any(dx) and not np.any(dy):return source.copy()
    sx,sy=X.copy(),Y.copy()
    for _ in range(3):
        ix=np.clip(np.rint(sx).astype(np.int32),0,SIZE-1)
        iy=np.clip(np.rint(sy).astype(np.int32),0,SIZE-1)
        sx=X-dx[iy,ix];sy=Y-dy[iy,ix]
    ix=np.clip(np.rint(sx).astype(np.int32),0,SIZE-1)
    iy=np.clip(np.rint(sy).astype(np.int32),0,SIZE-1)
    return Image.fromarray(np.asarray(source)[iy,ix],'RGBA')

def normalize(path,scale):
    source=Image.open(path).convert('RGBA')
    assert source.size==(SIZE,SIZE)
    # Generated guides can contain nearly invisible alpha dust at canvas edges.
    alpha=source.getchannel('A').point(lambda v:0 if v<32 else v)
    source.putalpha(alpha)
    side=round(SIZE*scale)
    art=source.resize((side,side),Image.Resampling.NEAREST)
    # Align the opaque lower contact band, not each frame independently.
    a=np.asarray(art.getchannel('A'))
    rows=np.sum(a[:,round(side*.28):round(side*.94)]>=32,axis=1)
    dense=np.where(rows>15)[0]
    bottom=int(dense.max()) if len(dense) else art.getchannel('A').getbbox()[3]-1
    paste_y=1200-bottom
    canvas=Image.new('RGBA',(SIZE,SIZE))
    canvas.alpha_composite(art,((SIZE-side)//2,paste_y))
    assert canvas.getchannel('A').getbbox()[1]>0
    assert canvas.getchannel('A').getbbox()[3]<SIZE
    return canvas,((SIZE-side)//2,paste_y,scale)

def main_poses(cat):
    cfg=CONFIG[cat]
    old=ROOT/'public'/cfg['old']
    idle=Image.open(old/'idle/idle_01.png').convert('RGBA')
    half=Image.open(old/'idle/idle_06.png').convert('RGBA')
    closed=Image.open(old/'idle/idle_07.png').convert('RGBA')
    poses={'idle':idle,'half':half,'closed':closed}
    transforms={}
    guide=HERE/'design-references'/cat;guide.mkdir(parents=True,exist_ok=True)
    for role in ['bowl','scratch','neutral']:
        src=GEN/cfg[role]
        shutil.copyfile(src,guide/f'{role}.png')
        poses[role],transforms[role]=normalize(src,cfg['scale'])
    return poses,transforms

def turn_idle(source,amount,cfg):
    head=(1-smooth(Y,480 if cfg['old']=='cat_01' else 580,820))*smooth(X,450,650)
    return fieldwarp(source,dx=35*amount*head,dy=8*amount*head)

def bowl_motion(source,action,phase,cfg):
    # Bend the head/chest toward the invisible bowl, fade movement before paws.
    head=smooth(X,520,750)*(1-smooth(Y,960,1200))
    amp=78 if action=='eat' else 66
    frame=fieldwarp(source,dx=8*phase*head,dy=amp*phase*head)
    if action=='drink' and phase>.32:
        px,py=mouth_location(cfg,action,phase)
        draw=ImageDraw.Draw(frame)
        # Small visible tongue distinguishes lapping from chewing at phone size.
        length=round(21+21*phase)
        draw.polygon([(px-9,py+8),(px+9,py+8),(px+7,py+length),(px,py+length+7),(px-7,py+length)],
            fill='#de8989')
        draw.line([(px-9,py+8),(px-7,py+length),(px,py+length+7),(px+7,py+length),(px+9,py+8)],
            fill='#9e6260',width=3)
    return frame

def mouth_location(cfg,action,phase):
    mx,my=cfg['mouth_normalized']
    weight=float(smooth(mx,520,750)*(1-smooth(my,960,1200)))
    return round(mx+8*phase*weight),round(my+(78 if action=='eat' else 66)*phase*weight)

def paw_mask(poly):
    im=Image.new('L',(SIZE,SIZE))
    ImageDraw.Draw(im).polygon(poly,fill=255)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(18)),dtype=np.float32)/255

def scratch_motion(source,phase):
    upper=paw_mask([(1020,250),(1235,240),(1235,790),(1000,790),(940,640)])
    upper*=smooth(X,930,1100)*(1-smooth(Y,620,900))
    lower=paw_mask([(820,720),(1120,720),(1120,1210),(790,1210)])
    lower*=smooth(Y,820,1100)
    # Opposing foreleg strokes; the shoulder regions provide soft hinges.
    return fieldwarp(source,dx=35*(1-phase)*upper+10*phase*lower,
        dy=125*(1-phase)*upper-36*phase*lower)

def pet_motion(poses,i):
    if i in (0,15):return poses['idle'].copy()
    t=i/15
    # Nuzzle once, eyes soften, tail-tip reacts; feet stay planted.
    nuzzle=math.sin(math.pi*t)**2
    base=poses['closed'] if 6<=i<=9 else poses['half'] if 4<=i<=12 else poses['idle']
    # Hold the outside pixels in place: the approved long-hair sprites have
    # whiskers near both canvas edges, which must not be pushed off-canvas.
    head=smooth(X,460,650)*(1-smooth(Y,500,790))
    head*=smooth(X,80,190)*(1-smooth(X,1080,1230))*smooth(Y,40,170)
    tail=np.asarray(Image.new('L',(SIZE,SIZE)),dtype=np.float32)
    # Source idle tail occupies viewer-left; root fades out before the hip.
    tail=smooth(460-X,0,220)*spline(Y,650,750,1110,1190)
    return fieldwarp(base,dx=74*nuzzle*head,dy=-22*nuzzle*head-55*nuzzle*tail)

def loop_frames(action,poses,cfg):
    n,duration={'eat':(16,150),'drink':(20,150),'scratch':(16,120)}[action]
    base=poses['scratch'] if action=='scratch' else poses['bowl']
    frames=[]
    for i in range(n):
        phase=math.sin(math.pi*i/n)**2
        frame=scratch_motion(base,phase) if action=='scratch' else bowl_motion(base,action,phase,cfg)
        frames.append((frame,duration))
    return frames

def transition_frames(start,neutral,end,action,cfg,reverse=False):
    # Pixel-game anticipation and two intermediate contact poses. Keep the
    # original opaque texture in each pose, avoiding transparent double-cats.
    if action=='scratch':
        upper=paw_mask([(990,230),(1235,230),(1235,800),(950,800)])
        upper*=smooth(X,920,1080)*(1-smooth(Y,700,950))
        ready1=fieldwarp(end,dy=105*upper)
        ready2=fieldwarp(end,dy=53*upper)
    else:
        upper=smooth(X,480,690)*(1-smooth(Y,720,1160))
        ready1=fieldwarp(end,dx=-65*upper,dy=-115*upper)
        ready2=fieldwarp(end,dx=-32*upper,dy=-58*upper)
    order=[start,turn_idle(start,.3,cfg),turn_idle(start,.7,cfg),neutral,
           ready1,ready2,end,end]
    if reverse:order=list(reversed(order))
    return [(im.copy(),100) for im in order]

def sequence_meta(action,segment,cat,transforms,frames):
    cfg=dict(CONFIG[cat])
    if action in ('eat','drink'):
        offx,offy,scale=transforms['bowl']
        cfg['mouth_normalized']=[round(cfg['bowl_mouth'][0]*scale+offx),round(cfg['bowl_mouth'][1]*scale+offy)]
    meta={'loop':segment=='loop','frameCount':len(frames),'cycleDurationMs':sum(d for _,d in frames),
      'startPose':'approved-idle' if segment=='enter' or action=='pet' else 'right-facing-contact',
      'endPose':'approved-idle' if segment=='exit' or action=='pet' else 'right-facing-contact',
      'facing':'right-three-quarter' if action!='pet' else 'front-to-right-nuzzle',
      'feetAnchor':ANCHOR,'frames':[]}
    if segment=='loop' and action!='pet':
        role='scratch' if action=='scratch' else 'bowl'
        if role=='bowl':
            mx,my=mouth_location(cfg,action,1)
            point=[mx,my+22]
        else:
            a=np.asarray(frames[len(frames)//2][0].getchannel('A'))
            yy,xx=np.where((a>32)&(np.indices(a.shape)[0]<750)&(np.indices(a.shape)[1]>990))
            assert len(xx)>0
            far=int(np.percentile(xx,99))
            point=[far-15,int(np.median(yy[xx>far-42]))]
        item={'eat':'foodBowl','drink':'waterBowl','scratch':'scratcher'}[action]
        item_point={'eat':[64,45],'drink':[64,45],'scratch':[112,98]}[action]
        target={'eat':[819,652],'drink':[914,652],'scratch':[884,538]}[action]
        meta['contact']={'kind':'front-paw' if action=='scratch' else 'muzzle',
            'spritePoint':point,'targetItem':item,'itemDisplayPoint':item_point,
            'targetRoomPoint':target,'roomSpriteRect':[round(target[0]-point[0]*144/SIZE,2),
            round(target[1]-point[1]*144/SIZE,2),144,144],
            'contactFrame':round(len(frames)/2)}
    return meta

def check(frame,cat,action,segment,index):
    assert frame.size==(SIZE,SIZE)
    a=np.asarray(frame.getchannel('A'))
    assert a.min()==0 and a.max()==255
    mask=a>=16
    ys,xs=np.where(mask)
    box=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    assert box[0]>0 and box[1]>0 and box[2]<SIZE and box[3]<SIZE,(cat,action,segment,index,box)
    assert np.any(mask[1185:1210,530:1120]),(cat,action,segment,index,'missing foot contact')
    return box

def save_segment(cat,action,segment,frames,transforms,qa):
    folder=OUT/cat/action/segment;mobile=OUT/cat/'mobile'/action/segment
    folder.mkdir(parents=True,exist_ok=True);mobile.mkdir(parents=True,exist_ok=True)
    meta=sequence_meta(action,segment,cat,transforms,frames)
    previews=[]
    for idx,(im,duration) in enumerate(frames,1):
        name=f'{segment}_{idx:03}.png'
        box=check(im,cat,action,segment,idx)
        im.save(folder/name,compress_level=5)
        m=im.resize((MOBILE,MOBILE),Image.Resampling.NEAREST)
        mpath=mobile/name.replace('.png','.webp')
        m.save(mpath,'WEBP',lossless=True,quality=100,method=4,exact=True)
        assert np.array_equal(np.asarray(Image.open(mpath).convert('RGBA')),np.asarray(m))
        meta['frames'].append({'file':f'{action}/{segment}/{name}',
          'mobileFile':f'mobile/{action}/{segment}/{mpath.name}','durationMs':duration})
        previews.append(m)
        qa['boxes'].append(box)
    preview=HERE/'previews'/cat;preview.mkdir(parents=True,exist_ok=True)
    target=preview/f'{action}-{segment}.webp'
    previews[0].save(target,'WEBP',save_all=True,append_images=previews[1:],
        duration=[d for _,d in frames],loop=0 if meta['loop'] else 1,
        lossless=True,quality=100,method=4,exact=True)
    qa['sequences'][f'{action}/{segment}']={'frames':len(frames),'durationMs':meta['cycleDurationMs'],'loop':meta['loop']}
    return meta

def build_cat(cat):
    cfg=dict(CONFIG[cat]);poses,transforms=main_poses(cat)
    offx,offy,scale=transforms['bowl']
    cfg['mouth_normalized']=[round(cfg['bowl_mouth'][0]*scale+offx),round(cfg['bowl_mouth'][1]*scale+offy)]
    qa={'cat':cat,'boxes':[],'sequences':{}}
    manifest={'id':cat,'name':cfg['name'],'version':'interactions-v1','canvas':[SIZE,SIZE],
      'feetAnchor':ANCHOR,'mobileCanvas':[MOBILE,MOBILE],
      'mobileFeetAnchor':[144,round(1200*MOBILE/SIZE,5)],'timingMode':'per-frame-duration-ms',
      'actions':{}}
    for action in ['eat','drink','scratch']:
        loop=loop_frames(action,poses,cfg)
        neutral=poses['neutral']
        enter=transition_frames(poses['idle'],neutral,loop[0][0],action,cfg)
        leave=transition_frames(poses['idle'],neutral,loop[0][0],action,cfg,reverse=True)
        manifest['actions'][action]={}
        for segment,frames in [('enter',enter),('loop',loop),('exit',leave)]:
            manifest['actions'][action][segment]=save_segment(cat,action,segment,frames,transforms,qa)
        assert np.array_equal(np.asarray(enter[0][0]),np.asarray(poses['idle']))
        assert np.array_equal(np.asarray(enter[-1][0]),np.asarray(loop[0][0]))
        assert np.array_equal(np.asarray(leave[0][0]),np.asarray(loop[0][0]))
        assert np.array_equal(np.asarray(leave[-1][0]),np.asarray(poses['idle']))
    pet=[(pet_motion(poses,i),150) for i in range(16)]
    manifest['actions']['pet']={'once':save_segment(cat,'pet','once',pet,transforms,qa)}
    assert manifest['actions']['pet']['once']['cycleDurationMs']==2400
    assert np.array_equal(np.asarray(pet[0][0]),np.asarray(poses['idle']))
    assert np.array_equal(np.asarray(pet[-1][0]),np.asarray(poses['idle']))
    folder=OUT/cat
    (folder/'animations.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'validation').mkdir(exist_ok=True)
    (HERE/'validation'/f'{cat}.json').write_text(json.dumps(qa,indent=2)+'\n')
    print(cat,'done',qa['sequences'],flush=True)

if __name__=='__main__':
    HERE.mkdir(exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    protected=previous.protected_snapshot()
    (HERE/'source-hashes-before.json').write_text(json.dumps(protected,indent=2)+'\n')
    cats=sys.argv[1:] or list(CONFIG)
    for cat in cats:build_cat(cat)
    assert protected==previous.protected_snapshot(),'Existing application/cat source changed'
    (OUT/'index.json').write_text(json.dumps({'version':'interactions-v1','cats':[
      {'id':cat,'name':CONFIG[cat]['name'],'manifest':f'{cat}/animations.json'} for cat in CONFIG]},ensure_ascii=False,indent=2)+'\n')
