// Independent art-preview clock. No application imports or persisted state.
export function duration(frames) { return frames.reduce((n,f)=>n+f.durationMs,0); }
export function frameAt(frames,time) {
  for(let i=0;i<frames.length;i++) { if(time<frames[i].durationMs)return i; time-=frames[i].durationMs; }
  return frames.length-1;
}
export function createTimeline(cat,rng=Math.random) {
  const idleDuration=duration(cat.idle), stretchDuration=duration(cat.stretch.frames);
  let state='idle', elapsed=rng()*idleDuration, waited=0, threshold=10000+rng()*10000, completed=0;
  const reset=()=>{state='idle';elapsed=0;waited=0;threshold=10000+rng()*10000;};
  return {
    advance(dt) {
      if(!Number.isFinite(dt)||dt<0)throw Error('Invalid elapsed time');
      while(dt>0) {
        const cycle=state==='idle'?idleDuration:stretchDuration;
        const step=Math.min(dt,cycle-elapsed); elapsed+=step;dt-=step;
        if(state==='idle')waited+=step;
        if(elapsed>=cycle-0.00001) {
          if(state==='stretch'){completed++;reset();}
          else {elapsed=0;if(waited>=threshold)state='stretch';}
        }
      }
      return this.snapshot();
    },
    stretchNow(){state='stretch';elapsed=0;},
    restart(){reset();},
    snapshot(){const frames=state==='idle'?cat.idle:cat.stretch.frames;return {state,elapsed,waited,threshold,completed,index:frameAt(frames,elapsed),file:frames[frameAt(frames,elapsed)].previewFile??frames[frameAt(frames,elapsed)].file};},
  };
}
