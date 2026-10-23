"""Build no-server galleries, true-size rooms and a six-cat motion overview."""
from build import *
from PIL import ImageSequence
manifest=json.loads((HERE/'manifest.json').read_text('utf-8'));cats=manifest['cats'];background=Image.open(HERE/'room.png').convert('RGBA')
fontpath=Path('C:/Windows/Fonts/msyh.ttc');font=ImageFont.truetype(str(fontpath),15) if fontpath.exists() else ImageFont.load_default()
reel=[Image.new('RGB',(864,480),'#f6eddf') for _ in range(18)];html=[]
phaseboard=Image.new('RGB',(288*len(cats),720),'#f6eddf')
def reference_view(im,cat):
    size=176*cat['previewDisplayScale'];anchor=cat['previewAnchor'];view=Image.new('RGBA',(288,208))
    view.paste(im.resize((round(size),round(size)),Image.Resampling.NEAREST),(round(130-anchor[0]*size/1254),round(204-anchor[1]*size/1254)))
    return view
for ci,cat in enumerate(cats):
    out=HERE/'previews'/cat['id'];frames=cat['stretch']['frames'];sprites=[Image.open(HERE/f['previewFile']).convert('RGBA')for f in frames];durations=[f['durationMs']for f in frames]
    for i,im in enumerate(sprites):
        small=reference_view(im,cat);x=(ci%3)*288;y=(ci//3)*240;reel[i].paste(small,(x,y),small);ImageDraw.Draw(reel[i]).text((x+8,y+214),cat['name'] if fontpath.exists() else cat['id'],font=font,fill='#503c2b')
        if i in (0,8,17):
            row=(0,8,17).index(i);phaseboard.paste(small,(ci*288,row*240),small);ImageDraw.Draw(phaseboard).text((ci*288+8,row*240+214),cat['name']+' / '+str(i+1),font=font,fill='#503c2b')
    for width in (390,430):
        ratio=width/1024;size=144*cat['previewDisplayScale'];point=cat['previewAnchor'];x=(512-point[0]*size/1254)*ratio;y=(716-point[1]*size/1254)*ratio
        scenes=[]
        for im in sprites:
            scene=background.resize((width,round(width*.75)),Image.Resampling.NEAREST);overlay=Image.new('RGBA',scene.size);overlay.paste(im.resize((round(size*ratio),round(size*ratio)),Image.Resampling.NEAREST),(round(x),round(y)));scene.alpha_composite(overlay);scenes.append(scene.convert('RGB'))
        scenes[0].save(out/f'room-{width}.webp','WEBP',save_all=True,append_images=scenes[1:],duration=durations,loop=1,lossless=True,exact=True)
    # Exactly two full idle-wait/stretch cycles, not a looping stretch disguised as idle alternation.
    idle=[Image.open(HERE/f['file']).convert('RGBA').resize((176,176),Image.Resampling.NEAREST)for f in cat['idle']]
    sequence=idle*2+[s.resize((176,176),Image.Resampling.NEAREST) for s in sprites]
    times=[f['durationMs']for f in cat['idle']]*2+durations
    sequence=sequence*2;times=times*2
    sequence[0].save(out/'alternation-two-rounds.webp','WEBP',save_all=True,append_images=sequence[1:],duration=times,loop=1,lossless=True,exact=True)
    html.append(f'<section><h2>{cat["name"]}</h2><img width="176" height="176" src="previews/{cat["id"]}/card.webp"><p><a href="previews/{cat["id"]}/stretch.webp">288 px 单次动作</a> · <a href="previews/{cat["id"]}/alternation-two-rounds.webp">两轮交替（44.24 秒）</a></p><p><a href="previews/{cat["id"]}/room-390.webp">390 房间</a> · <a href="previews/{cat["id"]}/room-430.webp">430 房间</a></p></section>')
    print(cat['id'],'review movies exported',flush=True)
reel[0].save(HERE/'motion-reel.webp','WEBP',save_all=True,append_images=reel[1:],duration=[f['durationMs']for f in cats[0]['stretch']['frames']],loop=0,lossless=True,exact=True)
phaseboard.save(HERE/'validation'/'overview-phases.png')
(HERE/'gallery.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>伸懒腰 V1 画廊</title><style>body{background:#f6eddf;color:#503c2b;font:15px system-ui;margin:20px}main{display:flex;flex-wrap:wrap;gap:16px}section{background:#fff8ec;padding:16px;border-radius:12px}img{image-rendering:pixelated}a{color:#79562e}</style><h1>六只猫 · 伸懒腰 V1</h1><p>本画廊无需服务器。单次动作播放后停在待机；重新加载可重播。每只猫下方也提供两轮完整交替动画。</p><img width="576" style="max-width:100%;height:auto" src="motion-reel.webp"><main>'+''.join(html)+'</main></html>','utf-8')
save_json(HERE/'validation'/'preview-spec.json',dict(cats=[c['id'] for c in cats],stretchDurationMs=3600,alternationTwoRoundsMs=44240,roomWidths=[390,430],cardSize=176))
