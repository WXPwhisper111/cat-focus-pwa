import { createClient } from '@supabase/supabase-js';
import { mountAuthTest } from './auth-test-view';
import { mountDataProtectionPanel } from './data-protection-panel';
import './auth-test.css';

if (import.meta.env.DEV) {
  const root = document.querySelector<HTMLElement>('#auth-test')!;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  // Accept the new public key format only; secret and legacy JWT keys are rejected.
  if (!url || !key?.startsWith('sb_publishable_')) {
    root.textContent = '请在 .env.local 填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY（sb_publishable_ 开头），然后重启开发服务器。切勿填写 Secret Key、service_role、数据库密码或 Resend Key。';
  } else {
    try {
      const client = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'cat-focus-auth-test-session',
        },
      });
      const authRoot = document.createElement('section'), protectionRoot = document.createElement('section');
      root.replaceChildren(authRoot, protectionRoot);
      const protection = mountDataProtectionPanel(protectionRoot, client.auth);
      const dispose = mountAuthTest(authRoot, client.auth, { beforeSignOut: () => protection.suspend() });
      import.meta.hot?.dispose(() => { protection.destroy(); dispose(); });
    } catch {
      root.textContent = '认证初始化失败。请检查项目 URL、公开密钥和浏览器本地存储设置，然后刷新。';
    }
  }
}
