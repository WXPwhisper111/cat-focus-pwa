import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import index from '../public/cat-interactions-v2/index.json';
import { getInteractionClip, interactionClips } from '../src/cat-interactions';
import { pointOnCanvas, rectAtAnchor } from '../src/cat-animation';

it('maps the actual V2 manifests: 12 clips / 204 frames, no enter or exit and no crossed cats', async () => {
  expect(interactionClips).toHaveLength(24);
  expect(interactionClips.reduce((sum, clip) => sum + clip.frames.length, 0)).toBe(456);
  for (const entry of index.cats) {
    const manifest = JSON.parse(await readFile(`public/cat-interactions-v2/${entry.manifest}`, 'utf8'));
    for (const [behavior, phases] of Object.entries(manifest.actions)) for (const [phase, value] of Object.entries(phases as Record<string, { frames: { mobileFile: string; durationMs: number }[] }>)) {
      const clip = getInteractionClip(entry.applicationCatId, behavior as 'eat', phase as 'loop')!;
      expect(clip.catId).toBe(entry.applicationCatId);
      expect(clip.frames).toEqual(value.frames.map(frame => ({ file: `./cat-interactions-v2/${entry.id}/${frame.mobileFile}`, durationMs: frame.durationMs })));
      for (const frame of clip.frames) {
        const webp = await readFile(`public/${frame.file.slice(2)}`);
        expect(webp.toString('ascii', 0, 4)).toBe('RIFF'); expect(webp.toString('ascii', 8, 12)).toBe('WEBP');
        const offset = webp.indexOf('VP8L'); expect(offset).toBeGreaterThan(0);
        const bits = webp.readUInt32LE(offset + 9);
        expect((bits & 0x3fff) + 1).toBe(288); expect(((bits >>> 14) & 0x3fff) + 1).toBe(288);
        expect((bits >>> 28) & 1).toBe(1);
      }
    }
    expect(getInteractionClip(entry.applicationCatId, 'eat', 'once')).toBeUndefined();
  }
  expect(getInteractionClip('unknown-cat', 'eat')).toBeUndefined();
});

it('keeps feet anchors distinct from action contact references and reproduces their calibrated geometry', () => {
  for (const clip of interactionClips) {
    expect(clip.feetAnchor).toEqual([627, 1200]);
    expect(pointOnCanvas(clip, clip.feetAnchor, [288, 288])[1]).toBeCloseTo(275.59809, 4);
    if (clip.contact) {
      expect(clip.contact.spritePoint).not.toEqual(clip.feetAnchor);
      if(clip.contact.contactFrame!==undefined)expect(clip.contact.contactFrame).toBeLessThan(clip.frames.length);
      const rect = rectAtAnchor(clip, clip.contact.spritePoint, clip.contact.targetRoomPoint, [144, 144]);
      expect(rect[0]).toBeCloseTo(clip.contact.roomSpriteRect[0], 2);
      expect(rect[1]).toBeCloseTo(clip.contact.roomSpriteRect[1], 2);
      expect(clip.frames.every(frame => !frame.offset && !frame.sourceAnchor)).toBe(true);
    } else expect(clip.behavior).toBe('pet');
  }
});
