from pathlib import Path
from PIL import Image
import json,hashlib
root=Path(__file__).resolve().parent.parent
folder=root/'art/page-headers-v1'
manifest=json.loads((folder/'source-manifest.json').read_text(encoding='utf-8'))
rows=[]
assert {a['page'] for a in manifest['assets']}=={'focus','stats','house','settings'}
for item in manifest['assets']:
    master=folder/'sources'/item['png'];runtime=root/'public/page-headers-v1'/item['webp']
    assert hashlib.sha256(master.read_bytes()).hexdigest()==item['pngSha256']
    assert hashlib.sha256(runtime.read_bytes()).hexdigest()==item['webpSha256']
    with Image.open(master) as a,Image.open(runtime) as b:
        a.load();b.load();assert a.size==b.size==(1536,768)
        assert a.convert('RGBA').getchannel('A').getextrema()==b.convert('RGBA').getchannel('A').getextrema()==(255,255)
        assert a.convert('RGB').tobytes()==b.convert('RGB').tobytes()
    rows.append({'page':item['page'],'runtime':'./page-headers-v1/'+runtime.name,'bytes':runtime.stat().st_size,'sha256':item['webpSha256'],'size':[1536,768],'losslessMatch':True})
report={'assets':rows,'runtimeBytes':sum(r['bytes'] for r in rows),'originalPngBytes':sum((folder/'sources'/item['png']).stat().st_size for item in manifest['assets'])}
(folder/'asset-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Four decoded opaque PNG/WebP pairs match exactly;',report['runtimeBytes'],'runtime bytes')
