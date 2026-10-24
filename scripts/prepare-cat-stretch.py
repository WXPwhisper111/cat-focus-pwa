"""Validate the delivered stretch resources and export only deduplicated mobile frames."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import hashlib,json
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'art/cat-stretch-v1/resources'
OUT=ROOT/'public/cat-stretch-v1'
clips=[];rows=[];before=after=0
for folder in sorted(SOURCE.iterdir()):
    if not folder.is_dir():continue
    data=json.loads((folder/'animations.json').read_text(encoding='utf-8'))
    action=data['actions']['stretch'];assert action['frameCount']==18 and not action['loop']
    assert sum(f['durationMs'] for f in action['frames'])==action['cycleDurationMs']==3600
    files=[];seen=set()
    for frame in action['frames']:
        assert frame['durationMs']>0
        for key,size in [('file',(1254,1254)),('mobileFile',(288,288))]:
            with Image.open(folder/frame[key]) as im:
                im.load();assert im.size==size and im.mode=='RGBA' and im.getchannel('A').getextrema()==(0,255)
        path=folder/frame['mobileFile'];raw=path.read_bytes();before+=len(raw)
        digest=hashlib.sha256(raw).hexdigest();dest=OUT/data['catId']/(digest+'.webp');dest.parent.mkdir(parents=True,exist_ok=True)
        if digest not in seen:dest.write_bytes(raw);after+=len(raw);seen.add(digest)
        files.append({'file':'./'+dest.relative_to(ROOT/'public').as_posix(),'durationMs':frame['durationMs']})
    with Image.open(folder/action['frames'][0]['mobileFile']) as a,Image.open(folder/action['frames'][-1]['mobileFile']) as b:
        assert a.tobytes()==b.tobytes()
    assert data['previewDisplayScale']>0 and len(data['previewAnchor'])==2
    with Image.open(folder/'preview-idle/001.webp') as idle,Image.open(folder/action['frames'][0]['mobileFile']) as first:
        assert idle.tobytes()==first.tobytes()
    cid='orange-white' if data['catId']=='cat-01' else data['catId']
    clip={'id':'stretch:once','catId':cid,'loop':False,'sourceCanvas':data['sourceCanvas'],'feetAnchor':data['feetAnchor'],'frames':files,'display':{'scale':data['previewDisplayScale'],'anchor':data['previewAnchor']}}
    clips.append(clip);rows.append({'catId':cid,'frames':len(files),'durationMs':3600,'uniqueFrames':len(seen),'display':clip['display']})
assert len(clips)==6
OUT.mkdir(exist_ok=True);(OUT/'animations.json').write_text(json.dumps({'clips':clips},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'art/cat-stretch-v1/runtime.json').write_text(json.dumps({'clips':clips},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
report=ROOT/'art/cat-life-v1';report.mkdir(exist_ok=True)
(report/'resource-audit.json').write_text(json.dumps({'segments':6,'frames':108,'mobileBeforeBytes':before,'mobileUniqueBytes':after,'rows':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Validated 6 clips, 108 frame positions;',before,'->',after,'mobile bytes')
