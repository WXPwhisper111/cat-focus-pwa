import type { SupabaseClient, Session } from '@supabase/supabase-js';

type Auth = SupabaseClient['auth'];

export function authErrorMessage(error: unknown): string {
  const value = error as { code?: string; status?: number; name?: string } | null;
  if (value?.status === 429 || value?.code?.includes('rate_limit')) return '发送或验证过于频繁，请稍后再试。不要连续发送验证码。';
  if (value?.code === 'otp_expired') return '验证码错误或已过期。请核对最新验证码；超过 600 秒请重新发送。';
  if (value?.code === 'validation_failed' || value?.code === 'email_address_invalid') return '邮箱或验证码格式不正确，请检查输入。';
  if (value?.name === 'AuthRetryableFetchError' || error instanceof TypeError || value?.status === 0) return '网络连接失败，请检查网络后重试。';
  if (value?.status && value.status >= 500) return '认证服务暂时不可用，请稍后重试。';
  return '操作失败，请检查邮箱、最新验证码和公开配置后重试；也可在 Supabase Auth 日志中检查原因。';
}

export function mountAuthTest(root: HTMLElement, auth: Auth): () => void {
  root.innerHTML = `
    <h1>邮箱认证测试</h1>
    <p>仅开发环境 · 不同步业务数据，不读取专注与猫咪数据。</p>
    <form id="email-form">
      <label for="email">邮箱</label>
      <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com">
      <button id="send" type="submit">发送验证码</button>
    </form>
    <form id="code-form">
      <label for="code">六位数字验证码</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required aria-describedby="code-hint">
      <p id="code-hint">填写当前邮箱收到的最新验证码，600 秒内有效。每台设备分别发送、验证，不复用验证码。</p>
      <button id="verify" type="submit">验证并登录</button>
    </form>
    <p id="message" role="status" aria-live="polite"></p>
    <section aria-label="当前会话"><h2>当前会话</h2><dl>
      <dt>状态</dt><dd id="session-status">正在恢复会话…</dd>
      <dt>登录邮箱</dt><dd id="session-email">—</dd>
      <dt>用户 UID</dt><dd id="session-uid">—</dd>
    </dl><button id="logout" type="button" disabled>退出本设备登录</button></section>
    <p>相同邮箱在电脑、手机分别登录后，核对 UID。刷新应保持登录；本设备退出后，另一台设备应保持登录。同一浏览器、同一地址的标签页共享会话。</p>`;
  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const email = el<HTMLInputElement>('email');
  const code = el<HTMLInputElement>('code');
  const send = el<HTMLButtonElement>('send');
  const verify = el<HTMLButtonElement>('verify');
  const logout = el<HTMLButtonElement>('logout');
  const message = el('message');
  let session: Session | null = null;
  let busy = true;
  let ready = false;
  let cooldown = 0;
  let disposed = false;
  let revision = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function controls() {
    email.disabled = busy || !!session || !ready;
    code.disabled = busy || !!session || !ready;
    send.disabled = busy || !!session || cooldown > 0 || !ready;
    verify.disabled = busy || !!session || !ready;
    logout.disabled = busy || !session;
    send.textContent = cooldown > 0 ? `重新发送（${cooldown} 秒）` : '发送验证码';
    root.setAttribute('aria-busy', String(busy));
  }
  function render(next: Session | null) {
    session = next;
    el('session-status').textContent = next ? '已登录（SDK 自动持久化会话）' : '未登录';
    el('session-email').textContent = next?.user.email ?? '—';
    el('session-uid').textContent = next?.user.id ?? '—';
    if (next) code.value = '';
    controls();
  }
  function report(text: string, error = false) {
    message.textContent = text;
    message.dataset.error = String(error);
  }
  async function run(action: () => Promise<void>) {
    if (busy || !ready) return;
    busy = true;
    report('处理中…');
    controls();
    try { await action(); }
    catch (error) { if (!disposed) report(authErrorMessage(error), true); }
    finally { busy = false; if (!disposed) controls(); }
  }
  function startCooldown() {
    cooldown = 60;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      cooldown = Math.max(0, cooldown - 1);
      controls();
      if (!cooldown) clearInterval(timer);
    }, 1000);
  }
  const emailForm = el<HTMLFormElement>('email-form');
  const codeForm = el<HTMLFormElement>('code-form');
  function onSend(event: Event) {
    event.preventDefault();
    if (cooldown || session || !emailForm.reportValidity()) return;
    const address = email.value.trim();
    void run(async () => {
      const { error } = await auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
      if (error) { if (error.status === 429) startCooldown(); throw error; }
      startCooldown();
      report('验证码请求已发送，请查收邮箱（含垃圾箱），600 秒内完成验证。');
      code.focus();
    });
  }
  function onVerify(event: Event) {
    event.preventDefault();
    if (session || !emailForm.reportValidity() || !codeForm.reportValidity()) return;
    const address = email.value.trim();
    const token = code.value.trim();
    if (!/^[0-9]{6}$/.test(token)) { report('请输入六位数字验证码。', true); return; }
    void run(async () => {
      const { data, error } = await auth.verifyOtp({ email: address, token, type: 'email' });
      code.value = '';
      if (error) throw error;
      if (!data.session) throw new Error('Missing session');
      render(data.session);
      report('登录成功。请记录 UID，并刷新页面检查会话恢复。');
    });
  }
  function onLogout() {
    void run(async () => {
      const { error } = await auth.signOut({ scope: 'local' });
      if (error) throw error;
      render(null);
      code.value = '';
      report('本设备已退出。另一台设备应保持登录；可刷新两端检查。');
    });
  }
  emailForm.addEventListener('submit', onSend);
  codeForm.addEventListener('submit', onVerify);
  logout.addEventListener('click', onLogout);
  const { data: { subscription } } = auth.onAuthStateChange((_event, next) => {
    revision++;
    if (!disposed) render(next);
  });
  const initialRevision = revision;
  void (async () => {
    try {
      const { data, error } = await auth.getSession();
      if (disposed) return;
      if (error) throw error;
      if (revision === initialRevision) render(data.session);
      ready = true;
    } catch (error) {
      if (disposed) return;
      el('session-status').textContent = '会话恢复失败，请检查网络和本地存储后刷新';
      report(authErrorMessage(error), true);
    } finally { busy = false; if (!disposed) controls(); }
  })();
  controls();
  return () => {
    disposed = true;
    subscription.unsubscribe();
    clearInterval(timer);
    emailForm.removeEventListener('submit', onSend);
    codeForm.removeEventListener('submit', onVerify);
    logout.removeEventListener('click', onLogout);
  };
}
