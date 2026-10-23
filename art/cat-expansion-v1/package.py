from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'art' / 'cat-expansion-v1'
PUBLIC = ROOT / 'public' / 'cat-expansion-v1'
OUT = ART / 'packages'
OUT.mkdir(exist_ok=True)

def create(name, cats, mobile_only=False):
    dest = OUT / name
    count = 0
    with ZipFile(dest, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
        for cat in cats:
            folder = PUBLIC / cat
            for path in sorted(folder.rglob('*')):
                if not path.is_file():
                    continue
                relative = path.relative_to(folder)
                if mobile_only and relative.parts[0] != 'mobile' and path.name != 'animations.json':
                    continue
                z.write(path, f'cat-expansion-v1/{cat}/{relative.as_posix()}')
                count += 1
            for path in sorted((ART / 'previews' / cat).glob('*.webp')):
                z.write(path, f'cat-expansion-v1/previews/{cat}/{path.name}')
                count += 1
        for path in [PUBLIC / 'index.json', ART / 'README.md', ART / 'preview.html', ART / 'contact-sheet.png']:
            z.write(path, f'cat-expansion-v1/{path.name}')
            count += 1
    with ZipFile(dest) as z:
        assert z.testzip() is None
    print(name, count, dest.stat().st_size)

cats = ['cat-04', 'cat-05', 'cat-06']
for cat in cats:
    create(f'{cat}-complete-v1.zip', [cat])
create('three-cats-complete-v1.zip', cats)
create('three-cats-mobile-v1.zip', cats, mobile_only=True)
