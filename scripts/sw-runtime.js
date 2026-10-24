/* CONFIG is generated from the exact build bytes. No user/business data is stored here. */
const ROOT = self.location.href;
const META_CACHE = 'cat-focus-update-metadata-v1';
const full = path => new URL(path, ROOT).href;
const paths = new Map(CONFIG.assets.map(path => [full(path), path]));
const corePaths = new Set(CONFIG.core);
const clientEntries = new Map();
const inFlight = new Map();
let warming;
const metaURL = version => full('./.offline-version/' + version);
const cacheNames = async () => (await caches.keys()).filter(name => name.startsWith('cat-focus-') && name !== META_CACHE);
async function digest(response) {
  const bytes = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  return 'sha256-' + btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
async function download(path) {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const response = await fetch(new Request(full(path), { cache: 'reload', integrity: CONFIG.integrity[path], signal: abort.signal }));
    if (!response.ok || response.type === 'opaque') throw Error('Resource unavailable');
    // Keep the timeout and integrity check active until the entire body has arrived.
    await response.clone().arrayBuffer();
    return response;
  } finally { clearTimeout(timer); }
}
async function loadAsset(path) {
  const name = corePaths.has(path) ? CONFIG.coreCache : CONFIG.mediaCache;
  const cache = await caches.open(name), url = full(path);
  const hit = await cache.match(url, { ignoreVary: true }); if (hit) return hit;
  // Reuse previous bytes only after checking their content against this build.
  for (const previous of await cacheNames()) {
    if (previous === name) continue;
    const old = await (await caches.open(previous)).match(url, { ignoreVary: true });
    if (old && await digest(old) === CONFIG.integrity[path]) { await cache.put(url, old.clone()); return old; }
  }
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const response = await download(path); await cache.put(url, response.clone()); return response; }
    catch (error) { failure = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
  }
  throw failure;
}
function asset(path) {
  const key = full(path);
  if (!inFlight.has(key)) {
    const pending = loadAsset(path).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return inFlight.get(key).then(response => response.clone());
}
async function pool(items, operation) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (cursor < items.length) await operation(items[cursor++]);
  }));
}
async function mediaState() {
  const keys = new Set((await (await caches.open(CONFIG.mediaCache)).keys()).map(request => request.url));
  return { total: CONFIG.media.length, cached: CONFIG.media.filter(path => keys.has(full(path))).length };
}
async function status() { return { release:CONFIG.release, version: CONFIG.version, entry: full(CONFIG.entry), media: await mediaState() }; }
async function rememberVersion() {
  const meta = await caches.open(META_CACHE);
  await meta.put(metaURL(CONFIG.version), new Response(JSON.stringify({ ...CONFIG, savedAt: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
}
async function cleanObsolete() {
  // Unknown/legacy live clients may still need old hashed scripts: never remove their caches.
  const media = await mediaState();
  if (media.cached !== media.total) return;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some(client => !clientEntries.has(client.id))) return;
  const liveIds = new Set(clients.map(client => client.id));
  for (const id of clientEntries.keys()) if (!liveIds.has(id)) clientEntries.delete(id);
  const meta = await caches.open(META_CACHE), versions = [];
  for (const request of await meta.keys()) {
    const response = await meta.match(request); if (response) versions.push(await response.json());
  }
  versions.sort((a, b) => b.savedAt - a.savedAt);
  const previous = versions.find(version => version.version !== CONFIG.version);
  const live = new Set(clientEntries.values());
  const keep = new Set([CONFIG.coreCache, CONFIG.mediaCache]);
  for (const version of versions) if (version === previous || live.has(full(version.entry))) { keep.add(version.coreCache); keep.add(version.mediaCache); }
  // During the first upgrade retain legacy caches as the previous complete generation.
  const preserveLegacy = !previous;
  for (const name of await cacheNames()) if (!keep.has(name) && !(preserveLegacy && name.startsWith('cat-focus-v1-'))) await caches.delete(name);
  for (const version of versions) if (!keep.has(version.coreCache)) await meta.delete(metaURL(version.version));
}
self.addEventListener('install', event => event.waitUntil((async () => {
  await pool(CONFIG.core, path => asset(path));
  // Replace the worker, never reload an open page. Old clients without update UI need this bridge.
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => { await rememberVersion(); await self.clients.claim(); })()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scopedRoot = new URL('./', ROOT);
  const canonical = event.request.mode === 'navigate' && (url.pathname === scopedRoot.pathname || url.pathname === scopedRoot.pathname + 'index.html') ? full('./') : url.href;
  const path = paths.get(canonical);
  if (path) { event.respondWith(asset(path)); return; }
  // Keep previously opened clients able to request their immutable hashed bundle.
  if (url.origin === scopedRoot.origin && /\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith((async () => {
      for (const name of await cacheNames()) { const hit = await (await caches.open(name)).match(event.request, { ignoreVary: true }); if (hit) return hit; }
      return fetch(event.request);
    })());
  }
});
self.addEventListener('message', event => {
  const message = event.data, port = event.ports && event.ports[0];
  if (!port || message?.type !== 'CAT_FOCUS_UPDATE') return;
  const run = async () => {
    if (message.action === 'STATUS') {
      if (event.source?.id && typeof message.entry === 'string') clientEntries.set(event.source.id, message.entry);
      const result = await status(); await cleanObsolete(); return result;
    }
    if (message.action === 'WARM_MEDIA') {
      if (!warming) {
        warming = (async () => {
          const cache = await caches.open(CONFIG.mediaCache);
          const keys = new Set((await cache.keys()).map(request => request.url));
          const skip = new Set(Array.isArray(message.skip) ? message.skip : []);
          const missing = CONFIG.media.filter(path => !keys.has(full(path)) && !skip.has(path));
          const failed = [];
          // A bounded batch survives interruption: completed entries remain in Cache Storage.
          await pool(missing.slice(0, 3), async path => { try { await asset(path); } catch { failed.push(path); } });
          return { ...await status(), failed, remaining: Math.max(0, missing.length - 3) };
        })().finally(() => { warming = undefined; });
      }
      return warming;
    }
    throw Error('Unknown update action');
  };
  event.waitUntil(run().then(result => port.postMessage({ ok: true, ...result }), () => port.postMessage({ ok: false })));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (client) { await client.focus(); client.postMessage({ type: 'FOCUS_NOTIFICATION_OPEN' }); }
    else await self.clients.openWindow(new URL('./', self.location.href).href);
  })());
});
