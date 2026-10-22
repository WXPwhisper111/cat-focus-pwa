"""Rebuild only sleep; preserve and verify all idle frames and timing."""
from pathlib import Path
import hashlib
import json
import shutil
import build

HERE=Path(__file__).resolve().parent
BACK=HERE/'sleep-amplitude-32'
BACK.mkdir(exist_ok=True)

def idle_snapshot():
    files=[]
    timelines={}
    for cat in build.CONFIG:
        folder=build.OUT/cat
        files.extend((folder/'idle').glob('*.png'))
        files.extend((folder/'mobile/idle').glob('*.webp'))
        files.extend((HERE/cat).glob('idle-*'))
        timelines[cat]=json.loads((folder/'animations.json').read_text(encoding='utf-8'))['animations']['idle']
    return {'files':{str(p.relative_to(build.ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()},'timelines':timelines}

if __name__=='__main__':
    before=idle_snapshot()
    protected=build.protected_snapshot()
    (BACK/'protected-source-hashes.json').write_text(json.dumps(protected,indent=2)+'\n')
    (BACK/'idle-before.json').write_text(json.dumps(before,indent=2)+'\n',encoding='utf-8')
    for cat in build.CONFIG:
        backup=BACK/cat
        backup.mkdir(exist_ok=True)
        for name in ['sleep_loop-breath-peak.png','sleep_loop-preview.webp']:
            target=backup/('previous-52px-'+name)
            if not target.exists():shutil.copyfile(HERE/cat/name,target)
        build.build(cat,sleep_only=True)
    assert before==idle_snapshot(),'Idle files or blink timeline changed'
    assert protected==build.protected_snapshot()
    (BACK/'revision-validation.json').write_text(json.dumps({'sleepAmplitudeBeforePx':52,'sleepAmplitudeAfterPx':32,'idleFilesVerified':len(before['files']),'idleByteIdentical':True,'idleTimelineUnchanged':True,'protectedSourcesUnchanged':True},indent=2)+'\n')
    print('Sleep revision complete; idle bytes and timing unchanged.',flush=True)
