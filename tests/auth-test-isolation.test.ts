import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { authTestDev } from '../scripts/auth-test-dev';

it('only registers the authentication page on the development server', () => {
  const plugin = authTestDev();
  expect(plugin.apply).toBe('serve');
  expect(plugin.configurePreviewServer).toBeUndefined();
});

it('keeps the dev authentication entry and Supabase client out of production assets', () => {
  // Like the existing distribution tests, run against the completed npm run build output.
  function check(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      expect(path).not.toMatch(/auth-test/);
      if (entry.isDirectory()) check(path);
      else if (/\.(js|html|css|json)$/.test(entry.name)) {
        expect(readFileSync(path, 'utf8')).not.toMatch(/auth-test|cat-focus-auth-test-session|supabase|pvmoyaxkraelgdvozcrg/);
      }
    }
  }
  check('dist');
});
