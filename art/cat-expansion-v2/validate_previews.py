"""Catch lost motion after resizing, and verify encoded playback duration/loop flags."""
from pathlib import Path
from PIL import Image
import json
ROOT=Path(__file__).resolve().parent
checks=[]
for cat in ['cat-04','cat-05','cat-06']:
 meta=json.loads((ROOT/'resources'/cat/'animations.json').read_text(encoding='utf-8'))
 for action,clip in meta['actions'].items():
  for folder,suffix in [('previews',''),('card-previews',''),('room-previews','-390'),('room-previews','-430')]:
   path=ROOT/folder/cat/(action+suffix+'.webp');im=Image.open(path);duration=0
   assert im.n_frames>1,(path,'motion disappeared at display size')
   for i in range(im.n_frames):im.seek(i);im.load();duration+=im.info.get('duration',0)
   assert duration==clip['cycleDurationMs'],(path,duration)
   assert im.info['loop']==(0 if clip['loop'] else 1),(path,'loop flag')
   checks.append({'file':path.relative_to(ROOT).as_posix(),'durationMs':duration,'loop':im.info['loop'],'decodedFrames':im.n_frames})
im=Image.open(ROOT/'motion-reel.webp');duration=0
for i in range(im.n_frames):im.seek(i);im.load();duration+=im.info.get('duration',0)
assert duration==20760,duration
(ROOT/'validation/animation-containers.json').write_text(json.dumps({'checks':checks,'reelDurationMs':duration,'status':'passed'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('PASS: 72 encoded previews retain motion, exact duration and loop flags; reel 20.76 seconds')
