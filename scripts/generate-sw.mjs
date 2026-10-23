import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name !== 'sw.js' && entry.name !== 'update-manifest.json') {
      const asset = './' + relative('dist', path).replaceAll('\\', '/');
      // Keep original artwork in the distribution, but cache only mobile derivatives.
      if (/^\.\/cat(?:\/|_\d+\/)/.test(asset) || asset.startsWith('./cat-mobile/')) continue;
      if (asset.startsWith('./cat-animation-v2/') && !/^\.\/cat-animation-v2\/cat-0[123]\/mobile\/.+\.webp$/.test(asset)) continue;
      if (asset.startsWith('./cat-interactions-v1/')) continue;
      if (asset.startsWith('./cat-interactions-v2/') && !/^\.\/cat-interactions-v2\/(?:index\.json|cat-0[123]\/(?:animations\.json|mobile\/.+\.webp))$/.test(asset)) continue;
      if (/^\.\/cat_0[456]\//.test(asset) || asset.startsWith('./cat-expansion-v1/')) continue;
      if (asset.startsWith('./cat-expansion-v2/') && !/^\.\/cat-expansion-v2\/cat-0[456]\/(?:animations\.json|mobile\/[a-f0-9]{64}\.webp)$/.test(asset)) continue;
      result.push(asset);
    }
  }
  return result;
}
const assets = ['./', ...await files('dist')].sort();
const runtime = await readFile(new URL('./sw-runtime.js', import.meta.url), 'utf8');
const hash = createHash('sha256').update(runtime);
const integrity = {};
for (const asset of assets) {
  const bytes = await readFile(join('dist', asset.slice(2) || 'index.html'));
  integrity[asset] = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
  hash.update(asset); hash.update(bytes);
}
const version = hash.digest('hex').slice(0, 12);
const media = assets.filter(asset => /^\.\/(?:room|cat-animation-v2|cat-interactions-v2|cat-expansion-v2)\//.test(asset));
const core = assets.filter(asset => !media.includes(asset));
const html = await readFile('dist/index.html', 'utf8');
const entry = /<script[^>]*src="([^"]+)"/.exec(html)?.[1] || './index.html';
const config = { version, entry, assets, core, media, integrity, coreCache: `cat-focus-core-${version}`, mediaCache: `cat-focus-media-${version}` };
await writeFile('dist/sw.js', `const CONFIG = ${JSON.stringify(config)};\n` + runtime);
console.log(`Offline core: ${core.length} files; optional media: ${media.length} files; version: ${version}`);
