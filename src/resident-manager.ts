import { catDisplayName } from './cat-names';
import { catDefinitions, getCatDefinition } from './cat-definition';
import { getCatHouseState, getCatExpansion, manageResidents, claimExpansionCat } from './storage';
import { newCatIds } from './cat-expansion-state';
export function openResidentManager(db:IDBDatabase, prepareRemoval:(id:string)=>Promise<void>,changed:()=>Promise<void>) {
  if(document.querySelector('dialog[open]'))return;
  const dialog=document.createElement('dialog');dialog.className='resident-manager';dialog.setAttribute('aria-label','管理入住与新伙伴');document.body.append(dialog);
  const opener=document.activeElement as HTMLElement|null;let busy=false,closed=false;
  const error=document.createElement('p');error.setAttribute('role','status');
  const close=()=>{if(busy)return;closed=true;dialog.close();dialog.remove();opener?.isConnected&&opener.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  async function run(action:()=>Promise<unknown>){if(busy)return;busy=true;dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);try{await action();await changed();}catch(cause){error.textContent=cause instanceof Error?cause.message:'操作失败，请重试';}finally{busy=false;await render();}}
  async function render(){
    try {
      const house=await getCatHouseState(db),grant=await getCatExpansion(db);if(closed||!house)return;
      const title=document.createElement('h2');title.textContent='管理入住';const hint=document.createElement('p');hint.textContent=`已入住 ${house.residentCatIds.length}/3 · 已拥有 ${house.ownedCatIds.length}/6。暂离不影响主陪伴猫或所有权。`;
      const done=document.createElement('button');done.textContent='关闭';done.onclick=close;dialog.replaceChildren(title,hint,done,error);
      if(grant.eligible&&!grant.claimed){const note=document.createElement('p');note.textContent='老朋友专属：免费选择一位新伙伴（仅一次）。';dialog.append(note);}
      for(const cat of catDefinitions){
        const owned=house.ownedCatIds.includes(cat.id),resident=house.residentCatIds.includes(cat.id);
        if(!owned&&!(grant.eligible&&!grant.claimed&&newCatIds.includes(cat.id as typeof newCatIds[number])))continue;
        const card=document.createElement('section');card.className='resident-card';const image=document.createElement('img');image.src=cat.preview;image.alt='';image.width=80;image.height=80;
        const name=document.createElement('h3');name.textContent=catDisplayName(cat);const status=document.createElement('p');status.textContent=owned?(resident?'已入住':'已拥有 · 暂未入住'):'可免费领养';card.append(image,name,status);
        if(!owned){const claim=document.createElement('button');claim.textContent=`免费领养${catDisplayName(cat)}`;claim.onclick=()=>{claim.textContent='确认免费领养（仅一次）';claim.onclick=()=>void run(()=>claimExpansionCat(db,cat.id));};card.append(claim);}
        else if(resident){const leave=document.createElement('button');leave.textContent='暂离小屋';leave.disabled=house.residentCatIds.length===1;leave.onclick=()=>void run(async()=>{await prepareRemoval(cat.id);return manageResidents(db,cat.id,'out');});card.append(leave);}
        else if(house.residentCatIds.length<3){const enter=document.createElement('button');enter.textContent='安排入住';enter.onclick=()=>void run(()=>manageResidents(db,cat.id,'in'));card.append(enter);}
        else {const label=document.createElement('label');label.textContent='替换入住猫：';const select=document.createElement('select');select.setAttribute('aria-label',`为${catDisplayName(cat)}选择暂离猫`);for(const id of house.residentCatIds){const option=document.createElement('option');option.value=id;option.textContent=catDisplayName(getCatDefinition(id)!);select.append(option);}const replace=document.createElement('button');replace.textContent='确认替换';replace.onclick=()=>void run(async()=>{const id=select.value;await prepareRemoval(id);return manageResidents(db,cat.id,'in',id);});label.append(select);card.append(label,replace);}
        dialog.append(card);
      }
    }catch(cause){error.textContent=cause instanceof Error?cause.message:'读取失败';if(!dialog.contains(error))dialog.append(error);}
  }
  void render();dialog.showModal();
}
