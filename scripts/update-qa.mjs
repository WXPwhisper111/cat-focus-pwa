// Isolated local deployment fixture. Run after build; never included in production.
import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
const project = process.cwd();
const port = Number(process.argv[2] || 4217);
const root = resolve(project, '..', `.pwa-update-qa-${port}`);
const source = await readFile(join(project, 'dist/sw.js'), 'utf8');
const config = JSON.parse(/^const CONFIG = (.+);/m.exec(source)[1]);
await mkdir(root, { recursive: true });
for (const variant of ['a', 'b']) {
  const dist = join(root, variant, 'dist'); await mkdir(dist, { recursive: true });
  for (const path of new Set(config.assets.map(path => path.slice(2) || 'index.html'))) {
    await mkdir(resolve(dist, path, '..'), { recursive: true }); await copyFile(join(project, 'dist', path), join(dist, path));
  }
}
const bDist = join(root, 'b/dist');
const oldEntry = config.entry.slice(2), newEntry = './assets/index-qa-version-b.js';
await writeFile(join(bDist, newEntry), await readFile(join(bDist, oldEntry), 'utf8') + '\n/* isolated update QA version B */');
await unlink(join(bDist, oldEntry));
await writeFile(join(bDist, 'index.html'), (await readFile(join(bDist, 'index.html'), 'utf8')).replace(config.entry, newEntry));
const changedMedia = 'room/window_outside_night.png';
await writeFile(join(bDist, changedMedia), Buffer.concat([await readFile(join(bDist, changedMedia)), Buffer.from('qa-b')]));
const legacyGenerator = execFileSync('git', ['show', 'bcefb94:scripts/generate-sw.mjs'], { cwd: project });
await writeFile(join(root, 'legacy-generator.mjs'), legacyGenerator);
execFileSync(process.execPath, [join(root, 'legacy-generator.mjs')], { cwd: join(root, 'a') });
execFileSync(process.execPath, [join(project, 'scripts/generate-sw.mjs')], { cwd: join(root, 'b'), stdio: 'inherit' });
await writeFile(join(root, 'state.json'), JSON.stringify({ build: 'a', blocked: true, offline: false }));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
    if (state.offline) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://localhost'); const path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (state.build === 'b' && state.blocked && path === changedMedia) { res.writeHead(503, { 'Cache-Control': 'no-store' }); res.end('QA temporary media failure'); return; }
    const dist = join(root, state.build === 'b' ? 'b/dist' : 'a/dist'); const file = resolve(dist, path);
    if (!file.startsWith(dist + '/') && !file.startsWith(dist + '\\')) { res.writeHead(403); res.end(); return; }
    const extension = /\.[^.]+$/.exec(file)?.[0]; const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Update QA http://127.0.0.1:${port}/ ; controls: ${join(root, 'state.json')}`));
