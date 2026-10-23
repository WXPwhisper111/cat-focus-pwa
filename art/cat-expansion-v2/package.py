from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib,json
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];PUBLIC=HERE/'resources';OUT=HERE/'packages';OUT.mkdir(exist_ok=True)
layout=json.loads((ROOT/'art/room-v0.1/scene-calibration/layout.json').read_text(encoding='utf-8'))
records=[]
def package(name,cats,mobile=False):
 dest=OUT/name;prefix='cat-expansion-v2/';members=set()
 with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=1) as z:
  def add(path,arc=None):
   relative=arc or path.relative_to(ROOT).as_posix();full=prefix+relative
   if full not in members:z.write(path,full);members.add(full)
  metas={cat:json.loads((PUBLIC/cat/'animations.json').read_text(encoding='utf-8'))for cat in cats}
  for cat in cats:
   for p in sorted((PUBLIC/cat).rglob('*')):
    if p.is_file() and (not mobile or 'mobile' in p.relative_to(PUBLIC/cat).parts or p.suffix=='.json'):add(p)
   for folder in ['previews','room-previews','card-previews']:
    for p in sorted((HERE/folder/cat).glob('*.webp')):add(p)
   if not mobile:
    for p in sorted((HERE/'sources'/cat).glob('*.png')):add(p)
   for p in sorted((ROOT/'art/cat-expansion-v1/previews'/cat).glob('*.webp')):add(p)
  index={'version':'cat-expansion-v2','cats':[{'id':c,'name':m['name'],'manifest':c+'/animations.json'}for c,m in metas.items()]}
  z.writestr(prefix+'art/cat-expansion-v2/resources/index.json',json.dumps(index,ensure_ascii=False,indent=2))
  data={'cats':metas,'layout':layout};z.writestr(prefix+'art/cat-expansion-v2/preview-data.js','const PREVIEW='+json.dumps(data,ensure_ascii=False)+';\n')
  for name2 in ['preview.html','preview.js','README.md','contact-sheet.png','serve_preview.py','production.json','requirements.txt']:
   add(HERE/name2)
  if len(cats)==3:add(HERE/'motion-reel.webp')
  if not mobile:
   for name2 in ['build.py','validate.py','validate_previews.py','render_review.py','check_preview.cjs','package.py']:add(HERE/name2)
  add(ROOT/'art/room-v0.1/scene-calibration/layout.json')
  if len(cats)==3:
   for p in (HERE/'validation').glob('*.json'):add(p)
  for layer in layout['layers']:
   if layer.get('file') and layer['id']!='cat':add(ROOT/'public/room'/layer['file'])
  gallery='<html lang="zh-CN"><meta charset="utf-8"><title>V2 动画画廊</title><style>body{background:#f5ecdf;font:15px system-ui}img{image-rendering:pixelated}</style><h1>V2 动画画廊</h1>'
  for cat,meta in metas.items():
   gallery+='<h2>'+meta['name']+'</h2>'
   for action in meta['actions']:
    gallery+='<div style="display:inline-block;padding:10px">'+action+'<br><img width="176" height="176" src="card-previews/'+cat+'/'+action+'.webp"><br><a href="room-previews/'+cat+'/'+action+'-390.webp">390 房间动画</a> · <a href="room-previews/'+cat+'/'+action+'-430.webp">430 房间动画</a></div>'
  z.writestr(prefix+'art/cat-expansion-v2/gallery.html',gallery)
  z.writestr(prefix+'PACKAGE.txt','V2 review assets. Open art/cat-expansion-v2/gallery.html or preview.html in a local browser.\nPNG included: '+str(not mobile)+'\nMobile-only package: use frames[].mobileFile; PNG paths refer to the full package.\nRebuild/validation commands require the full three-cat package or original project.\n')
 with ZipFile(dest) as z:assert z.testzip() is None
 h=hashlib.sha256()
 with dest.open('rb')as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 records.append({'file':dest.name,'bytes':dest.stat().st_size,'sha256':h.hexdigest(),'cats':cats,'pngIncluded':not mobile});print(dest.name,dest.stat().st_size,flush=True)
cats=['cat-04','cat-05','cat-06']
for cat in cats:package(cat+'-complete-v2.zip',[cat])
package('three-cats-complete-v2.zip',cats);package('three-cats-mobile-v2.zip',cats,True)
(OUT/'index.json').write_text(json.dumps({'version':'cat-expansion-v2','packages':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
