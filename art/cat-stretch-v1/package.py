"""Create explicit per-cat and complete deliveries; excluded archives stay local."""
from build import *
import zipfile
data=json.loads((HERE/'manifest.json').read_text('utf-8'));dest=HERE/'packages';dest.mkdir(exist_ok=True);index=[]
shared=['README.md','preview.html','preview.mjs','timeline.mjs','room.png','motion-reel.webp','production.json','registration.json','requirements.txt','serve_preview.py','setup_sources.py','register.py','build.py','render_review.py','validate.py','check_timeline.mjs','validate_previews.py']
def package(name,cats,mobile=False):
    paths=[HERE/f for f in shared if (HERE/f).exists()]
    for cat in cats:
        for folder in ('resources','previews') if mobile else ('resources','previews','sources'):
            paths += [p for p in (HERE/folder/cat['id']).rglob('*') if p.is_file() and (not mobile or (p.suffix!='.png' and p.parent.name!='idle' and p.name!='alternation-two-rounds.webp'))]
    archive=dest/name
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(set(paths)):
            if p.name=='animations.json' and mobile:
                meta=json.loads(p.read_text('utf-8'));meta['encodedCanvas']=[288,288]
                for f in meta['actions']['stretch']['frames']:f['originalFile']=f['file'];f['file']=f['mobileFile']
                z.writestr(p.relative_to(HERE).as_posix(),json.dumps(meta,ensure_ascii=False,indent=2))
            else:z.write(p,p.relative_to(HERE))
        local=json.loads(json.dumps({**data,'cats':cats}))
        if mobile:
            for cat in local['cats']:
                cat['stretch']['encodedCanvas']=[288,288]
                for f in cat['stretch']['frames']:f['originalFile']=f['file'];f['file']=f['previewFile']
        z.writestr('manifest.json',json.dumps(local,ensure_ascii=False,indent=2))
        z.writestr('preview-data.js','window.STRETCH_DATA='+json.dumps(local,ensure_ascii=False)+';\n')
        gallery='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>伸懒腰素材包</title><h1>伸懒腰 V1</h1><p>每段 3.6 秒，单次播放。交替演示请启动 serve_preview.py 后打开 preview.html。</p>'
        for cat in cats:
            gallery+=f'<h2>{cat["name"]}</h2><img width="176" height="176" src="previews/{cat["id"]}/card.webp">'
            if not mobile:gallery+=f'<p><a href="previews/{cat["id"]}/alternation-two-rounds.webp">两轮交替</a></p>'
        z.writestr('gallery.html',gallery+'</html>')
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for cat in local['cats']:
            for f in cat['idle']:assert f['file'] in z.namelist(),f['file']
            for f in cat['stretch']['frames']:
                assert f['file'] in z.namelist(),f['file'];assert f['previewFile'] in z.namelist(),f['previewFile']
            meta=json.loads(z.read(f'resources/{cat["id"]}/animations.json'))
            for f in meta['actions']['stretch']['frames']:
                for key in ('file','mobileFile'):assert f'resources/{cat["id"]}/'+f[key] in z.namelist()
    index.append(dict(file=name,bytes=archive.stat().st_size,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),cats=[c['id']for c in cats],mobile=mobile))
for cat in data['cats']:package(cat['id']+'-stretch-v1.zip',[cat])
package('six-cats-stretch-v1.zip',data['cats'])
package('six-cats-stretch-v1-mobile.zip',data['cats'],True)
save_json(dest/'index.json',index)
print('Packaged',len(index),'archives')
