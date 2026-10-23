"""Choose ONE reference transform per entire drawn clip; manual rear X landmarks.

Fitting uses the union of all poses, never independent per-frame scaling.
"""
from build import *
REAR_X={
 'cat-02':[216,203,202,204,102,96,102,56,70,87,184,198,200,178,187,194],
 'cat-03':[174,170,170,171,93,80,80,70,80,80,166,170,173,175,175,175],
 'cat-04':[174,170,170,171,100,80,80,70,80,80,166,170,173,175,175,175],
 'cat-05':[200,200,200,200,100,85,85,75,80,80,180,190,195,195,195,195],
 'cat-06':[174,170,170,171,100,80,80,70,80,80,166,170,173,175,175,175],
}
SOURCE_REAR={'cat-02':[674,1188],'cat-03':[645,1180],'cat-04':[666,1176],'cat-05':[695,1175],'cat-06':[650,1175]}
def register():
    cfg=json.loads((HERE/'registration.json').read_text('utf-8'));base=cfg['cat-01']
    for cid,points in REAR_X.items():
        p=HERE/'sources'/cid/'stretch-sheet.png'
        if not p.exists():continue
        sheet=Image.open(p).convert('RGBA');rows=[]
        for i,x in enumerate(points):
            ox=round(i%4*sheet.width/4);oy=round(i//4*sheet.height/4)
            im,box=isolate_pose(sheet,[ox+sheet.width/4*.57,oy+sheet.height/4*.57]);a=np.array(im);rx=ox+x
            ys,xs=np.where(a[:,max(0,rx-8):rx+9,3]>200)
            if not len(ys):raise ValueError(f'{cid} {i+1}: missing manually selected rear contact')
            ry=int(ys.max());rows.append(dict(index=i+1,sourceBox=box,rear=[rx,ry]))
        L=max(r['rear'][0]-r['sourceBox'][0]for r in rows);R=max(r['sourceBox'][2]-r['rear'][0]for r in rows)
        scale=min(2.75,(S-64)/(L+R));target_x=32+L*scale
        first=rows[0]['sourceBox'];source=Image.open(HERE/'sources'/cid/'idle.png');sb=Image.fromarray((np.array(source)[:,:,3]>160).astype('uint8')*255).getbbox()
        idle_scale=scale*(first[3]-first[1])/(sb[3]-sb[1]);sr=SOURCE_REAR[cid]
        translation=[target_x-(627+(sr[0]-627)*idle_scale),0]
        # Preserve 24px bottom margin even if a forward paw lies below rear contact.
        extra=max(r['sourceBox'][3]-r['rear'][1]for r in rows)*scale
        target_y=1200+(sr[1]-1200)*idle_scale
        if target_y+extra>S-24:translation[1]=(S-24)-(target_y+extra)
        cfg[cid]=dict(sheet=p.relative_to(HERE).as_posix(),scale=scale,idleScale=idle_scale,idleTranslation=translation,sourceRear=sr,bleed=12,rearPoints=[[x,0]for x in points],durationsMs=base['durationsMs'])
        print(cid,'scale',round(scale,4),'reference scale',round(idle_scale,4),'rear target',round(target_x,2),flush=True)
    save_json(HERE/'registration.json',cfg)
if __name__=='__main__':register()
