import { readdir, readFile, stat, lstat, unlink } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Only generated dist is pruned. Source/public artwork and previous deployments stay intact.
const root = resolve('dist');
if ((await lstat(root)).isSymbolicLink()) throw Error('Distribution root must not be a symlink');
const worker = await readFile(resolve(root, 'sw.js'), 'utf8');
const config = JSON.parse(worker.split('const CONFIG = ')[1]?.split(';\n')[0]);
if (!Array.isArray(config.assets) || !config.assets.includes('./index.html') || !config.integrity) throw Error('Missing distribution manifest');
const keep = new Set(['sw.js']);
for (const asset of config.assets) {
  if (asset === './') continue;
  if (!asset.startsWith('./') || asset.includes('\\') || asset.includes('?') || asset.includes('#')) throw Error('Invalid distribution path');
  const path = resolve(root, asset.slice(2));
  const local = relative(root, path);
  if (!local || local.startsWith('..') || local.split(sep).includes('.git')) throw Error('Path escapes distribution');
  const bytes = await readFile(path);
  if ('sha256-' + createHash('sha256').update(bytes).digest('base64') !== config.integrity[asset]) throw Error(`Integrity mismatch: ${asset}`);
  keep.add(local.split(sep).join('/'));
}
const all = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Symlinks are not allowed in distribution');
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) all.push({ path, local: relative(root, path).split(sep).join('/'), bytes: (await stat(path)).size });
    else throw Error('Unexpected distribution entry');
  }
}
await visit(root);
const retained = all.filter(file => keep.has(file.local));
const bytes = retained.reduce((sum, file) => sum + file.bytes, 0);
// Explicit budget: intentional growth must be reviewed instead of silently shipping source art.
if (bytes > 100_000_000) throw Error(`Distribution exceeds 100 MB budget: ${bytes}`);
const removed = all.filter(file => !keep.has(file.local));
// Validation above finishes before removing any generated file. No recursive deletion.
for (const file of removed) await unlink(file.path);
console.log(JSON.stringify({ version: config.version, files: retained.length, bytes, excludedFiles: removed.length, excludedBytes: removed.reduce((sum, file) => sum + file.bytes, 0) }));
