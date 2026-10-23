"""Validate delivered V2 art and export deduplicated mobile resources; never regenerate art."""
from pathlib import Path
import json, hashlib
from PIL import Image, ImageChops, ImageStat
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'art/cat-expansion-v2/resources'
OUT=ROOT/'public/cat-expansion-v2'
names={'cat-04':'吉吉','cat-05':'珍珠','cat-06':'铃铛'}
cats=[]; rows=[]; source_bytes=0; mobile_bytes=0; unique_bytes=0
for cid,name in names.items():
    manifest=json.loads((SOURCE/cid/'animations.json').read_text(encoding='utf-8'))
    assert manifest['id']==cid and manifest['version']=='cat-expansion-v2'
    assert manifest['canvas']==[1254,1254] and manifest['mobileCanvas']==[288,288]
    assert manifest['feetAnchor']==[627,1200]
    assert set(manifest['actions'])=={'idle','sleep','eat','drink','scratch','pet'}
    actions={}; hashes={}; (OUT/cid/'mobile').mkdir(parents=True,exist_ok=True)
    for action,clip in manifest['actions'].items():
        assert action in ('idle','sleep','eat','drink','scratch','pet')
        assert len(clip['frames'])==clip['frameCount'] and sum(f['durationMs'] for f in clip['frames'])==clip['cycleDurationMs']
        assert clip['loop']==(action!='pet')
        frames=[]
        for frame in clip['frames']:
            assert frame['durationMs']>0
            for field,size in [('file',(1254,1254)),('mobileFile',(288,288))]:
                path=SOURCE/cid/frame[field]
                with Image.open(path) as im:
                    im.load(); assert im.size==size and im.mode=='RGBA' and im.getchannel('A').getextrema()==(0,255)
                if field=='file': source_bytes+=path.stat().st_size
            path=SOURCE/cid/frame['mobileFile']; data=path.read_bytes(); mobile_bytes+=len(data); key=hashlib.sha256(data).hexdigest()
            if key not in hashes:
                (OUT/cid/'mobile'/f'{key}.webp').write_bytes(data); hashes[key]=True; unique_bytes+=len(data)
            frames.append({'file':f'./cat-expansion-v2/{cid}/mobile/{key}.webp','durationMs':frame['durationMs']})
        if action=='pet':
            for endpoint in (0,-1):
                with Image.open(SOURCE/cid/clip['frames'][endpoint]['mobileFile']) as a,Image.open(SOURCE/cid/manifest['actions']['idle']['frames'][0]['mobileFile']) as b: assert a.tobytes()==b.tobytes()
        contacts=clip.get('contactPointsByFrame')
        if contacts is not None:
            assert len(contacts)==len(frames)
            for pair in contacts:
                assert len(pair)==2 and all(len(point)==2 and all(0<=value<=1254 for value in point) for point in pair)
        actions[action]={**clip,'frames':frames}
        with Image.open(SOURCE/cid/clip['frames'][0]['mobileFile']) as a, Image.open(SOURCE/cid/clip['frames'][-1]['mobileFile']) as b:
            seam=sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/4
        rows.append({'seamMeanChannelDifference':round(seam,4),'catId':cid,'action':action,'frames':len(frames),'durationMs':clip['cycleDurationMs'],'loop':clip['loop']})
    item={'id':cid,'name':name,'sourceCanvas':manifest['canvas'],'feetAnchor':manifest['feetAnchor'],'actions':actions}
    (OUT/cid/'animations.json').write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); cats.append(item)
assert len(rows)==18 and sum(r['frames'] for r in rows)==537
(ROOT/'art/cat-expansion-v2/runtime.json').write_text(json.dumps({'cats':cats},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
report={'segments':len(rows),'frames':sum(r['frames'] for r in rows),'originalBytes':source_bytes,'mobileBeforeBytes':mobile_bytes,'mobileUniqueBytes':unique_bytes,'rows':rows}
dest=ROOT/'art/six-cats-integration';dest.mkdir(exist_ok=True)
(dest/'resource-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
