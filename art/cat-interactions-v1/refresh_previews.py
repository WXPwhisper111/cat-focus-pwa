"""Refresh animated clip previews from the current lossless mobile frames."""
from pathlib import Path
import json
from PIL import Image

HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parents[1]/'public/cat-interactions-v1'
for cat in ('cat-01','cat-02','cat-03'):
    manifest=json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'))
    folder=HERE/'previews'/cat
    folder.mkdir(parents=True,exist_ok=True)
    for action,segments in manifest['actions'].items():
        for name,clip in segments.items():
            frames=[Image.open(PUBLIC/cat/f['mobileFile']).convert('RGBA') for f in clip['frames']]
            frames[0].save(folder/f'{action}-{name}.webp','WEBP',save_all=True,
                append_images=frames[1:],duration=[f['durationMs'] for f in clip['frames']],
                loop=0 if clip['loop'] else 1,lossless=True,quality=100,method=4,exact=True)
print('Refreshed 30 animated WebP previews.')
