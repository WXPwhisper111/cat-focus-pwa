"""Validate and package standalone V2 interaction assets and preview."""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
from PIL import Image
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PUBLIC = ROOT / 'public'
V1 = PUBLIC / 'cat-interactions-v1'
V2 = PUBLIC / 'cat-interactions-v2'
PACKAGES = HERE / 'packages'
CATS = ('cat-01', 'cat-02', 'cat-03')
ACTIONS = ('eat', 'drink', 'scratch', 'pet')
PREVIEW_COMMON = [
    HERE / 'preview.html', HERE / 'preview.js', HERE / 'behavior-rules.json',
    ROOT / 'art/room-v0.1/scene-calibration/layout.json', ROOT / 'src/style.css',
    *sorted((PUBLIC / 'room').glob('*.png')),
]

def sha(file):
    return hashlib.sha256(file.read_bytes()).digest()

def clip_files(cat):
    manifest_path = V2 / cat / 'animations.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert manifest['version'] == 'interactions-v2'
    assert manifest['canvas'] == [1254, 1254]
    assert manifest['feetAnchor'] == [627, 1200]
    assert set(manifest['actions']) == set(ACTIONS)
    original = [manifest_path]
    mobile = [manifest_path]
    for action in ACTIONS:
        segment = 'once' if action == 'pet' else 'loop'
        assert set(manifest['actions'][action]) == {segment}
        clip = manifest['actions'][action][segment]
        assert clip['loop'] == (action != 'pet')
        assert clip['frameCount'] == len(clip['frames'])
        assert sum(frame['durationMs'] for frame in clip['frames']) == clip['cycleDurationMs']
        if action != 'pet':
            contact = clip['contact']
            assert 'roomSpriteRect' in contact and 'targetRoomPoint' in contact
            assert 'spritePoint' in contact and clip['facing']
        for frame in clip['frames']:
            png = V2 / cat / frame['file']
            webp = V2 / cat / frame['mobileFile']
            for source, target in ((V1 / cat / frame['file'], png),
                                   (V1 / cat / frame['mobileFile'], webp)):
                assert target.is_file() and sha(source) == sha(target), target
            with Image.open(png) as im:
                assert im.size == (1254, 1254) and im.mode == 'RGBA'
                assert im.getpixel((0, 0))[3] == 0
                assert im.getchannel('A').getextrema() == (0, 255)
            with Image.open(webp) as im:
                assert im.size == (288, 288) and 'A' in im.getbands()
            original.append(png)
            mobile.append(webp)
        original.append(HERE / 'previews' / cat / f'{action}-{segment}.webp')
    base = []
    for animation in manifest['baseAnimations'].values():
        for frame in animation['frames']:
            base.append(PUBLIC / frame['file'].removeprefix('./'))
    assert all(p.is_file() for p in base)
    return original, mobile, sorted(set(base))

def write_zip(name, files):
    destination = PACKAGES / name
    with ZipFile(destination, 'w', compression=ZIP_STORED, allowZip64=True) as archive:
        for file in sorted(set(files)):
            archive.write(file, file.relative_to(ROOT).as_posix())
    with ZipFile(destination) as archive:
        assert archive.testzip() is None
    return {'file': name, 'bytes': destination.stat().st_size, 'entries': len(set(files))}

if __name__ == '__main__':
    PACKAGES.mkdir(exist_ok=True)
    clips = {cat: clip_files(cat) for cat in CATS}
    metadata = [V2 / 'index.json', HERE / 'README.md', HERE / 'behavior-rules.json']
    packages = []
    for cat in CATS:
        original, mobile, base = clips[cat]
        packages.append(write_zip(f'cat-interactions-v2-{cat}.zip',
                                  metadata[1:] + original + mobile + base))
    packages.append(write_zip('cat-interactions-v2-all.zip',
                              metadata + PREVIEW_COMMON +
                              [file for group in clips.values() for part in group for file in part]))
    packages.append(write_zip('cat-interactions-v2-mobile-3cats.zip',
                              metadata + [file for group in clips.values() for file in group[1] + group[2]]))
    (PACKAGES / 'manifest.json').write_text(json.dumps({
        'version': 'interactions-v2', 'clips': 12, 'originalFrames': 204,
        'mobileFrames': 204, 'packages': packages
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(packages, ensure_ascii=False, indent=2))
