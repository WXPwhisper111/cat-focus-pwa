// One delegated listener for all present and future dialogs. Never bypass cancel guards.
export function installDialogDismiss(root:Document=document) {
  let started:HTMLDialogElement|null=null;
  const outside=(event:MouseEvent)=>{
    const node=event.target;if(!(node instanceof HTMLDialogElement)||!node.open||node.dataset.dismissOutside==='false')return null;
    const rect=node.getBoundingClientRect();
    return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom?node:null;
  };
  const down=(event:PointerEvent)=>{started=event.button===0?outside(event):null;};
  const click=(event:MouseEvent)=>{
    const dialog=outside(event),allowed=dialog&&dialog===started;started=null;if(!allowed)return;
    event.preventDefault();event.stopPropagation();
    if(dialog.dispatchEvent(new CustomEvent('cancel',{cancelable:true,detail:{source:'backdrop'}})))if(dialog.open)dialog.close();
  };
  const cancel=()=>{started=null;};
  root.addEventListener('pointerdown',down,true);root.addEventListener('pointercancel',cancel,true);root.addEventListener('click',click,true);
  return ()=>{root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointercancel',cancel,true);root.removeEventListener('click',click,true);};
}

export const isBackdropCancel=(event:Event)=>event instanceof CustomEvent&&event.detail?.source==='backdrop';
