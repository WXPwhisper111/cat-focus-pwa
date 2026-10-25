// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { authErrorMessage, mountAuthTest } from '../src/dev/auth-test-view';

const session = { user: { id: 'same-user-uid', email: 'test@example.com' } } as Session;
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); document.body.replaceChildren(); vi.useRealTimers(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
async function fixture(saved: Session | null = null) {
  document.body.innerHTML = '<main></main>';
  const root = document.querySelector('main')!;
  let listener!: (_event: string, next: Session | null) => void;
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: saved }, error: null }),
    onAuthStateChange: vi.fn(callback => { listener = callback; return { data: { subscription: { unsubscribe } } }; }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  cleanup = mountAuthTest(root, auth as unknown as SupabaseClient['auth']);
  await flush();
  const input = (id: string, value: string) => { root.querySelector<HTMLInputElement>(`#${id}`)!.value = value; };
  const submit = (id: string) => root.querySelector(`#${id}`)!.dispatchEvent(new Event('submit', { cancelable: true }));
  return { root, auth, input, submit, unsubscribe, change: (next: Session | null) => listener('SIGNED_OUT', next) };
}
it('sends OTP once, validates six digits, logs in, and signs out only this session', async () => {
  const f = await fixture();
  f.input('email', 'test@example.com');
  f.submit('email-form'); f.submit('email-form'); await flush();
  expect(f.auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({ email: 'test@example.com', options: { shouldCreateUser: true } });
  expect(f.root.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
  f.input('code', '12345'); f.submit('code-form'); await flush();
  expect(f.auth.verifyOtp).not.toHaveBeenCalled();
  f.input('code', '123456'); f.submit('code-form'); await flush();
  expect(f.auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ email: 'test@example.com', token: '123456', type: 'email' });
  expect(f.root.querySelector('#session-uid')!.textContent).toBe(session.user.id);
  expect(f.root.querySelector<HTMLInputElement>('#code')!.value).toBe('');
  f.root.querySelector<HTMLButtonElement>('#logout')!.click(); await flush();
  expect(f.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  expect(f.root.querySelector('#session-uid')!.textContent).toBe('—');
});
it('restores SDK session and responds to auth events without exposing tokens', async () => {
  const f = await fixture(session);
  expect(f.root.querySelector('#session-email')!.textContent).toBe('test@example.com');
  expect(f.root.querySelector('#session-uid')!.textContent).toBe('same-user-uid');
  f.change(null);
  expect(f.root.querySelector('#session-status')!.textContent).toBe('未登录');
  cleanup!();
  expect(f.unsubscribe).toHaveBeenCalled();
});
it('recovers controls after invalid OTP and network errors; failed signout retains session', async () => {
  const f = await fixture();
  f.input('email', 'test@example.com'); f.input('code', '123456');
  f.auth.verifyOtp.mockResolvedValueOnce({ data: { session }, error: { code: 'otp_expired' } } as never);
  f.submit('code-form'); await flush();
  expect(f.root.querySelector('#message')!.textContent).toContain('验证码错误或已过期');
  expect(f.root.querySelector<HTMLButtonElement>('#verify')!.disabled).toBe(false);
  f.auth.signInWithOtp.mockRejectedValueOnce(new TypeError('private raw details'));
  f.submit('email-form'); await flush();
  expect(f.root.querySelector('#message')!.textContent).toContain('网络连接失败');
  expect(f.root.textContent).not.toContain('private raw details');
  f.change(session);
  f.auth.signOut.mockResolvedValueOnce({ error: { status: 500 } } as never);
  f.root.querySelector<HTMLButtonElement>('#logout')!.click(); await flush();
  expect(f.root.querySelector('#session-uid')!.textContent).toBe('same-user-uid');
});
it('blocks duplicate sends for 60 seconds and handles server rate limits', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  f.input('email', 'test@example.com');
  f.auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 429 } } as never);
  f.submit('email-form'); await flush();
  expect(f.root.querySelector('#message')!.textContent).toContain('过于频繁');
  vi.advanceTimersByTime(60_000);
  expect(f.root.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(false);
});
it('does not enable login if persisted session restoration fails', async () => {
  const f = await fixture(); cleanup!();
  f.auth.getSession.mockRejectedValueOnce(new TypeError('storage unavailable'));
  cleanup = mountAuthTest(f.root, f.auth as unknown as SupabaseClient['auth']);
  await flush();
  expect(f.root.querySelector('#session-status')!.textContent).toContain('会话恢复失败');
  expect(f.root.querySelector<HTMLButtonElement>('#verify')!.disabled).toBe(true);
});
it('maps safe errors without echoing raw messages', () => {
  expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('过于频繁');
  expect(authErrorMessage({ code: 'validation_failed' })).toContain('格式不正确');
  expect(authErrorMessage({ message: 'secret detail' })).not.toContain('secret detail');
});
