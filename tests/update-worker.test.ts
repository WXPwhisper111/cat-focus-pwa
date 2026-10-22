import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
const base = 'https://example.test/';
const integrity = (text: string) => 'sha256-' + createHash('sha256').update(text).digest('base64');
class MemoryCache {
  data = new Map<string, Response>();
  key(input: Request | string) { return typeof input === 'string' ? input : input.url; }
  async match(input: Request | string, options?: CacheQueryOptions) { const hit = this.data.get(this.key(input)); if (hit?.headers.get('Vary') === 'Origin' && !options?.ignoreVary) return; return hit?.clone(); }
  async put(input: Request | string, value: Response) { this.data.set(this.key(input), value.clone()); }
  async keys() { return [...this.data.keys()].map(url => new Request(url)); }
  async delete(input: Request | string) { return this.data.delete(this.key(input)); }
}
class MemoryCaches {
  data = new Map<string, MemoryCache>();
  async open(name: string) { if (!this.data.has(name)) this.data.set(name, new MemoryCache()); return this.data.get(name)!; }
  async keys() { return [...this.data.keys()]; }
  async delete(name: string) { return this.data.delete(name); }
}
async function worker(version: string, caches = new MemoryCaches(), mediaCount = 5) {
  const files: Record<string, string> = { './': `<html>${version}</html>`, './index.html': `<html>${version}</html>`, [`./assets/${version}.js`]: `script-${version}` };
  for (let i = 0; i < mediaCount; i++) files[`./room/${i}.png`] = 'shared-art-' + i;
  const core = Object.keys(files).filter(path => !path.includes('/room/')), media = Object.keys(files).filter(path => path.includes('/room/'));
  const config = { version, entry: `./assets/${version}.js`, core, media, assets: Object.keys(files), integrity: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, integrity(text)])), coreCache: `cat-focus-core-${version}`, mediaCache: `cat-focus-media-${version}` };
  const blocked = new Set<string>(), handlers = new Map<string, (event: any) => void>();
  const clients = [{ id: 'tab', url: base }], claim = vi.fn(async () => {}), skip = vi.fn(async () => {});
  const network = vi.fn(async (request: Request) => {
    const path = './' + request.url.slice(base.length); if (blocked.has(path)) throw Error('offline');
    if (!(path in files)) throw Error('missing');
    expect(request.integrity).toBe(config.integrity[path]); return new Response(files[path], { headers: { Vary: 'Origin' } });
  });
  runInNewContext('const CONFIG=' + JSON.stringify(config) + ';\n' + await readFile('scripts/sw-runtime.js', 'utf8'), {
    self: { location: new URL('sw.js', base), clients: { claim, matchAll: async () => clients }, skipWaiting: skip, addEventListener: (name: string, callback: any) => handlers.set(name, callback) },
    URL, Request, Response, AbortController, Uint8Array, crypto: webcrypto, btoa,
    caches, fetch: network, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms >= 20_000 ? ms : 0), clearTimeout,
  });
  async function dispatch(type: string, fields: object = {}) { let pending: Promise<any> = Promise.resolve(); handlers.get(type)!({ ...fields, waitUntil: (promise: Promise<any>) => { pending = promise; } }); await pending; }
  async function message(action: string, fields: object = {}) { let answer: any; await dispatch('message', { source: { id: 'tab' }, data: { type: 'CAT_FOCUS_UPDATE', action, ...fields }, ports: [{ postMessage: (data: any) => { answer = data; } }] }); return answer; }
  async function fetchPath(path: string) { let pending!: Promise<Response>; handlers.get('fetch')!({ request: new Request(new URL(path, base)), respondWith: (response: Promise<Response>) => { pending = response; } }); return pending; }
  return { caches, config, files, blocked, network, claim, skip, dispatch, message, fetchPath };
}
it('installs only the complete core, activates without downloading media or navigating clients', async () => {
  const w = await worker('a'); w.blocked.add('./room/0.png'); await w.dispatch('install'); await w.dispatch('activate');
  expect(w.network.mock.calls).toHaveLength(3); expect(w.skip).toHaveBeenCalledOnce(); expect(w.claim).toHaveBeenCalledOnce();
  const status = await w.message('STATUS', { entry: base + 'assets/a.js' }); expect(status.media).toEqual({ cached: 0, total: 5 });
  w.blocked.add('./'); expect(await (await w.fetchPath('')).text()).toBe('<html>a</html>');
});
it('keeps the old offline shell if a newer core cannot finish, and resumes successful core entries', async () => {
  const a = await worker('a'); await a.dispatch('install'); await a.dispatch('activate');
  const b = await worker('b', a.caches); b.blocked.add('./assets/b.js'); await expect(b.dispatch('install')).rejects.toThrow(); expect(b.skip).not.toHaveBeenCalled();
  expect(await (await a.fetchPath('')).text()).toBe('<html>a</html>');
  b.blocked.clear(); b.network.mockClear(); await b.dispatch('install'); expect(b.network.mock.calls).toHaveLength(1); expect(b.skip).toHaveBeenCalledOnce();
});
it('retains downloaded media across interrupted batches and retries only missing files', async () => {
  const w = await worker('a'); await w.dispatch('install'); w.network.mockClear();
  w.blocked.add('./room/0.png'); const first = await w.message('WARM_MEDIA'); expect(first.media.cached).toBe(2); expect(first.failed).toEqual(['./room/0.png']);
  const second = await w.message('WARM_MEDIA', { skip: first.failed }); expect(second.media.cached).toBe(4); expect(second.remaining).toBe(0);
  w.blocked.clear(); w.network.mockClear(); const retry = await w.message('WARM_MEDIA'); expect(retry.media).toEqual({ cached: 5, total: 5 }); expect(w.network.mock.calls).toHaveLength(1);
});
it('reuses matching legacy artwork by hash but never serves mismatched old bytes as current assets', async () => {
  const caches = new MemoryCaches(), legacy = await caches.open('cat-focus-v1-old');
  await legacy.put(base + 'room/0.png', new Response('shared-art-0')); await legacy.put(base + 'room/1.png', new Response('outdated-art'));
  await legacy.put(base + 'assets/old.js', new Response('old immutable script', { headers: { Vary: 'Origin' } }));
  const w = await worker('b', caches, 2); await w.dispatch('install'); w.network.mockClear();
  const result = await w.message('WARM_MEDIA'); expect(result.media.cached).toBe(2); expect(w.network.mock.calls).toHaveLength(1);
  expect(await (await w.fetchPath('room/1.png')).text()).toBe('shared-art-1'); expect(await (await w.fetchPath('assets/old.js')).text()).toBe('old immutable script');
});
it('does not remove caches used by unknown live clients, and retains the previous generation when safe', async () => {
  const a = await worker('a'); await a.dispatch('install'); await a.dispatch('activate');
  const b = await worker('b', a.caches); await b.dispatch('install'); await b.dispatch('activate');
  const legacy = await b.caches.open('cat-focus-v1-old'); await legacy.put(base + 'index.html', new Response('legacy'));
  await b.message('STATUS'); expect(await b.caches.keys()).toContain('cat-focus-v1-old');
  await b.message('STATUS', { entry: base + 'assets/b.js' }); expect(await b.caches.keys()).toContain('cat-focus-v1-old');
  await b.message('WARM_MEDIA'); await b.message('WARM_MEDIA');
  await b.message('STATUS', { entry: base + 'assets/b.js' }); expect(await b.caches.keys()).not.toContain('cat-focus-v1-old'); expect(await b.caches.keys()).toContain('cat-focus-core-a'); expect(await b.caches.keys()).toContain('cat-focus-core-b');
});
