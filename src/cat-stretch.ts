import resources from '../art/cat-stretch-v1/runtime.json';
import {validateClip,type AnimationClip} from './cat-animation';
const clips=new Map(resources.clips.map(value=>{const clip=value as AnimationClip;validateClip(clip);return [clip.catId,clip] as const;}));
export const stretchClip=(id:string)=>clips.get(id);
export const idleMotionTiming={minimumMs:10000,maximumMs:20000};
