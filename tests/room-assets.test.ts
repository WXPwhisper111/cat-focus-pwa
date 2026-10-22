import { expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import layout from '../art/room-v0.1/scene-calibration/layout.json';
import sprites from '../art/room-v0.1/scene-calibration/cat-frames.json';

it('has every canonical room layer and mobile frame, with transparent lossless 288px WebP containers', async () => {
  for (const layer of layout.layers) {
    if (layer.file && layer.id !== 'cat') expect((await stat(join('public/room', layer.file))).size).toBeGreaterThan(0);
  }
  let total = 0;
  for (const state of Object.values(sprites.states)) {
    for (const frame of state.frames) {
      const buffer = await readFile(join('public', frame.file));
      expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
      expect(buffer.toString('ascii', 8, 12)).toBe('WEBP');
      const start = buffer.indexOf('VP8L'); expect(start).toBeGreaterThan(0);
      const bits = buffer.readUInt32LE(start + 9);
      expect((bits & 0x3fff) + 1).toBe(288);
      expect(((bits >>> 14) & 0x3fff) + 1).toBe(288);
      expect((bits >>> 28) & 1).toBe(1);
      total += buffer.length;
    }
  }
  expect(total).toBe(sprites.bytes.derived);
  expect(total).toBeLessThan(sprites.bytes.source * .1);
});

it('builds a cache manifest with room layers and mobile frames, excluding original cat PNGs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cat-room-cache-'));
  try {
    for (const relative of ['index.html', 'room/room_base.png', 'cat/idle/idle_01.png', 'cat_01/idle/idle_01.png', 'cat_02/idle/idle_01.png', 'cat_03/idle/idle_01.png', 'cat-mobile/idle/idle_01.webp', 'cat-mobile/sleep_loop/sleep_loop_01.webp', 'cat-mobile/cat_02/idle/idle_01.webp', 'cat-animation-v2/cat-02/mobile/idle/idle_001.webp', 'cat-animation-v2/cat-02/idle/idle_001.png']) {
      const file = join(root, 'dist', relative);
      await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, 'cache-fixture');
    }
    for (const relative of ['cat-interactions-v1/cat-01/eat/enter/enter_001.png', 'cat-interactions-v1/cat-01/mobile/eat/loop/loop_001.webp', 'cat-interactions-v2/index.json', 'cat-interactions-v2/cat-01/animations.json', 'cat-interactions-v2/cat-01/eat/loop/loop_001.png', 'cat-interactions-v2/cat-01/mobile/eat/loop/loop_001.webp']) {
      const file = join(root, 'dist', relative);
      await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, 'cache-fixture');
    }
    await promisify(execFile)(process.execPath, [join(process.cwd(), 'scripts/generate-sw.mjs')], { cwd: root });
    const sw = await readFile(join(root, 'dist/sw.js'), 'utf8');
    expect(sw).toContain('./room/room_base.png');
    expect(sw).not.toContain('./cat-mobile/idle/idle_01.webp');
    expect(sw).not.toContain('./cat-mobile/sleep_loop/sleep_loop_01.webp');
    expect(sw).not.toContain('./cat/idle/idle_01.png');
    for (const id of ['cat_01', 'cat_02', 'cat_03']) expect(sw).not.toContain(`./${id}/idle/idle_01.png`);
    expect(sw).not.toContain('./cat-mobile/cat_02/idle/idle_01.webp');
    expect(sw).toContain('./cat-animation-v2/cat-02/mobile/idle/idle_001.webp');
    expect(sw).not.toContain('./cat-interactions-v1/');
    expect(sw).not.toContain('./cat-interactions-v2/cat-01/eat/loop/loop_001.png');
    expect(sw).toContain('./cat-interactions-v2/index.json');
    expect(sw).toContain('./cat-interactions-v2/cat-01/animations.json');
    expect(sw).toContain('./cat-interactions-v2/cat-01/mobile/eat/loop/loop_001.webp');
    // Emulate a public script cached by addAll without Origin, then requested
    // as a CORS module with Origin while the server is unavailable.
    const handlers = new Map<string, (event: { request: Request; respondWith: (promise: Promise<Response>) => void }) => void>();
    const cached = new Response('offline-script', { headers: { Vary: 'Origin', 'Content-Type': 'text/javascript' } });
    runInNewContext(sw, {
      URL, Set,
      self: { location: new URL('http://localhost/sw.js'), addEventListener: (name: string, handler: never) => handlers.set(name, handler) },
      caches: { open: async () => ({ match: async (_request: Request, options?: CacheQueryOptions) => options?.ignoreVary ? cached : undefined }) },
      fetch: async () => { throw Error('Server stopped'); },
    });
    let response: Promise<Response> | undefined;
    const respondWith = (promise: Promise<Response>) => { response = promise; };
    handlers.get('fetch')!({ request: new Request('http://localhost/cat-animation-v2/cat-02/mobile/idle/idle_001.webp', { headers: { Origin: 'http://localhost' } }), respondWith });
    expect(await (await response!).text()).toBe('offline-script');
    response = undefined;
    handlers.get('fetch')!({ request: new Request('http://localhost/private-api'), respondWith });
    expect(response).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
