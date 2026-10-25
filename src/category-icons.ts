import pawCoinSvg from './assets/paw_coin.svg?raw';

const customIcons = ['category', 'pencil', 'music', 'palette', 'bulb', 'target', 'coffee', 'heart', 'leaf', 'flag'] as const;
export const CATEGORY_COLORS = ['#eb884b', '#f4bd62', '#9c9e70', '#b17b65', '#bd8f98', '#c4a45e', '#91816b', '#c67d66'];
function categoryHash(id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
export function categoryColor(id: string, name?: string) {
  const builtins = ['builtin-english', 'builtin-computer', 'builtin-fitness', 'builtin-math'];
  const names = ['英语', '计算机', '健身', '数学'];
  const index = builtins.indexOf(id);
  const matched = index >= 0 ? index : names.indexOf(name || '');
  return CATEGORY_COLORS[matched >= 0 ? matched : categoryHash(`color:${id}`) % CATEGORY_COLORS.length];
}
type IconName = 'paw-coin' | 'focus-timer' | 'settings-gear' | 'cat-house' | 'goal' | 'clock' | 'bars' | 'flame' | 'book' | 'computer' | 'star' | 'paw' | 'dumbbell' | 'math' | typeof customIcons[number];
export function icon(name: IconName) {
  if (name === 'paw-coin') return pawCoinSvg.replace('<svg ', '<svg data-stats-icon="paw-coin" aria-hidden="true" ');
  const paths = {
    'focus-timer': '<circle cx="12" cy="14" r="8"/><path d="M10 2h4m-2 0v4m6.5 1.5L20 6M12 10v4l3-2"/>',
    'settings-gear': '<path d="M19.75 9.63L22.14 10.21 22.14 13.79 19.75 14.37 19.15 15.80 20.44 17.91 17.91 20.44 15.80 19.15 14.37 19.75 13.79 22.14 10.21 22.14 9.63 19.75 8.20 19.15 6.09 20.44 3.56 17.91 4.85 15.80 4.25 14.37 1.86 13.79 1.86 10.21 4.25 9.63 4.85 8.20 3.56 6.09 6.09 3.56 8.20 4.85 9.63 4.25 10.21 1.86 13.79 1.86 14.37 4.25 15.80 4.85 17.91 3.56 20.44 6.09 19.15 8.20Z"/><circle cx="12" cy="12" r="3.2"/>',
    'cat-house': '<path d="m2 10 10-8 10 8M4 9v12h16V9M8 17v-5l3 2h2l3-2v5c0 3-8 3-8 0Z"/><path d="M10 16h.01M14 16h.01M11.5 18h1"/>',
    goal: '<path d="M20 11a8 8 0 1 1-7-7M16 12a4 4 0 1 1-4-4M12 12l9-9m-5 0h5v5"/>',
    dumbbell: '<path d="M8 12h8M2 10v4m20-4v4M2 12h2m16 0h2"/><rect x="4" y="7" width="4" height="10" rx="1"/><rect x="16" y="7" width="4" height="10" rx="1"/>',
    math: '<path d="M4 7h6M7 4v6m7-3h6M4 16l6 6m0-6-6 6m10-5h6m-6 4h6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    bars: '<path d="M4 20h16M6 16v-4m6 4V8m6 8V4"/>',
    flame: '<path d="M13 3c1 5 5 6 5 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-2 2-5 2-8Z"/>',
    book: '<path d="M12 5v15M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Z"/>',
    computer: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20M9 16v4m6-4v4"/>',
    category: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    pencil: '<path d="m15 4 5 5L9 20l-6 1 1-6L15 4Zm-2 2 5 5M4 15l5 5"/>',
    music: '<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c4-5-1-11-7-11Z"/><circle cx="7" cy="10" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="16" cy="8" r="1"/>',
    bulb: '<path d="M9 17h6v-2a7 7 0 1 0-6 0v2ZM9 20h6m-5 3h4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    coffee: '<path d="M4 8h13v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm13 1h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3"/>',
    heart: '<path d="M12 21 3 12C-2 5 7-1 12 6c5-7 14-1 9 6l-9 9Z"/>',
    leaf: '<path d="M20 3C8 1 2 7 5 15c3 8 17 3 15-12ZM3 22 16 9"/>',
    flag: '<path d="M5 22V3c5-4 9 4 15 0v12c-6 4-10-4-15 0"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1 3-6Z"/>',
    paw: '<ellipse cx="5" cy="9" rx="2" ry="3" transform="rotate(-25 5 9)"/><ellipse cx="10" cy="5" rx="2" ry="3"/><ellipse cx="16" cy="6" rx="2" ry="3"/><ellipse cx="20" cy="11" rx="2" ry="3" transform="rotate(25 20 11)"/><path d="M6 18c0-3 4-7 6-7s6 4 6 7c0 5-4 2-6 2s-6 3-6-2Z"/>',
  };
  return `<svg data-stats-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export function categoryIcon(id: string, name?: string) {
  if (id === 'builtin-english') return icon('book');
  if (id === 'builtin-fitness' || name === '健身') return icon('dumbbell');
  if (id === 'builtin-math' || name === '数学') return icon('math');
  if (id === 'builtin-computer') return icon('computer');
  // FNV-1a keeps the assignment stable without storing presentation metadata.
  return icon(customIcons[categoryHash(id) % customIcons.length]);
}
