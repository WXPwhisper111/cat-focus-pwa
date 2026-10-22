"""Read source manifests and decode all V2 frames; write an integration audit, never assets."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'public/cat-interactions-v2'
index = json.loads((BASE / 'index.json').read_text(encoding='utf-8'))
rows, errors, sizes = [], [], {'png': 0, 'webp': 0}
for cat in index['cats']:
    path = BASE / cat['manifest']
    manifest = json.loads(path.read_text(encoding='utf-8'))
    assert manifest['applicationCatId'] == cat['applicationCatId']
    assert manifest['version'] == index['version']
    for action, phases in manifest['actions'].items():
        for phase, clip in phases.items():
            row = {'catId': cat['applicationCatId'], 'sourceCatId': cat['id'], 'behavior': action, 'phase': phase,
                   'manifest': str(path.relative_to(ROOT)).replace('\\', '/'), 'frames': len(clip['frames']),
                   'durationMs': [frame['durationMs'] for frame in clip['frames']],
                   'totalMs': sum(frame['durationMs'] for frame in clip['frames']), 'loop': clip['loop'],
                   'sourceCanvas': manifest['canvas'], 'mobileCanvas': manifest['mobileCanvas'],
                   'feetAnchor': clip['feetAnchor'], 'contact': clip.get('contact'), 'files': [], 'errors': []}
            for frame in clip['frames']:
                pair = {}
                for key, kind, dimensions in [('file', 'png', manifest['canvas']), ('mobileFile', 'webp', manifest['mobileCanvas'])]:
                    file = path.parent / frame[key]
                    try:
                        with Image.open(file) as image:
                            image.load()
                            assert list(image.size) == dimensions, 'wrong dimensions'
                            assert image.mode == 'RGBA', 'missing RGBA'
                            assert image.getchannel('A').getextrema() == (0, 255), 'missing transparent/opaque pixels'
                            assert image.n_frames == 1 if hasattr(image, 'n_frames') else True
                        sizes[kind] += file.stat().st_size
                        pair[kind] = str(file.relative_to(ROOT)).replace('\\', '/')
                    except Exception as error:
                        row['errors'].append(f'{file}: {error}')
                row['files'].append(pair)
            if row['frames'] != clip['frameCount'] or row['totalMs'] != clip['cycleDurationMs']:
                row['errors'].append('frame count/duration mismatch')
            contact = clip.get('contact')
            if contact:
                width, height = manifest['canvas']
                x, y, w, h = contact['roomSpriteRect']
                actual = [x + contact['spritePoint'][0] * w / width, y + contact['spritePoint'][1] * h / height]
                if max(abs(a - b) for a, b in zip(actual, contact['targetRoomPoint'])) > .02:
                    row['errors'].append('contact reference does not match room placement')
                if not 0 <= contact['contactFrame'] < row['frames']:
                    row['errors'].append('invalid zero-based contact reference frame')
            errors.extend(row['errors']); rows.append(row)
output = ROOT / 'art/interaction-v0.3/stage-2a'
output.mkdir(parents=True, exist_ok=True)
report = {'version': index['version'], 'clips': len(rows), 'originalFrames': sum(row['frames'] for row in rows),
          'mobileFrames': sum(row['frames'] for row in rows), 'bytes': sizes, 'errors': errors, 'rows': rows}
(output / 'resource-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'rows'}, ensure_ascii=False))
raise SystemExit(bool(errors))
