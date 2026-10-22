"""Create isolated old-version mobile references and preview data. No app edits."""
from pathlib import Path
import json
from PIL import Image
import build

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
cats=[]
for cat,old,name in [('cat-01','cat_01','橘白短毛猫 V4'),('cat-02','cat_02','蓝眼灰白长毛猫'),('cat-03','cat_03','奶油长毛猫')]:
    source=ROOT/'public'/old
    previous=json.loads((source/'animations.json').read_text(encoding='utf-8'))
    current=json.loads((ROOT/'public/cat-animation-v2'/cat/'animations.json').read_text(encoding='utf-8'))
    for state,sequence in previous['animations'].items():
        for f in sequence['frames']:
            dest=HERE/'baseline-mobile'/cat/f['file'].replace('.png','.webp')
            dest.parent.mkdir(parents=True,exist_ok=True)
            im=Image.open(source/f['file']).convert('RGBA').resize((288,288),Image.Resampling.NEAREST)
            im.save(dest,'WEBP',lossless=True,method=4,quality=100,exact=True)
            f['url']='./baseline-mobile/'+cat+'/'+f['file'].replace('.png','.webp')
    for state,sequence in current['animations'].items():
        for f in sequence['frames']:
            f['url']='../../public/cat-animation-v2/'+cat+'/'+f['mobileFile']
    prior=HERE/'sleep-amplitude-32'/'prior-52-mobile'/cat/'sleep_loop'
    prior.mkdir(parents=True,exist_ok=True)
    base=Image.open(source/'sleep_loop/sleep_loop_01.png').convert('RGBA')
    field=build.fields(build.CONFIG[cat],'sleep_loop')
    field['body_y']=field['body_y']*(52/32)
    old_sleep=json.loads(json.dumps(current['animations']['sleep_loop']))
    for f in old_sleep['frames']:
        breath,_=build.coefficients('sleep_loop',f['timeMs'])
        image=build.warp(base,field,breath,0).resize((288,288),Image.Resampling.NEAREST)
        target=prior/Path(f['mobileFile']).name
        image.save(target,'WEBP',lossless=True,quality=100,method=4,exact=True)
        f['url']='./sleep-amplitude-32/prior-52-mobile/'+cat+'/sleep_loop/'+target.name
    previous['animations']['sleep_loop']=old_sleep
    cats.append(dict(id=cat,name=name,old=previous,new=current))
(HERE/'preview-data.json').write_text(json.dumps(dict(cats=cats),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Preview references prepared.')
