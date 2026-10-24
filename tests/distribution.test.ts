import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { catDefinitions } from '../src/cat-definition';
import { interactionClips } from '../src/cat-interactions';
import { stretchClip } from '../src/cat-stretch';
import { pageHeaderAssets } from '../src/page-headers';
import images from '../src/install-guide-images.json';
import layout from '../art/room-v0.1/scene-calibration/layout.json';

const finalize = resolve('scripts/finalize-distribution.mjs');
it('prunes generated extras only after validating every retained byte; rejects traversal before deleting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cat-distribution-'));
  try {
    await mkdir(join(root, 'dist')); await mkdir(join(root, 'public'));
    await writeFile(join(root, 'public/source.png'), 'original');
    await writeFile(join(root, 'dist/index.html'), 'app');
    await writeFile(join(root, 'dist/source.png'), 'extra');
    const config = { assets: ['./', './index.html'], integrity: {'./index.html': 'sha256-' + createHash('sha256').update('app').digest('base64')} };
    const worker = () => 'const CONFIG = ' + JSON.stringify(config) + ';\n';
    await writeFile(join(root, 'dist/sw.js'), worker());
    config.assets.push('./../public/source.png');
    await writeFile(join(root, 'dist/sw.js'), worker());
    await expect(promisify(execFile)(process.execPath, [finalize], {cwd:root})).rejects.toThrow();
    expect(existsSync(join(root, 'dist/source.png'))).toBe(true);
    config.assets.pop();
    await writeFile(join(root, 'dist/index.html'), 'corrupted');
    await writeFile(join(root, 'dist/sw.js'), worker());
    await expect(promisify(execFile)(process.execPath, [finalize], {cwd:root})).rejects.toThrow();
    expect(existsSync(join(root, 'dist/source.png'))).toBe(true);
    await writeFile(join(root, 'dist/index.html'), 'app');
    await writeFile(join(root, 'dist/sw.js'), worker());
    await promisify(execFile)(process.execPath, [finalize], {cwd:root});
    expect(existsSync(join(root, 'dist/source.png'))).toBe(false);
    expect(await readFile(join(root, 'public/source.png'), 'utf8')).toBe('original');
    expect(await readFile(join(root, 'dist/index.html'), 'utf8')).toBe('app');
  } finally { await rm(root, {recursive:true,force:true}); }
});

it.skipIf(!existsSync('dist/sw.js'))('retains all six cats and every runtime frame with original bytes in the production output', () => {
  const worker = readFileSync('dist/sw.js','utf8');
  const config = JSON.parse(worker.split('const CONFIG = ')[1].split(';\n')[0]);
  const manifest = new Set<string>(config.assets);
  const hash = (path:string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const urls = new Set<string>([...Object.values(pageHeaderAssets), ...Object.values(images).map(image=>image.src), './icon-192.png','./icon-512.png']);
  for (const cat of catDefinitions) {
    urls.add(cat.preview);
    for (const sequence of Object.values(cat.animations)) for (const frame of sequence.frames) urls.add(frame.file);
    for (const frame of stretchClip(cat.id)!.frames) urls.add(frame.file);
  }
  for (const clip of interactionClips) { urls.add(clip.sourceManifest); for (const frame of clip.frames) urls.add(frame.file); }
  for (const layer of layout.layers) if (layer.file && layer.id !== 'cat') urls.add('./room/'+layer.file);
  for (const theme of ['day','night']) urls.add(`./room/window_outside_${theme}.png`);
  for (const url of urls) {
    expect(manifest.has(url), url).toBe(true);
    expect(hash('dist/'+url.slice(2)),url).toBe(hash('public/'+url.slice(2)));
  }
  let total=0;
  const visit=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())visit(file);else{total+=statSync(file).size;const url='./'+file.replaceAll('\\','/').slice(5);if(url!=='./sw.js')expect(manifest.has(url),url).toBe(true);}}};
  visit('dist'); expect(total).toBeLessThan(100_000_000);
});
