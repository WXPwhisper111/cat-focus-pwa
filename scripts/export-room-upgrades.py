"""Import approved delivery once, then rebuild runtime assets from archived WebP masters."""
import argparse, hashlib, json, shutil
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
archive = root / 'art/room-upgrades-v1'
runtime = root / 'public/room-upgrades-v1'
args = argparse.ArgumentParser()
args.add_argument('--delivery', type=Path)
source = args.parse_args().delivery
packages = ['furniture-advanced-v1', 'room-plant-replacement-v1', 'window-curtains-breeze-v1']
if source:
    for package in packages:
        dest = archive / 'sources' / package
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / package / 'manifest.json', dest / 'manifest.json')
        manifest = json.loads((dest / 'manifest.json').read_text(encoding='utf-8'))
        files = ([item['file'].replace('.png', '.webp') for item in manifest['items']] if package.startswith('furniture') else
                 [manifest['webp']] if package.startswith('room-plant') else
                 [frame['mobileFile'] for frame in manifest['frames']] + [manifest['fallback']])
        for file in files:
            original = source / package / file
            with Image.open(original) as im:
                im.load()
                assert im.mode == 'RGBA' and im.getextrema()[3][0] == 0, file
                png = original.with_suffix('.png')
                if package.startswith('window') and file.startswith('webp/'):
                    png = source / package / 'png' / Path(file).with_suffix('.png').name
                if png.exists():
                    with Image.open(png) as master:
                        assert master.convert('RGBA').tobytes() == im.tobytes(), file
            target = dest / file
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
runtime.mkdir(parents=True, exist_ok=True)
data = {'version': 'room-upgrades-v1', 'furniture': {}, 'curtains': {}, 'plant': {}}
audit = []
def export(package, file, target, half=False):
    original = archive / 'sources' / package / file
    with Image.open(original) as im:
        im.load()
        source_size = im.size
        if half:
            im = im.resize((im.width // 2, im.height // 2), Image.Resampling.NEAREST)
        path = runtime / target
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, format='WEBP', lossless=True, exact=True, method=6)
        with Image.open(path) as decoded:
            assert decoded.convert('RGBA').tobytes() == im.convert('RGBA').tobytes()
        audit.append({'source': str(original.relative_to(root)).replace('\\', '/'), 'runtime': './room-upgrades-v1/' + target, 'sourceSize': source_size, 'size': im.size, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return './room-upgrades-v1/' + target
for package in packages:
    manifest = json.loads((archive / 'sources' / package / 'manifest.json').read_text(encoding='utf-8'))
    if package.startswith('furniture'):
        for item in manifest['items']:
            data['furniture'][item['id']] = {'file': export(package, item['file'].replace('.png', '.webp'), item['file'].replace('.png', '.webp')), 'rect': item['roomRect']}
        data['sleepOffsetRoom'] = manifest['sleepOffsetRoom']
    elif package.startswith('room-plant'):
        data['plant'] = {'file': export(package, manifest['webp'], 'plant.webp'), 'rect': manifest['roomRect'], 'potBaseAnchor': manifest['potBaseAnchor']}
    else:
        frames = []
        for frame in manifest['frames']:
            with Image.open(archive / 'sources' / package / frame['mobileFile']) as im:
                digest = hashlib.sha256(im.resize((576,416),Image.Resampling.NEAREST).tobytes()).hexdigest()
            frames.append({'file': export(package, frame['mobileFile'], 'curtains/' + digest + '.webp', True), 'durationMs': frame['durationMs']})
        assert len(frames) == manifest['frameCount'] == 48
        assert sum(f['durationMs'] for f in frames) == manifest['cycleDurationMs'] == 6000
        data['curtains'] = {'rect': manifest['roomRect'], 'canvas': [576,416], 'frames': frames, 'fallback': export(package, manifest['fallback'], 'curtains-static.webp', True)}
(runtime / 'manifest.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(archive / 'runtime.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(archive / 'asset-audit.json').write_text(json.dumps({'assets': audit, 'runtimeBytes': sum(p.stat().st_size for p in runtime.rglob('*') if p.is_file())}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Exported', len(audit), 'time positions/assets;', len(list(runtime.rglob('*.webp'))), 'unique runtime WebPs')
