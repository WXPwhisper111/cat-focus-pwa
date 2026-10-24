export type UserRelease={id:string;label:string;title:string;summary:string[]};
export function userRelease(value:unknown):UserRelease|undefined {
  if(!value||typeof value!=='object')return;
  const v=value as UserRelease;
  if([v.id,v.label,v.title].some(s=>typeof s!=='string'||!s.trim()||s.length>120)||!Array.isArray(v.summary)||!v.summary.length||v.summary.length>5||v.summary.some(s=>typeof s!=='string'||!s.trim()||s.length>240))return;
  return {id:v.id,label:v.label,title:v.title,summary:[...v.summary]};
}
