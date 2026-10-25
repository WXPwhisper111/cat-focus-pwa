// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { mountDataProtectionPanel } from '../src/dev/data-protection-panel';
import { mountAuthTest } from '../src/dev/auth-test-view';
import { protectionFixture } from './data-protection-fixture';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: IDBDatabase;
let dispose: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto);
  db = await protectionFixture('panel-guest');
  document.body.innerHTML = '<main></main>';
});
afterEach(() => { dispose?.(); db.close(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const session = (id: string) => ({ user: { id } } as Session);
function fakeAuth() {
  let changed!: (event: string, value: Session | null) => void;
  const auth = {
    onAuthStateChange: vi.fn(callback => { changed = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  };
  return { auth, change: (id: string | null) => changed('SIGNED_IN', id ? session(id) : null) };
}

it('requires an explicit preview and both confirmations, and clears all A data on a B auth event', async () => {
  const f = fakeAuth(), root = document.querySelector('main')!;
  const open = vi.spyOn(indexedDB, 'open');
  const panel = mountDataProtectionPanel(root, f.auth as unknown as SupabaseClient['auth'], { guestDatabase: 'panel-guest' }); dispose = panel.destroy;
  await Promise.resolve(); await Promise.resolve();
  f.change(A); expect(open).not.toHaveBeenCalled();
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-context-${name}]`)!;
  button('preview').click();
  await vi.waitFor(() => expect(root.querySelector('[data-context-plan]')!.textContent).toContain('records'));
  await vi.waitFor(() => expect(button('preview').disabled).toBe(false));
  expect(button('activate').disabled).toBe(true);
  for (const name of ['backup', 'economy']) {
    const field = root.querySelector<HTMLInputElement>(`[data-context-${name}]`)!;
    field.checked = true; field.dispatchEvent(new Event('change'));
  }
  expect(button('activate').disabled).toBe(false); button('activate').click();
  await vi.waitFor(() => expect(root.querySelector('[data-context-status-text]')!.textContent).toContain('已切换开发工具'));
  f.change(B);
  expect(root.textContent).not.toContain(A);
  expect(root.querySelector('[data-context-plan]')!.textContent).toBe('');
  expect(button('activate').disabled).toBe(true);
  button('read').click();
  await vi.waitFor(() => expect(root.querySelector('[data-context-message]')!.textContent).toContain('尚未确认'));
  f.change(null); expect(button('preview').disabled).toBe(true);
});

it('ignores a stale getSession result and late preview when the account changes', async () => {
  const f = fakeAuth(), root = document.querySelector('main')!;
  let resolve!: (value: unknown) => void;
  f.auth.getSession.mockReturnValue(new Promise(done => { resolve = done; }));
  const panel = mountDataProtectionPanel(root, f.auth as unknown as SupabaseClient['auth'], { guestDatabase: 'panel-guest' }); dispose = panel.destroy;
  f.change(A);
  root.querySelector<HTMLButtonElement>('[data-context-preview]')!.click();
  f.change(B);
  resolve({ data: { session: session(A) }, error: null });
  await new Promise(done => setTimeout(done, 20));
  expect(root.querySelector('[data-context-identity]')!.textContent).toContain(B);
  expect(root.textContent).not.toContain(A);
  expect(root.querySelector('[data-context-plan]')!.textContent).toBe('');
});

it('revokes the protection context before awaiting logout, including failed logout requests', async () => {
  const root = document.querySelector('main')!, suspended = vi.fn();
  let rejectLogout!: (error: Error) => void;
  const auth = {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: A, email: 'test@example.com' } } }, error: null }),
    signOut: vi.fn(() => { expect(suspended).toHaveBeenCalledOnce(); return new Promise((_resolve, reject) => { rejectLogout = reject; }); }),
  };
  dispose = mountAuthTest(root, auth as unknown as SupabaseClient['auth'], { beforeSignOut: suspended });
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('#logout')!.disabled).toBe(false));
  root.querySelector<HTMLButtonElement>('#logout')!.click();
  expect(suspended).toHaveBeenCalledOnce(); rejectLogout(new TypeError('network failure'));
  await vi.waitFor(() => expect(root.querySelector('#message')!.textContent).toContain('网络连接失败'));
});

it('does not revive a suspended context from a pending initial session restore', async () => {
  const f = fakeAuth(), root = document.querySelector('main')!;
  let resolve!: (value: unknown) => void;
  f.auth.getSession.mockReturnValue(new Promise(done => { resolve = done; }));
  const panel = mountDataProtectionPanel(root, f.auth as unknown as SupabaseClient['auth'], { guestDatabase: 'panel-guest' }); dispose = panel.destroy;
  panel.suspend(); resolve({ data: { session: session(A) }, error: null });
  await new Promise(done => setTimeout(done, 20));
  expect(root.querySelector<HTMLButtonElement>('[data-context-preview]')!.disabled).toBe(true);
  expect(root.textContent).not.toContain(A);
});
