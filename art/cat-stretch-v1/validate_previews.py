from build import *
from PIL import ImageSequence
data=json.loads((HERE/'manifest.json').read_text('utf-8'));result=[]
for cat in data['cats']:
    for name,ms,size in [('stretch',3600,(288,288)),('card',3600,(176,176)),('room-390',3600,(390,292)),('room-430',3600,(430,322)),('alternation-two-rounds',44240,(176,176))]:
        path=HERE/'previews'/cat['id']/(name+'.webp');im=Image.open(path);frames=[];total=0
        assert im.size==size,(path,im.size)
        for frame in ImageSequence.Iterator(im):
            frame.load();total+=frame.info.get('duration',0);frames.append(hashlib.sha256(frame.tobytes()).hexdigest())
        assert total==ms,(path,total,ms)
        assert len(set(frames))>10,(path,'nearly static')
        assert im.info.get('loop')==1,(path,'single shot')
        result.append(dict(file=path.relative_to(HERE).as_posix(),durationMs=total,decodedFrames=len(frames)))
im=Image.open(HERE/'motion-reel.webp');total=0
for f in ImageSequence.Iterator(im):f.load();total+=f.info.get('duration',0)
assert total==3600
save_json(HERE/'validation'/'movies.json',dict(movies=result,reelDurationMs=total))
print('Decoded',len(result),'movies; timings / dimensions / visible motion / single-shot flags passed')
