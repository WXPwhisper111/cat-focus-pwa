"""Create mobile derivatives from current cat_01/cat_02/cat_03 art; never edit originals."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
output = {}
for folder in ['cat_01', 'cat_02', 'cat_03']:
    source = ROOT / 'public' / folder
    manifest = json.loads((source / 'animations.json').read_text(encoding='utf-8'))
    animations = {}
    before = after = 0
    for state, animation in manifest['animations'].items():
        frames = []
        for entry in animation['frames']:
            image = Image.open(source / entry['file']).convert('RGBA')
            assert image.size == tuple(manifest['canvas'])
            assert image.getchannel('A').getextrema() == (0, 255)
            mobile = image.resize((288, 288), Image.Resampling.NEAREST)
            destination = ROOT / 'public/cat-mobile' / folder / entry['file'].replace('.png', '.webp')
            destination.parent.mkdir(parents=True, exist_ok=True)
            mobile.save(destination, 'WEBP', lossless=True, method=6, exact=True)
            assert Image.open(destination).convert('RGBA').tobytes() == mobile.tobytes()
            before += (source / entry['file']).stat().st_size
            after += destination.stat().st_size
            # Same calibrated source anchor for every pose; preserve the smaller cat's scale.
            anchor = manifest['feetAnchor']
            frames.append({'file': './' + str(destination.relative_to(ROOT / 'public')).replace('\\', '/'),
                           'durationMs': entry['durationMs'], 'sourceAnchor': anchor,
                           'offset': [(627 - anchor[0]) * 144 / 1254, (1254 - anchor[1]) * 144 / 1254]})
        animations[state] = {'fps': len(frames) * 1000 / sum(frame['durationMs'] for frame in frames), 'frames': frames}
    output[manifest['id']] = {'sourceCanvas': manifest['canvas'], 'feetAnchor': manifest['feetAnchor'],
                              'animations': animations, 'bytes': {'source': before, 'mobile': after}}
art = ROOT / 'art/room-v0.1/stage-b'
art.mkdir(parents=True, exist_ok=True)
(art / 'mobile-cats.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value['bytes'] for key, value in output.items()}))
