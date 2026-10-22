const { chromium } = require('C:/Users/28262/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'validation', 'mobile-review');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const resultsPath = path.join(OUT, 'results.json');
  const results = process.argv.includes('--430-only') && fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : [];
  try {
    const widths = process.argv.includes('--430-only') ? [430] : [390, 430];
    for (const viewportWidth of widths) {
      const page = await browser.newPage({ viewport: { width: viewportWidth, height: 980 }, deviceScaleFactor: 1 });
      await page.route('http://preview.local/**', async route => {
        const requestUrl = new URL(route.request().url());
        const diskPath = path.join(__dirname, '..', '..', requestUrl.pathname.replace(/^\//, ''));
        if (!diskPath.startsWith(path.join(__dirname, '..', '..')) || !fs.existsSync(diskPath)) return route.fulfill({ status: 404 });
        const extension = path.extname(diskPath).toLowerCase();
        const contentType = ({ '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' })[extension] || 'application/octet-stream';
        await route.fulfill({ status: 200, contentType, body: fs.readFileSync(diskPath) });
      });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://preview.local/art/cat-interactions-v1/preview.html');
      await page.evaluate(() => window.previewReady);
      const sizes = await page.evaluate(() => window.previewApi.dimensions());
      if (sizes[1] !== 176) throw Error(`Focus card wrong size: ${sizes}`);
      for (const cat of ['cat-01', 'cat-02', 'cat-03']) {
        for (const action of ['eat', 'drink', 'scratch', 'pet']) {
          const duration = await page.evaluate(({ cat, action }) => window.previewApi.set({ cat, action }), { cat, action });
          const events = await page.evaluate(({ action }) => {
            const api = window.previewApi;
            const checkpoints = action === 'pet' ? [0, 450, 900, 1350, 1800, 2399] : [0, 750, 1100, 1700, 2450, 3550, api.duration() - 1];
            return checkpoints.map(t => api.sample(t));
          }, { action });
          if (events.some(e => e.cat !== cat || e.action !== action)) throw Error(`Playback events mismatch ${cat}/${action}`);
          // Observe the complete enter → two-loop → exit timeline in real time.
          await page.evaluate(() => window.previewApi.resume());
          await page.waitForTimeout(duration + 100);
          if (action === 'pet') {
            // A second click should start from the same approved idle pose.
            await page.evaluate(() => window.previewApi.resume());
            await page.waitForTimeout(duration + 80);
          }
          const peak = action === 'pet' ? 1050 : action === 'scratch' ? 1250 : 1550;
          await page.evaluate(t => window.previewApi.sample(t), peak);
          await page.screenshot({ path: path.join(OUT, `${viewportWidth}-${cat}-${action}.png`), fullPage: true });
          results.push({ viewportWidth, cat, action, durationMs: duration, roomWidth: sizes[0], focusWidth: sizes[1], checkpoints: events.map(e => `${e.segment}:${e.index+1}`), errors: [...errors] });
          if (errors.length) throw Error(`Page errors ${cat}/${action}: ${errors.join('; ')}`);
          console.log(`${viewportWidth} ${cat} ${action} ${duration}ms OK`);
        }
      }
      await page.close();
    }
  } finally {
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
