import expansion from '../art/cat-expansion-v2/runtime.json';
import mobile from '../art/cat-animation-v2/runtime-cats.json';

export type CatAnimation = 'idle' | 'sleep_loop';
export type CatFrame = { file: string; offset: readonly number[]; durationMs?: number; sourceAnchor?: readonly number[] };
export type CatSequence = { fps: number; frames: readonly CatFrame[] };
export type CatDefinition = {
  id: string;
  name: string;
  description: string;
  preview: string;
  sourceCanvas: readonly number[];
  feetAnchor: readonly number[];
  animations: { idle: CatSequence; sleep_loop?: CatSequence };
};

// Keep the saved adoption ID while replacing the artwork with the new cat_01 model.
export const orangeWhiteCat: CatDefinition = {
  id: 'orange-white', name: '喵呜', description: '好奇又温暖，喜欢安静地陪在你身边。',
  preview: './cat-animation-v2/cat-01/mobile/idle/idle_001.webp', ...mobile['cat-01'],
};

export const catDefinitions: readonly CatDefinition[] = [
  orangeWhiteCat,
  { id: 'cat-02', name: '芒果', description: '蓝眼睛、蓬松长毛，陪你慢慢找到自己的节奏。', preview: './cat-animation-v2/cat-02/mobile/idle/idle_001.webp', ...mobile['cat-02'] },
  { id: 'cat-03', name: '橘宝', description: '小小一团奶油色，带着温柔又认真的目光。', preview: './cat-animation-v2/cat-03/mobile/idle/idle_001.webp', ...mobile['cat-03'] },
  ...expansion.cats.map(cat => ({
    id:cat.id, name:cat.name,
    description: ({'cat-04':'安静机灵的黑猫，陪你认真完成每一小步。','cat-05':'柔软的珍珠，喜欢在温暖的小屋里陪伴你。','cat-06':'活泼的狸花白，带着好奇心探索每一天。'} as Record<string,string>)[cat.id],
    preview:cat.actions.idle.frames[0].file, sourceCanvas:cat.sourceCanvas, feetAnchor:cat.feetAnchor,
    animations:Object.fromEntries(['idle','sleep'].map(action => {
      const clip=cat.actions[action as 'idle'|'sleep'];
      return [action==='sleep'?'sleep_loop':action,{fps:clip.frames.length*1000/clip.cycleDurationMs,frames:clip.frames.map(frame=>({...frame,offset:[(627-cat.feetAnchor[0])*144/1254,(1254-cat.feetAnchor[1])*144/1254],sourceAnchor:cat.feetAnchor}))}];
    })) as unknown as CatDefinition['animations'],
  })),
];
const catalogue = new Map(catDefinitions.map(cat => [cat.id, cat]));
export const getCatDefinition = (id: string | null | undefined) => id ? catalogue.get(id) : undefined;
export const resolveCatAnimation = (cat: CatDefinition, requested: CatAnimation): CatAnimation => requested === 'sleep_loop' && !cat.animations.sleep_loop ? 'idle' : requested;
export const catSequence = (cat: CatDefinition, state: CatAnimation) => cat.animations[resolveCatAnimation(cat, state)]!;
export const frameDuration = (sequence: CatSequence, index: number) => sequence.frames[index].durationMs ?? 1000 / sequence.fps;
