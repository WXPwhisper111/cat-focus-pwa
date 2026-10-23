import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTimeline,duration,frameAt} from './timeline.mjs';
const cat={idle:[{file:'open',durationMs:9000},{file:'half',durationMs:80},{file:'closed',durationMs:100},{file:'half',durationMs:80}],stretch:{frames:[{file:'idle-first',durationMs:150},{file:'peak',durationMs:3300},{file:'idle-last',durationMs:150}]}};
assert.equal(duration(cat.idle),9260);assert.equal(duration(cat.stretch.frames),3600);
assert.equal(frameAt(cat.idle,9080),2);
const t=createTimeline(cat,()=>0);t.advance(10000);assert.equal(t.snapshot().state,'idle');
t.advance(8520);assert.equal(t.snapshot().state,'stretch');assert.equal(t.snapshot().elapsed,0);
t.advance(3600);assert.equal(t.snapshot().state,'idle');assert.equal(t.snapshot().elapsed,0);assert.equal(t.snapshot().completed,1);
t.advance(18520+3600);assert.equal(t.snapshot().completed,2);
t.stretchNow();t.advance(1000);t.stretchNow();assert.equal(t.snapshot().elapsed,0);
t.advance(3600);assert.equal(t.snapshot().state,'idle');
assert.throws(()=>t.advance(-1));
const a=createTimeline(cat,()=>0.1),b=createTimeline(cat,()=>0.8);assert.notEqual(a.snapshot().elapsed,b.snapshot().elapsed);
const fast=createTimeline(cat,()=>0),slow=createTimeline(cat,()=>0);fast.advance(100000);for(let i=0;i<1000;i++)slow.advance(100);assert.deepEqual(fast.snapshot(),slow.snapshot());
console.log('Preview timeline: boundary / blink / 2 rounds / replay / desynchronization / frame gaps passed');
const actual=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
for(const c of actual.cats){
  assert.equal(duration(c.idle),9260);assert.deepEqual(c.idle.filter(f=>f.durationMs!==150).map(f=>f.durationMs),[80,100,80]);
  const player=createTimeline(c,()=>0);player.advance(44240);assert.equal(player.snapshot().completed,2);assert.equal(player.snapshot().elapsed,0);assert.equal(player.snapshot().state,'idle');
  assert.equal(player.snapshot().file,c.idle[0].file);
}
console.log('All',actual.cats.length,'real manifests: blink timings / 44.24 second alternation / idle return passed');
