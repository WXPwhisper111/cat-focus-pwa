import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const index = await read('public/cat-interactions-v2/index.json');
const cats = [];
for (const entry of index.cats) {
  if (!/^cat-0[123]\/animations\.json$/.test(entry.manifest)) throw Error('Invalid interaction manifest path');
  const source = await read(`public/cat-interactions-v2/${entry.manifest}`);
  if (source.id !== entry.id || source.applicationCatId !== entry.applicationCatId || source.version !== index.version) throw Error('Interaction index/manifest mismatch');
  const { id, applicationCatId, version, canvas, feetAnchor, actions } = source;
  cats.push({ id, applicationCatId, version, canvas, feetAnchor, actions, manifest: entry.manifest });
}
// Derived metadata only; the original manifests, PNGs and WebPs are never written.
await writeFile(resolve(root, 'art/cat-interactions-v2/runtime-interactions.json'), JSON.stringify({ version: index.version, cats }, null, 2) + '\n');
