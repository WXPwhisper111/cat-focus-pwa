"""Validate and package the three independent animation deliverables."""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
import copy, json
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PUBLIC=ROOT/'public/cat-interactions-v1'
PACKS=HERE/'packages'
CATS=('cat-01','cat-02','cat-03')
SIZE=(1254,1254)
MOBILE=(288,288)

def inspect(cat):
    root=PUBLIC/cat
    manifest=json.loads((root/'animations.json').read_text(encoding='utf-8'))
    assert tuple(manifest['canvas'])==SIZE and manifest['feetAnchor']==[627,1200]
    assert tuple(manifest['mobileCanvas'])==MOBILE
    assert set(manifest['actions'])=={'eat','drink','scratch','pet'}
    assert set(manifest['actions']['pet'])=={'once'}
    assert all(set(manifest['actions'][action])=={'enter','loop','exit'} for action in ('eat','drink','scratch'))
    assert sum(len(parts) for parts in manifest['actions'].values())==10
    count=0
    for action,segments in manifest['actions'].items():
        for name,clip in segments.items():
            assert clip['loop']==(name=='loop')
            assert clip['frameCount']==len(clip['frames'])
            assert clip['cycleDurationMs']==sum(f['durationMs'] for f in clip['frames'])
            assert clip['feetAnchor']==[627,1200]
            if action=='pet':assert clip['cycleDurationMs']==2400
            if name=='loop':assert clip['contact']['targetItem'] in ('foodBowl','waterBowl','scratcher')
            assert (HERE/'previews'/cat/f'{action}-{name}.webp').is_file()
            for frame in clip['frames']:
                original=root/frame['file'];mobile=root/frame['mobileFile']
                assert original.is_file() and mobile.is_file(),(cat,action,name,frame)
                with Image.open(original) as image:
                    assert image.size==SIZE and image.mode=='RGBA'
                    extrema=image.getchannel('A').getextrema()
                    assert extrema[0]==0 and extrema[1]==255
                with Image.open(mobile) as image:
                    assert image.size==MOBILE and image.mode=='RGBA'
                    assert image.getchannel('A').getextrema()[0]==0
                count+=1
    assert count==116,(cat,count)
    return manifest

def add_file(z,path,name):
    z.write(path,name.replace('\\','/'))

def full_pack(name,cats):
    with ZipFile(PACKS/name,'w',compression=ZIP_STORED,allowZip64=True) as z:
        for cat in cats:
            for p in sorted((PUBLIC/cat).rglob('*')):
                if p.is_file():add_file(z,p,f'public/cat-interactions-v1/{cat}/{p.relative_to(PUBLIC/cat).as_posix()}')
            for p in sorted((HERE/'previews'/cat).glob('*.webp')):
                add_file(z,p,f'art/cat-interactions-v1/previews/{cat}/{p.name}')
            add_file(z,HERE/'validation'/f'{cat}.json',f'art/cat-interactions-v1/validation/{cat}.json')
        add_file(z,HERE/'README.md','art/cat-interactions-v1/README.md')
        if len(cats)==3:
            add_file(z,HERE/'preview.html','art/cat-interactions-v1/preview.html')
            add_file(z,PUBLIC/'index.json','public/cat-interactions-v1/index.json')
            add_file(z,ROOT/'src/style.css','src/style.css')
            layout=ROOT/'art/room-v0.1/scene-calibration/layout.json'
            add_file(z,layout,'art/room-v0.1/scene-calibration/layout.json')
            data=json.loads(layout.read_text(encoding='utf-8'))
            for layer in data['layers']:
                if layer.get('file') and layer['id']!='cat':
                    p=ROOT/'public/room'/layer['file']
                    add_file(z,p,f'public/room/{p.name}')
            for name in ('motion-check.json','mobile-review/results.json'):
                p=HERE/'validation'/name
                if p.is_file():add_file(z,p,f'art/cat-interactions-v1/validation/{name}')

def mobile_pack(manifests):
    with ZipFile(PACKS/'cat-interactions-v1-mobile-3cats.zip','w',compression=ZIP_STORED,allowZip64=True) as z:
        for cat in CATS:
            mobile=copy.deepcopy(manifests[cat])
            mobile['canvas']=list(MOBILE)
            mobile['feetAnchor']=mobile['mobileFeetAnchor']
            for segments in mobile['actions'].values():
                for clip in segments.values():
                    clip['feetAnchor']=mobile['feetAnchor']
                    if 'contact' in clip:
                        clip['contact']['spritePoint']=[round(v*288/1254,3) for v in clip['contact']['spritePoint']]
                        clip['contact']['coordinateCanvas']=list(MOBILE)
                    for frame in clip['frames']:
                        frame['file']=frame.pop('mobileFile')
            z.writestr(f'{cat}/animations-mobile.json',json.dumps(mobile,ensure_ascii=False,indent=2)+'\n')
            for p in sorted((PUBLIC/cat/'mobile').rglob('*.webp')):
                add_file(z,p,f'{cat}/{p.relative_to(PUBLIC/cat).as_posix()}')
        add_file(z,HERE/'README.md','README.md')

if __name__=='__main__':
    PACKS.mkdir(exist_ok=True)
    manifests={cat:inspect(cat) for cat in CATS}
    for cat in CATS:full_pack(f'cat-interactions-v1-{cat}.zip',[cat])
    full_pack('cat-interactions-v1-all.zip',CATS)
    mobile_pack(manifests)
    print(json.dumps({'clips':30,'frames':sum(sum(len(clip['frames']) for segments in m['actions'].values() for clip in segments.values()) for m in manifests.values()),
                      'packages':{p.name:p.stat().st_size for p in sorted(PACKS.glob('*.zip'))}},indent=2))
