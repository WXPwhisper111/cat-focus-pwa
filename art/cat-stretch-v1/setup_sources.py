"""Archive the exact approved idle input and protect existing application files."""
from pathlib import Path
import json, hashlib, shutil
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
NAMES=['喵呜','芒果','橘宝','吉吉','珍珠','简州狸花白']
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run():
    cats=[]
    old=json.loads((ROOT/'art/cat-animation-v2/runtime-cats.json').read_text('utf-8'))
    new=json.loads((ROOT/'art/cat-expansion-v2/runtime.json').read_text('utf-8'))['cats']
    for i,name in enumerate(NAMES,1):
        cid=f'cat-{i:02d}'
        if i<=3:
            source=ROOT/f'public/cat-animation-v2/{cid}/idle/idle_001.png'
            frames=old[cid]['animations']['idle']['frames']
        else:
            source=ROOT/f'art/cat-expansion-v2/resources/{cid}/idle/idle_001.png'
            frames=next(c for c in new if c['id']==cid)['actions']['idle']['frames']
        folder=HERE/'sources'/cid;folder.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,folder/'idle.png')
        idle=[]
        for j,f in enumerate(frames):
            p=ROOT/'public'/f['file'].removeprefix('./')
            dest=HERE/'resources'/cid/'idle'/f'{j+1:03d}.webp'
            dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
            idle.append(dict(file=dest.relative_to(HERE).as_posix(),durationMs=f['durationMs']))
        cats.append(dict(id=cid,name=name,source=source.relative_to(ROOT).as_posix(),sourceSha256=digest(source),idle=idle))
    (HERE/'inputs.json').write_text(json.dumps(dict(cats=cats),ensure_ascii=False,indent=2),'utf-8',newline='\n')
    protected={p.relative_to(ROOT).as_posix():digest(p) for d in ('src','public') for p in (ROOT/d).rglob('*') if p.is_file()}
    (HERE/'protected-hashes.json').write_text(json.dumps(protected,indent=2),'utf-8',newline='\n')
    print('Archived six approved idle poses; protected',len(protected),'application files')
if __name__=='__main__':run()
