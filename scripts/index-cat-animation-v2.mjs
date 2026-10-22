// Rebuild the runtime index from delivered V2 manifests; do not regenerate artwork.
import { readFile, writeFile, access } from 'node:fs/promises';
const cats = {};
for (const id of ['cat-01', 'cat-02', 'cat-03']) {
  const manifest = JSON.parse(await readFile(`public/cat-animation-v2/${id}/animations.json`, 'utf8'));
  const anchor = manifest.feetAnchor;
  const animations = {};
  for (const [state, sequence] of Object.entries(manifest.animations)) {
    const frames = [];
    for (const frame of sequence.frames) {
      const file = `./cat-animation-v2/${id}/${frame.mobileFile}`;
      await access(`public/${file}`);
      frames.push({ file, durationMs: frame.durationMs, sourceAnchor: anchor,
        offset: [(627 - anchor[0]) * 144 / 1254, (1254 - anchor[1]) * 144 / 1254] });
    }
    const duration = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    if (duration !== sequence.cycleDurationMs || frames.length !== sequence.frameCount) throw Error(`Invalid sequence: ${id}/${state}`);
    animations[state] = { fps: frames.length * 1000 / duration, frames };
  }
  cats[id] = { sourceCanvas: manifest.canvas, feetAnchor: anchor, animations };
}
await writeFile('art/cat-animation-v2/runtime-cats.json', JSON.stringify(cats, null, 2) + '\n');
