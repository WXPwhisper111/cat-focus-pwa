import { it, expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import images from '../src/install-guide-images.json';
it('maps eight small real WebP files with valid dimensions', async () => {
  expect(Object.keys(images)).toHaveLength(8); let size = 0;
  for (const asset of Object.values(images)) {
    expect(asset.width).toBeLessThanOrEqual(720); expect(asset.height).toBeGreaterThan(0);
    const path = new URL('../public/' + asset.src.slice(2), import.meta.url), data = await readFile(path);
    expect(data.toString('ascii',0,4)).toBe('RIFF'); expect(data.toString('ascii',8,12)).toBe('WEBP');
    size += (await stat(path)).size;
  }
  expect(size).toBeLessThan(300000);
});
