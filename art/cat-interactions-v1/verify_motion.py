"""Record mobile-frame movement, alpha bounds, anchors, and loop seams."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parents[1]/'public/cat-interactions-v1'
report={}
for cat in ('cat-01','cat-02','cat-03'):
    manifest=json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'))
    report[cat]={}
    for action,segments in manifest['actions'].items():
        report[cat][action]={}
        for segment,clip in segments.items():
            frames=[np.asarray(Image.open(PUBLIC/cat/f['mobileFile']).convert('RGBA')).astype(np.int16) for f in clip['frames']]
            alpha=[f[:,:,3] for f in frames]
            bottom=[int(np.where(a>=128)[0].max()) for a in alpha]
            assert max(bottom)-min(bottom)<=1,(cat,action,segment,bottom)
            assert all(a.min()==0 and a.max()==255 for a in alpha)
            diffs=[int(np.count_nonzero(np.any(frames[i]!=frames[i-1],axis=2))) for i in range(1,len(frames))]
            peak=int(np.count_nonzero(np.any(frames[0]!=frames[len(frames)//2],axis=2)))
            seam=int(np.count_nonzero(np.any(frames[-1]!=frames[0],axis=2))) if clip['loop'] else None
            if clip['loop']:
                assert peak>1500,(cat,action,peak)
                assert seam<max(diffs)*2,(cat,action,'loop seam',seam,max(diffs))
            report[cat][action][segment]={'frames':len(frames),'durationMs':clip['cycleDurationMs'],
                'mobilePeakChangedPixels':peak,'mobileAdjacentChangedPixels':diffs,
                'loopSeamChangedPixels':seam,'opaqueBottomRows':bottom}
(HERE/'validation/motion-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Validated 30 clips; mobile motion and alpha checks saved.')
