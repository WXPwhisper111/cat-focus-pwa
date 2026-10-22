"""Assemble generated eye key poses and tiny deterministic game breathing phases.

No per-frame generative repainting: eyes are localized from ImageGen key poses;
breathing samples the approved art at integer coordinates, without smoothing.
"""
from pathlib import Path
import json
import shutil
import zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEST = ROOT / 'public/cat_03'
KEYS = HERE / 'keyposes'
KEYS.mkdir(parents=True, exist_ok=True)
GEN = Path(r'C:/Users/28262/.codex/generated_images/01a15783-9213-7bc1-88dd-bcb81cdfc954')
SOURCES = {
    'half': 'exec-7a5afb6e-33ec-4912-aef5-6a784deecc30.png',
    'closed': 'exec-73d509b4-df58-4b44-88ff-470ef12d60c4.png',
    'sleep': 'exec-aaf7594a-ab88-4242-b3c6-e420411fb04c.png',
}
SIZE = 1254
ANCHOR = [627, 1200]
for name, filename in SOURCES.items():
    if not (KEYS / f'{name}.png').exists():
        shutil.copyfile(GEN / filename, KEYS / f'{name}.png')

def read(path):
    image = Image.open(path).convert('RGBA')
    if image.size != (SIZE, SIZE):
        image = image.resize((SIZE, SIZE), Image.Resampling.NEAREST)
    return image

original = read(DEST / 'cat_03_prototype.png')
eye_mask = Image.new('L', original.size)
draw = ImageDraw.Draw(eye_mask)
draw.polygon([(719,480),(743,459),(788,455),(820,471),(837,505),(833,533),(798,550),(755,548),(727,530)], fill=255)
draw.polygon([(894,444),(920,426),(958,422),(983,440),(995,471),(988,500),(956,512),(916,506),(899,487)], fill=255)
poses = {'open': original}
for eye in ['half', 'closed']:
    result = original.copy()
    result.paste(read(KEYS / f'{eye}.png'), (0, 0), eye_mask)
    poses[eye] = result

def contact(image):
    # Front paws only, avoiding curled tail and rear foot.
    alpha = image.getchannel('A').crop((780, 850, 1140, SIZE))
    box = alpha.point(lambda v: 255 if v >= 16 else 0).getbbox()
    return 850 + box[3] - 1

def align(image, offset):
    result = Image.new('RGBA', image.size, (0, 0, 0, 0))
    result.paste(image, (0, offset))
    return result

idle_offset = ANCHOR[1] - contact(original)
sleep_raw = read(KEYS / 'sleep.png')
# Preserve petite physical size without changing approved idle art.
# Uniform nearest-neighbor fitting only, no shape stretching or repainting.
sleep_scale = 0.84
sleep_small = sleep_raw.resize((round(SIZE*sleep_scale), round(SIZE*sleep_scale)), Image.Resampling.NEAREST)
sleep_source = Image.new('RGBA', (SIZE,SIZE), (0,0,0,0))
sleep_pad = (SIZE-sleep_small.width)//2
sleep_source.paste(sleep_small, (sleep_pad,sleep_pad))
sleep_offset = ANCHOR[1] - contact(sleep_source)
poses = {name: align(image, idle_offset) for name, image in poses.items()}
sleep_base = align(sleep_source, sleep_offset)

# A local integer-coordinate mesh is a game animation transform. Facial features,
# feet and tail stay outside the supported region; no whole-sprite scaling.
yy, xx = np.mgrid[0:SIZE, 0:SIZE]
def bell(value, center, radius):
    t = np.clip(1 - ((value - center) / radius) ** 2, 0, 1)
    return t * t

idle_weight = bell(xx, 800, 260) * bell(yy, 890 + idle_offset, 210)
sleep_weight = bell(xx, 440, 200) * bell(yy, 620*sleep_scale + sleep_pad + sleep_offset, 110)

def breathe(image, amplitude, weight):
    if not amplitude:
        return image.copy()
    displacement = np.rint(amplitude * weight).astype(np.int32)
    sample_y = np.clip(yy + displacement, 0, SIZE - 1)
    return Image.fromarray(np.asarray(image)[sample_y, xx], 'RGBA')

idle_specs = [
    ('open',0,1200), ('open',2,1200), ('open',4,1200),
    ('open',2,1200), ('open',0,1800), ('half',0,80),
    ('closed',0,100), ('half',0,80), ('open',1,1200), ('open',0,1200),
]
sleep_specs = [('closed', value, 600) for value in [0,1,3,5,6,5,3,1]]
manifest = {
    'id': 'cat-03', 'approvedPrototype': 'cat_03_prototype.png',
    'canvas': [SIZE,SIZE], 'feetAnchor': ANCHOR,
    'timingMode': 'per-frame-duration-ms',
    'note': 'Do not play idle at a uniform fps. No app integration in this delivery.',
    'animations': {},
}
all_frames = {}
qa = []
for state, specs in [('idle', idle_specs), ('sleep_loop', sleep_specs)]:
    folder = DEST / state
    folder.mkdir(parents=True, exist_ok=True)
    rows, images, durations = [], [], []
    for index, (eye, amplitude, duration) in enumerate(specs, 1):
        base = poses[eye] if state == 'idle' else sleep_base
        image = breathe(base, amplitude, idle_weight if state == 'idle' else sleep_weight)
        name = f'{state}_{index:02}.png'
        image.save(folder / name)
        rows.append({'file': f'{state}/{name}', 'durationMs': duration,
                     'eyes': eye, 'maxBreathOffsetSourcePx': amplitude})
        images.append(image); durations.append(duration)
        a = image.getchannel('A')
        bbox = a.point(lambda v: 255 if v >= 16 else 0).getbbox()
        assert a.getextrema() == (0,255)
        assert all([bbox[0]>0, bbox[1]>0, bbox[2]<SIZE, bbox[3]<SIZE])
        assert contact(image) == ANCHOR[1], (state, index, contact(image))
        # Features outside the support must never jitter.
        arr, srcarr = np.asarray(image), np.asarray(base)
        weight = idle_weight if state == 'idle' else sleep_weight
        assert np.array_equal(arr[weight == 0], srcarr[weight == 0])
        qa.append({'file': rows[-1]['file'], 'alphaBounds': bbox,
                   'feetY': contact(image), 'size': image.size})
    manifest['animations'][state] = {
        'loop': True, 'cycleDurationMs': sum(durations), 'frameCount': len(rows),
        'blinkCountPerCycle': 1 if state == 'idle' else 0, 'frames': rows,
    }
    all_frames[state] = images
    # APNG previews preserve real alpha and variable frame timing.
    preview_frames = [im.resize((384,384), Image.Resampling.NEAREST) for im in images]
    preview_frames[0].save(HERE / f'{state}-preview.png', save_all=True,
        append_images=preview_frames[1:], duration=durations, loop=0,
        disposal=0, blend=0, optimize=False)
    with Image.open(HERE / f'{state}-preview.png') as check:
        assert check.n_frames == len(specs), (state, check.n_frames)
    sheet = Image.new('RGB', (5*260, (2 if state=='idle' else 2)*280), '#f6ecdc')
    sd = ImageDraw.Draw(sheet)
    for i,(im,row) in enumerate(zip(images,rows)):
        thumb = im.resize((248,248), Image.Resampling.NEAREST)
        x,y=(i%5)*260,(i//5)*280
        sheet.paste(thumb,(x+6,y+20),thumb)
        sd.text((x+8,y+3),f'{i+1:02}  {row["durationMs"]}ms  {row["eyes"]}',fill='#49372f')
    sheet.save(HERE / f'{state}-contact-sheet.png')

(DEST / 'animations.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
(HERE / 'validation.json').write_text(json.dumps({
    'frameCount':len(qa), 'frames':qa,
    'idleBlinkIntervalMs':sum(x[2] for x in idle_specs),
    'sleepCycleMs':4800, 'maxSleepDisplacementSourcePx':6,
    'maxSleepDisplacementAt144px':round(6*144/1254,3),
    'idleInputYOffset':idle_offset, 'sleepInputYOffset':sleep_offset,
    'fixedFeetAndOutsideMotionSupport':True, 'sleepUniformFitScale':sleep_scale,
},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'idleFrames':10,'sleepFrames':8,'idleCycleMs':9260,
                  'sleepCycleMs':4800,'anchor':ANCHOR,
                  'idleOffset':idle_offset,'sleepOffset':sleep_offset}))
