import type { Plugin } from 'vite';

// No HTML file or application import: this entry exists only on the dev server.
export function authTestDev(): Plugin {
  return {
    name: 'auth-test-dev-only',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/auth-test' && path !== '/auth-test/') return next();
        try {
          const html = await server.transformIndexHtml('/auth-test', `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>邮箱认证测试 · 猫咪专注伙伴</title></head>
<body><main id="auth-test"></main><script type="module" src="/src/dev/auth-test.ts"></script></body></html>`);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        } catch (error) { next(error); }
      });
    },
  };
}
