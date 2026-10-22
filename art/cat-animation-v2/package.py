"""Validate the delivery and package original/mobile assets without integration."""
from pathlib import Path
import copy
import json
import zipfile
import numpy as np
from PIL import Image
import build

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT/'public/cat-animation-v2'
PACK = HERE/'packages'
PACK.mkdir(exist_ok=True)

def contour_delta(a,b,state):
    a=np.asarray(a.getchannel('A'))>=128
    b=np.asarray(b.getchannel('A'))>=128
    dif=[]
    if state=='idle':
        for y in range(700,960):
            x=np.where(a[y,980:])[0];z=np.where(b[y,980:])[0]
            if len(x) and len(z):dif.append(abs(int(x[-1])-int(z[-1])))
    else:
        for x in range(350,580):
            y=np.where(a[:,x])[0];z=np.where(b[:,x])[0]
            if len(y) and len(z):dif.append(abs(int(y[0])-int(z[0])))
    return max(dif)

def add_cat(z,cat,mobile=False):
    folder=OUT/cat
    for p in sorted(folder.rglob('*')):
        if p.is_file() and (not mobile or 'mobile' in p.relative_to(folder).parts):
            z.write(p,str(p.relative_to(OUT)).replace('\\','/'))
    if mobile:
        z.write(HERE/cat/'animations-mobile.json',f'{cat}/animations-mobile.json')
    for state in ['idle','sleep_loop']:
        z.write(HERE/cat/f'{state}-preview.webp',f'{cat}/previews/{state}.webp')
    z.write(HERE/cat/'validation.json',f'{cat}/validation.json')

report={'cats':[], 'protectedSourcesUnchanged':False}
for cat in build.CONFIG:
    folder=OUT/cat
    manifest=json.loads((folder/'animations.json').read_text(encoding='utf-8'))
    mobile=copy.deepcopy(manifest)
    mobile.update(canvas=[288,288],feetAnchor=[144,1200*288/1254],sourceCanvas=[1254,1254],sourceFeetAnchor=[627,1200])
    qa={'cat':cat,'animations':{}}
    for state,n,cycle in [('idle',63,9260),('sleep_loop',32,4800)]:
        seq=manifest['animations'][state]
        assert seq['frameCount']==n==len(seq['frames'])
        assert sum(f['durationMs'] for f in seq['frames'])==cycle
        for f in seq['frames']:
            assert (folder/f['file']).is_file() and (folder/f['mobileFile']).is_file()
        if state=='idle':
            blink=[(f['timeMs'],f['eyes'],f['durationMs']) for f in seq['frames'] if f['eyes']!='open']
            assert blink==[(6600,'half',80),(6680,'closed',100),(6780,'half',80)]
        first=Image.open(folder/seq['frames'][0]['file']).convert('RGBA')
        last=Image.open(folder/seq['frames'][-1]['file']).convert('RGBA')
        seam=contour_delta(first,last,state)
        assert seam<=1,(cat,state,seam)
        qa['animations'][state]={'frameCount':n,'cycleDurationMs':cycle,'loopSeamContourMaxNativePx':seam}
        for f in mobile['animations'][state]['frames']:
            f['file']=f.pop('mobileFile')
    (HERE/cat/'animations-mobile.json').write_text(json.dumps(mobile,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report['cats'].append(qa)

snapshot=HERE/'sleep-amplitude-32/protected-source-hashes.json'
if not snapshot.exists():snapshot=HERE/'protected-source-hashes.json'
before=json.loads(snapshot.read_text(encoding='utf-8'))
assert before==build.protected_snapshot()
report['protectedSourcesUnchanged']=True
(HERE/'delivery-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

def archive(name,cats,mobile=False):
    target=PACK/name
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_STORED) as z:
        for cat in cats:add_cat(z,cat,mobile)
        z.write(HERE/'README.md','README.md')
        z.write(HERE/'delivery-validation.json','delivery-validation.json')
        revision=HERE/'sleep-amplitude-32/revision-validation.json'
        if revision.exists():z.write(revision,'sleep-revision-validation.json')
        if not mobile:z.write(OUT/'index.json','index.json')
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
    return {'file':name,'bytes':target.stat().st_size}

packages=[]
for cat in build.CONFIG:
    packages.append(archive(f'{cat}-animation-v2.zip',[cat]))
packages.append(archive('three-cats-animation-v2-full.zip',list(build.CONFIG)))
packages.append(archive('three-cats-animation-v2-mobile.zip',list(build.CONFIG),True))
(PACK/'index.json').write_text(json.dumps(packages,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checks':report,'packages':packages},ensure_ascii=False),flush=True)
