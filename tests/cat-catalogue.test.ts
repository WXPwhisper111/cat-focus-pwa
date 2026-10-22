import { expect, it } from 'vitest';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { catDefinitions, frameDuration } from '../src/cat-definition';
import { roomCatRect } from '../src/room-scene';

it('has three distinct real cats, existing mobile paths, calibrated anchors and valid timings', async () => {
  expect(catDefinitions.map(cat => cat.name)).toEqual(['喵呜', '芒果', '橘宝']);
  expect(catDefinitions[0].preview).toContain('/cat-01/');
  expect(catDefinitions).toHaveLength(3); expect(new Set(catDefinitions.map(cat => cat.id)).size).toBe(3);
  for (const cat of catDefinitions) {
    expect(cat.description.length).toBeGreaterThan(0); expect((await stat(join('public', cat.preview))).size).toBeGreaterThan(0);
    for (const state of ['idle', 'sleep_loop'] as const) {
      const sequence = cat.animations[state]; if (!sequence) continue;
      expect(sequence.frames).toHaveLength(state === 'idle' ? 63 : 32);
      let duration = 0;
      for (const [index, frame] of sequence.frames.entries()) {
        expect(frame.file.startsWith('./cat-animation-v2/')).toBe(true);
        expect((await stat(join('public', frame.file))).size).toBeGreaterThan(0);
        expect(frameDuration(sequence, index)).toBeGreaterThan(0); duration += frameDuration(sequence, index);
        const rect = roomCatRect(state, index, cat), anchor = frame.sourceAnchor || cat.feetAnchor;
        expect(rect[0] + anchor[0] * rect[2] / cat.sourceCanvas[0]).toBeCloseTo(512);
        expect(rect[1] + anchor[1] * rect[3] / cat.sourceCanvas[1]).toBeCloseTo(716);
      }
      expect(duration).toBeCloseTo(state === 'idle' ? 9260 : 4800);
    }
  }
});
