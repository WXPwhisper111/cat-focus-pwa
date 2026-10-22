"""Rebuild mobile sprites without changing the original art. Requires Pillow."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'art/room-v0.1/scene-calibration'
DEST = ROOT / 'public/cat-mobile'
# Inspected front-paw contact (exclusive lower edge), not the lower curled tail.
CONTACTS = {'idle': [1242, 1245, 1246, 1244, 1245, 1245],
            'sleep_loop': [955, 1030, 1013, 996]}
manifest = {'size': 288, 'sourceSize': 1254, 'spriteSize': 144,
            'anchorNote': 'Front-paw bottom + the idle_01 original 12px bottom margin; x remains canvas center. No per-frame crop or stretch.',
            'states': {}}
source_bytes = derived_bytes = 0
sheet = Image.new('RGB', (5 * 310, 2 * 330), '#fff7e8')
draw = ImageDraw.Draw(sheet)
index = 0
for state, contacts in CONTACTS.items():
    frames = []
    (DEST / state).mkdir(parents=True, exist_ok=True)
    for number, contact in enumerate(contacts, 1):
        name = f'{state}_{number:02}'
        original = ROOT / f'public/cat/{state}/{name}.png'
        image = Image.open(original).convert('RGBA')
        assert image.size == (1254, 1254)
        bounds = image.getchannel('A').point(lambda value: 255 if value >= 16 else 0).getbbox()
        # Contact region excludes the curled tail on the left.
        assert image.getchannel('A').crop((700, 0, 1200, 1254)).point(lambda value: 255 if value >= 16 else 0).getbbox()[3] == contact
        mobile = image.resize((288, 288), Image.Resampling.NEAREST)
        destination = DEST / state / f'{name}.webp'
        mobile.save(destination, 'WEBP', lossless=True, method=6, exact=True)
        source_bytes += original.stat().st_size
        derived_bytes += destination.stat().st_size
        frames.append({'file': f'./cat-mobile/{state}/{name}.webp', 'source': f'public/cat/{state}/{name}.png',
                       'alphaBounds': list(bounds), 'pawBottom': contact, 'sourceAnchor': [627, contact + 12],
                       'offset': [0, (1242 - contact) * 144 / 1254]})
        # All poses share the same paw contact line; include tail below that line.
        x, y = index % 5 * 310, index // 5 * 330
        display = mobile.resize((240, 240), Image.Resampling.NEAREST)
        top = round(y + 285 - (contact + 12) * 240 / 1254)
        sheet.paste(display, (x + 35, top), display)
        draw.line((x + 12, y + 285 - 12 * 240 / 1254, x + 298, y + 285 - 12 * 240 / 1254), fill='#d5906c')
        draw.text((x + 12, y + 8), name, fill='#49372f')
        draw.text((x + 12, y + 305), f'contact={contact}', fill='#49372f')
        index += 1
    manifest['states'][state] = {'fps': 4 if state == 'idle' else 2, 'frames': frames}
manifest['bytes'] = {'source': source_bytes, 'derived': derived_bytes}
(ART / 'cat-frames.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
sheet.save(ART / 'cat-calibrated-contact-sheet.png')
print(json.dumps(manifest['bytes']))
