import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name !== 'sw.js') {
      const asset = './' + relative('dist', path).replaceAll('\\', '/');
      // Keep original artwork in the distribution, but cache only mobile derivatives.
      if (/^\.\/cat(?:\/|_\d+\/)/.test(asset) || asset.startsWith('./cat-mobile/')) continue;
      if (asset.startsWith('./cat-animation-v2/') && !/^\.\/cat-animation-v2\/cat-0[123]\/mobile\/.+\.webp$/.test(asset)) continue;
      if (asset.startsWith('./cat-interactions-v1/')) continue;
      if (asset.startsWith('./cat-interactions-v2/') && !/^\.\/cat-interactions-v2\/(?:index\.json|cat-0[123]\/(?:animations\.json|mobile\/.+\.webp))$/.test(asset)) continue;
      result.push(asset);
    }
  }
  return result;
}
const assets = ['./', ...await files('dist')];
const hash = createHash('sha256');
for (const asset of assets.sort()) {
  hash.update(asset);
  hash.update(await readFile(join('dist', asset.slice(2) || 'index.html')));
}
const version = 'cat-focus-v1-' + hash.digest('hex').slice(0, 12);
await writeFile('dist/sw.js', `const CACHE = ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(assets)};
const STATIC_URLS = new Set(ASSETS.map(asset => new URL(asset, self.location.href).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cat-focus-') && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !STATIC_URLS.has(event.request.url)) return;
  // Public precached files do not vary by Origin. Module loads can send Origin
  // while cache.addAll does not; Vite's Vary: Origin must not cause offline misses.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, { ignoreVary: true })).then(hit => hit || fetch(event.request)));
});
`);
