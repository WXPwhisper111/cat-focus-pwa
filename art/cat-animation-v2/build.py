"""Approved-art-preserving animation rig. Requires bundled Pillow and NumPy.

ImageGen motion drafts guide amplitudes/pose relationships, not fur repaints.
Forward local contour fields are inverted to nearest integer source samples.
No crossfades, changing canvases, frame-specific crops or whole-sprite scaling.
"""
from pathlib import Path
import hashlib
import json
import math
import shutil
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / 'public/cat-animation-v2'
SIZE = 1254
ANCHOR = [627, 1200]
GEN = Path(r'C:/Users/28262/.codex/generated_images/01a15783-9213-7bc1-88dd-bcb81cdfc954')
CONFIG = {
    'cat-01': dict(name='橘白短毛猫 V4', old='cat_01',
        prototype='public/cat/cat_01_prototype_v4.png',
        head_full=440, head_end=560, chest_start=510, chest_peak=680,
        chest_low=910, chest_end=1090, center_x=830, tail_end=420,
        tail_polygon=[(20,770),(200,770),(290,910),(420,960),(480,1080),(480,1210),(20,1210)],
        sleep_flat_y=710, sleep_end_y=940, sleep_x=[130,300,570,710],
        guides=['exec-a9ffb3c2-6997-47a8-bd14-a58de7dbe9ef.png','exec-4f28a45d-19b6-43e5-afe0-a8bab6d75f7b.png']),
    'cat-02': dict(name='蓝眼灰白长毛猫', old='cat_02',
        prototype='public/cat_02/cat_02_prototype_v2.png',
        head_full=550, head_end=660, chest_start=610, chest_peak=740,
        chest_low=930, chest_end=1100, center_x=830, tail_end=460,
        tail_polygon=[(15,595),(310,595),(455,760),(535,970),(535,1235),(15,1235)],
        sleep_flat_y=745, sleep_end_y=890, sleep_x=[120,300,560,710],
        guides=['exec-037fa2c9-42c5-4101-8452-ecfb2fa7cfa0.png','exec-08674344-2dea-4547-a4ea-b2f2b20667bf.png']),
    'cat-03': dict(name='奶油长毛猫', old='cat_03',
        prototype='public/cat_03/cat_03_prototype.png',
        head_full=650, head_end=750, chest_start=700, chest_peak=815,
        chest_low=970, chest_end=1100, center_x=830, tail_end=450,
        tail_polygon=[(60,610),(345,610),(485,790),(540,1010),(540,1220),(60,1220)],
        sleep_flat_y=800, sleep_end_y=935, sleep_x=[180,330,565,700],
        guides=['exec-629eb457-04c6-4c7a-8ed3-2c1c4764837d.png','exec-f001d81c-330a-43f4-af7d-d17280b31ba5.png']),
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def protected_snapshot():
    files = list((ROOT/'src').rglob('*'))
    for folder in ['cat','cat_01','cat_02','cat_03','cat-mobile']:
        files.extend((ROOT/'public'/folder).rglob('*'))
    files += [ROOT/'art/approved-cat-prototypes.json']
    return {str(p.relative_to(ROOT)).replace('\\','/'):sha(p) for p in files if p.is_file()}

def read(path):
    im = Image.open(path).convert('RGBA')
    assert im.size == (SIZE,SIZE), (path,im.size)
    return im

Y, X = np.mgrid[:SIZE,:SIZE].astype(np.float32)

def smooth(value, start, end):
    v = np.clip((value-start)/(end-start),0,1)
    return v*v*(3-2*v)

def plateau(value,a,b,c,d):
    return smooth(value,a,b)*(1-smooth(value,c,d))

def fields(cfg,state):
    zero = np.zeros_like(X)
    if state == 'sleep_loop':
        a,b,c,d = cfg['sleep_x']
        weight = plateau(X,a,b,c,d)*(1-smooth(Y,cfg['sleep_flat_y'],cfg['sleep_end_y']))
        return dict(body_x=zero,body_y=-32*weight,head_y=zero,tail_y=zero)
    tail_mask = Image.new('L',(SIZE,SIZE))
    ImageDraw.Draw(tail_mask).polygon(cfg['tail_polygon'],fill=255)
    # Only the displacement mask is softened; source artwork is never blurred.
    tail_roi = np.asarray(tail_mask.filter(ImageFilter.GaussianBlur(10)),dtype=np.float32)/255
    tail = tail_roi*(1-smooth(X,190 if cfg['old']=='cat_01' else 265,cfg['tail_end']))
    head = 1-smooth(Y,cfg['head_full'],cfg['head_end'])
    chest = plateau(Y,cfg['chest_start'],cfg['chest_peak'],cfg['chest_low'],cfg['chest_end'])
    chest *= smooth(X,300,580)
    # Keep the tail-root/low hindquarter out of chest expansion.
    chest *= 1-tail_roi
    flank = np.tanh((X-cfg['center_x'])/155)
    return dict(body_x=44*flank*chest,body_y=-14*chest,
                head_y=-10*head,tail_y=-56*tail)

def timeline(state):
    if state == 'sleep_loop':
        return [dict(t=i*150,durationMs=150,eyes='closed') for i in range(32)]
    frames = [dict(t=i*150,durationMs=150,eyes='open') for i in range(44)]
    frames += [dict(t=6600,durationMs=80,eyes='half'),dict(t=6680,durationMs=100,eyes='closed'),dict(t=6780,durationMs=80,eyes='half')]
    frames += [dict(t=6860+i*150,durationMs=150,eyes='open') for i in range(16)]
    assert len(frames)==63 and sum(f['durationMs'] for f in frames)==9260
    return frames

def coefficients(state,t):
    if state == 'sleep_loop':
        return .5-.5*math.cos(2*math.pi*t/4800),0
    breath=.5-.5*math.cos(6*math.pi*t/9260)
    tail=math.sin(math.pi*(t-2200)/2000)**2 if 2200<t<4200 else 0
    return breath,tail

def warp(source,field,breath,tail):
    dx=field['body_x']*breath
    dy=(field['body_y']+field['head_y'])*breath+field['tail_y']*tail
    if not np.any(dx) and not np.any(dy):
        return source.copy()
    # Three fixed-point iterations invert a smooth bounded forward rig field.
    sx,sy=X.copy(),Y.copy()
    for _ in range(3):
        ix=np.clip(np.rint(sx).astype(np.int32),0,SIZE-1)
        iy=np.clip(np.rint(sy).astype(np.int32),0,SIZE-1)
        sx=X-dx[iy,ix];sy=Y-dy[iy,ix]
    ix=np.clip(np.rint(sx).astype(np.int32),0,SIZE-1)
    iy=np.clip(np.rint(sy).astype(np.int32),0,SIZE-1)
    return Image.fromarray(np.asarray(source)[iy,ix], 'RGBA')

def contact(im):
    box=im.getchannel('A').crop((780,1100,1140,SIZE)).point(lambda v:255 if v>=16 else 0).getbbox()
    return 1100+box[3]-1

def bbox(im):
    return im.getchannel('A').point(lambda v:255 if v>=16 else 0).getbbox()

def silhouette_metrics(rest,peak,state):
    a=np.asarray(rest.getchannel('A'))>=128
    b=np.asarray(peak.getchannel('A'))>=128
    if state=='sleep_loop':
        xs=range(350,581)
        delta=[]
        for x in xs:
            aa=np.where(a[:,x])[0];bb=np.where(b[:,x])[0]
            if len(aa) and len(bb):delta.append(int(aa[0])-int(bb[0]))
        return dict(kind='back-top-rise',nativeContourPx=float(np.percentile(delta,90)))
    delta=[]
    for y in range(700,961):
        aa=np.where(a[y,980:])[0];bb=np.where(b[y,980:])[0]
        if len(aa) and len(bb):delta.append(int(bb[-1])-int(aa[-1]))
    return dict(kind='chest-right-expansion',nativeContourPx=float(np.percentile(delta,90)))

def build(cat,sleep_only=False):
    cfg=CONFIG[cat];folder=OUT/cat;qa_dir=HERE/cat
    qa_dir.mkdir(parents=True,exist_ok=True)
    guide_dir=qa_dir/'motion-design-references';guide_dir.mkdir(exist_ok=True)
    for state,name in zip(['idle','sleep_loop'],cfg['guides']):
        shutil.copyfile(GEN/name,guide_dir/f'{state}-peak-reference.png')
    old=ROOT/'public'/cfg['old']
    poses=dict(open=read(old/'idle/idle_01.png'),half=read(old/'idle/idle_06.png'),closed=read(old/'idle/idle_07.png'))
    sleep=read(old/'sleep_loop/sleep_loop_01.png')
    manifest=dict(id=cat,name=cfg['name'],approvedPrototype=cfg['prototype'],canvas=[SIZE,SIZE],feetAnchor=ANCHOR,
        timingMode='per-frame-duration-ms',version='natural-visible-v2',animations={})
    qa=dict(id=cat,frames=[],metrics={},checks={})
    if sleep_only:
        manifest=json.loads((folder/'animations.json').read_text(encoding='utf-8'))
        qa=json.loads((qa_dir/'validation.json').read_text(encoding='utf-8'))
        qa['frames']=[f for f in qa['frames'] if not f['file'].startswith('sleep_loop/')]
    for state in (['sleep_loop'] if sleep_only else ['idle','sleep_loop']):
        (folder/state).mkdir(parents=True,exist_ok=True)
        (folder/'mobile'/state).mkdir(parents=True,exist_ok=True)
        source=poses['open'] if state=='idle' else sleep
        field=fields(cfg,state)
        mobile_frames=[];preview_frames=[];entries=[]
        for i,event in enumerate(timeline(state),1):
            breath,tail=coefficients(state,event['t'])
            base=poses[event['eyes']] if state=='idle' else sleep
            im=warp(base,field,breath,tail)
            filename=f'{state}_{i:03}.png'
            im.save(folder/state/filename,compress_level=6)
            mobile=im.resize((288,288),Image.Resampling.NEAREST)
            mobile_name=f'{state}/{filename[:-4]}.webp'
            mobile.save(folder/'mobile'/mobile_name,'WEBP',lossless=True,quality=100,method=4,exact=True)
            assert Image.open(folder/'mobile'/mobile_name).convert('RGBA').tobytes()==mobile.tobytes()
            mobile_frames.append(mobile)
            preview_frames.append(im.resize((384,384),Image.Resampling.NEAREST))
            entry=dict(file=f'{state}/{filename}',mobileFile=f'mobile/{mobile_name}',durationMs=event['durationMs'],
                       timeMs=event['t'],eyes=event['eyes'])
            entries.append(entry)
            box=bbox(im)
            assert box[0]>0 and box[1]>0 and box[2]<SIZE and box[3]<SIZE,(cat,state,i,box)
            assert im.getchannel('A').getextrema()==(0,255)
            assert contact(im)==1200,(cat,state,i,contact(im))
            # No sliding feet. Breathing/support ends far above the paw region.
            assert np.array_equal(np.asarray(im)[1100:,750:],np.asarray(base)[1100:,750:])
            if state=='sleep_loop':
                assert np.array_equal(np.asarray(im)[:,720:],np.asarray(base)[:,720:])
                assert np.array_equal(np.asarray(im)[950:,:690],np.asarray(base)[950:,:690])
            qa['frames'].append(dict(file=entry['file'],alphaBounds=box,pawY=1200))
            if i%16==0:print(f'{cat} {state} {i}/{len(timeline(state))}',flush=True)
        durations=[e['durationMs'] for e in entries]
        manifest['animations'][state]=dict(loop=True,frameCount=len(entries),cycleDurationMs=sum(durations),
            blinkCountPerCycle=1 if state=='idle' else 0,frames=entries)
        for size_name,frames in [('preview',preview_frames),('mobile-preview',mobile_frames)]:
            path=qa_dir/f'{state}-{size_name}.png'
            frames[0].save(path,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=0,blend=0,optimize=False)
            with Image.open(path) as check:
                observed=[]
                for k in range(check.n_frames):check.seek(k);observed.append(check.info['duration'])
                assert sum(observed)==sum(durations)
                qa['checks'][f'{state}-{size_name}-timing']=True
        # A lossless animated WebP is a lighter alternate preview.
        mobile_frames[0].save(qa_dir/f'{state}-preview.webp','WEBP',save_all=True,
            append_images=mobile_frames[1:],duration=durations,loop=0,lossless=True,quality=100,method=4,exact=True)
        peak=warp(source,field,1,0)
        source.save(qa_dir/f'{state}-rest.png')
        peak.save(qa_dir/f'{state}-breath-peak.png')
        metric=silhouette_metrics(source,peak,state)
        metric['mobileContourPx']=metric['nativeContourPx']*288/SIZE
        metric['cssProjectionAt390']=metric['nativeContourPx']*144/SIZE*348/1024
        metric['cssProjectionAt430']=metric['nativeContourPx']*144/SIZE*388/1024
        qa['metrics'][state]=metric
        # Compare rest/peak on actual 288px derivatives too, not only raw fields.
        source_mobile=np.asarray(source.resize((288,288),Image.Resampling.NEAREST).getchannel('A'))>=128
        peak_mobile=np.asarray(peak.resize((288,288),Image.Resampling.NEAREST).getchannel('A'))>=128
        if state=='sleep_loop':
            differences=[]
            for x in range(80,134):
                aa=np.where(source_mobile[:,x])[0];bb=np.where(peak_mobile[:,x])[0]
                if len(aa) and len(bb):differences.append(int(aa[0])-int(bb[0]))
        else:
            differences=[]
            for y in range(161,220):
                aa=np.where(source_mobile[y,225:])[0];bb=np.where(peak_mobile[y,225:])[0]
                if len(aa) and len(bb):differences.append(int(bb[-1])-int(aa[-1]))
        measured=float(np.percentile(differences,90))
        metric['measuredMobileContourPx']=measured
        metric['measuredCssAt390']=measured*144/288*348/1024
        metric['measuredCssAt430']=measured*144/288*388/1024
        assert metric['measuredCssAt390'] >= (1.5 if state=='idle' else 1.0),metric
        # Local overview sheet: rest / inhale / tail peak or exhale.
        variants=[source,peak,warp(source,field,0,1) if state=='idle' else source]
        sheet=Image.new('RGB',(3*330,380),'#f6ecdc');draw=ImageDraw.Draw(sheet)
        for j,(v,label) in enumerate(zip(variants,['rest','inhale peak','tail peak' if state=='idle' else 'exhale'])):
            t=v.resize((320,320),Image.Resampling.NEAREST)
            sheet.paste(t,(j*330+5,30),t);draw.text((j*330+12,10),label,fill='#49372f')
        sheet.save(qa_dir/f'{state}-motion-sheet.png')
        del mobile_frames,preview_frames
    (folder/'animations.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    qa['checks'].update(fixedFeet=True,realAlpha=True,unclipped=True,losslessMobile=True,sleepHeadPawsTailFixed=True)
    (qa_dir/'validation.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(cat=cat,metrics=qa['metrics']),ensure_ascii=False),flush=True)

if __name__=='__main__':
    HERE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    snapshot_path=HERE/'protected-source-hashes.json'
    if not snapshot_path.exists():
        snapshot_path.write_text(json.dumps(protected_snapshot(),indent=2)+'\n',encoding='utf-8')
    sleep_only='--sleep-only' in sys.argv
    selected=[a for a in sys.argv[1:] if a!='--sleep-only'] or list(CONFIG)
    for cat in selected:build(cat,sleep_only=sleep_only)
    before=json.loads(snapshot_path.read_text(encoding='utf-8'))
    after=protected_snapshot();assert before==after,'Existing source/resources changed during build'
    (OUT/'index.json').write_text(json.dumps(dict(version=2,canvas=[SIZE,SIZE],feetAnchor=ANCHOR,
        cats=[dict(id=k,name=c['name'],manifest=f'{k}/animations.json') for k,c in CONFIG.items()]),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Existing assets and application sources unchanged.',flush=True)
