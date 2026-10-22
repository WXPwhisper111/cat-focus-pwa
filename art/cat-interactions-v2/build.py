"""Prepare loop-only V2 assets without altering the V1 or application files."""
from pathlib import Path
import json, shutil, hashlib

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
SOURCE=ROOT/'public/cat-interactions-v1'
OUT=ROOT/'public/cat-interactions-v2'
BASE=json.loads((ROOT/'art/cat-animation-v2/runtime-cats.json').read_text(encoding='utf-8'))
CATS=('cat-01','cat-02','cat-03')
RULES={
 'version':'interactions-v2',
 'fadeMs':{'out':220,'in':220},
 'commandMinimumMs':{'eat':12000,'drink':8000,'scratch':10000,'sleep':60000,'pet':2400},
 'autonomous':{'weights':{'idle':45,'sleep':25,'eat':10,'drink':8,'scratch':12},
   'idleDurationMs':[20000,40000],'sleepDurationMs':[60000,90000],
   'postCommandIdleMs':5000,'avoidImmediateRepeat':True},
 'capacity':{'activity':3,'sleep':1,'food':1,'play':1},
 'locations':{'idle':'activity','sleep':'sleep','eat':'food','drink':'food','scratch':'play'},
 'instructionPriority':'latest-command-wins-per-cat; manual-owner-waits; autonomous-owner-yields',
 'timing':'loop cycles finish at first boundary at or after minimum; page-hidden pauses scene time'
}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def build_cat(cat):
    src=SOURCE/cat
    old=json.loads((src/'animations.json').read_text(encoding='utf-8'))
    dest=OUT/cat
    actions={}
    for action in ('eat','drink','scratch','pet'):
        segment='once' if action=='pet' else 'loop'
        clip=old['actions'][action][segment]
        assert clip['loop']==(segment=='loop')
        for frame in clip['frames']:
            for key in ('file','mobileFile'):
                source=src/frame[key]
                target=dest/frame[key]
                target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(source,target)
                assert sha(source)==sha(target)
        actions[action]={segment:clip}
        preview_source=HERE.parent/'cat-interactions-v1/previews'/cat/f'{action}-{segment}.webp'
        preview_target=HERE/'previews'/cat/f'{action}-{segment}.webp'
        preview_target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(preview_source,preview_target)
    manifest={key:old[key] for key in ('id','name','canvas','feetAnchor','mobileCanvas','mobileFeetAnchor','timingMode')}
    manifest.update(version='interactions-v2',applicationCatId='orange-white' if cat=='cat-01' else cat,
                    baseAnimations=BASE[cat]['animations'],actions=actions)
    (dest/'animations.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert len(actions)==4
    return sum(len(segment['frames']) for clips in actions.values() for segment in clips.values())

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    counts={cat:build_cat(cat) for cat in CATS}
    (OUT/'index.json').write_text(json.dumps({'version':'interactions-v2','cats':[
      {'id':cat,'applicationCatId':'orange-white' if cat=='cat-01' else cat,
       'manifest':f'{cat}/animations.json'} for cat in CATS]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'behavior-rules.json').write_text(json.dumps(RULES,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'clips':12,'frames':counts,'totalFrames':sum(counts.values())},indent=2))
