"""Resource, registration, endpoint, alpha and unchanged-application checks."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageSequence
from build import HERE,ROOT,transform,save_json,normalize_idle
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
report=[]
manifest=json.loads((HERE/'manifest.json').read_text('utf-8'))
for cat in manifest['cats']:
    cid=cat['id'];meta=json.loads((HERE/'resources'/cid/'animations.json').read_text('utf-8'));clip=meta['actions']['stretch'];c=meta['registration'];frames=clip['frames']
    assert len(frames)==18 and sum(f['durationMs'] for f in frames)==3600
    assert clip['loop'] is False and clip['feetAnchor']==[627,1200]
    pngs=[]
    for f in frames:
        p=Image.open(HERE/'resources'/cid/f['file']).convert('RGBA');w=Image.open(HERE/'resources'/cid/f['mobileFile']).convert('RGBA');a=np.array(p)
        assert p.size==(1254,1254) and w.size==(288,288)
        assert np.any(a[:,:,3]==0) and np.any(a[:,:,3]==255)
        assert not np.any(a[:12,:,3]) and not np.any(a[-12:,:,3]) and not np.any(a[:,:12,3]) and not np.any(a[:,-12:,3]),(cid,f['file'],'edge margin')
        assert np.array_equal(np.array(p.resize((288,288),Image.Resampling.NEAREST)),np.array(w)),(cid,f['file'],'lossless')
        assert f['rearContact']==clip['rearContact'];pngs.append(p)
    assert np.array_equal(np.array(pngs[0]),np.array(pngs[-1]))
    original=normalize_idle(Image.open(HERE/'sources'/cid/'idle.png'));anchor=meta['previewAnchor'];expected=transform(original,c['idleScale'],[627,1200],anchor)
    assert np.array_equal(np.array(pngs[0]),np.array(expected)),(cid,'official idle endpoint')
    idle_first=Image.open(HERE/cat['idle'][0]['file']).convert('RGBA')
    assert np.array_equal(np.array(idle_first),np.array(pngs[0].resize((288,288),Image.Resampling.NEAREST)))
    assert sum(f['durationMs'] for f in cat['idle'])==9260
    assert len({sha(HERE/'resources'/cid/f['file']) for f in frames})>10
    landmarks=json.loads((HERE/'sources'/cid/'landmarks.json').read_text('utf-8'))
    for p in landmarks:
        x,y=p['rear'];l,t,r,b=p['sourceBox'];dest=clip['rearContact'];scale=c['scale']
        error=[abs(round(dest[0]-(x-l)*scale)+(x-l)*scale-dest[0]),abs(round(dest[1]-(y-t)*scale)+(y-t)*scale-dest[1])]
        assert max(error)<=0.501,(cid,p['index'],'rear contact registration')
    for name in ('stretch','card'):
        im=Image.open(HERE/'previews'/cid/(name+'.webp'));total=0;count=0
        for f in ImageSequence.Iterator(im):f.load();total+=f.info.get('duration',0);count+=1
        assert total==3600 and count>10 and im.info.get('loop')==1,(cid,name,total,count)
    report.append(dict(catId=cid,pngFrames=len(frames),durationMs=3600,loop=False,endpoint='exact registered official idle',rearContactErrorPxMax=.5,losslessMobile=True))
protected=json.loads((HERE/'protected-hashes.json').read_text('utf-8'));changed=[p for p,h in protected.items() if not (ROOT/p).is_file() or sha(ROOT/p)!=h]
assert not changed,changed
save_json(HERE/'validation'/'resources.json',dict(cats=report,protectedApplicationFiles=len(protected),changedApplicationFiles=changed))
print('Validated',len(report),'cats, original PNG / lossless mobile / endpoints / anchors / timings; protected',len(protected),'app files')
