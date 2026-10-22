const { chromium } = require('C:/Users/28262/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const OUT = path.join(__dirname, 'validation');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const width of [390, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 920 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('http://preview.local/**', async route => {
        const requestUrl = new URL(route.request().url());
        const diskPath = path.join(__dirname, '..', '..', requestUrl.pathname.replace(/^\//, ''));
        if (!diskPath.startsWith(path.join(__dirname, '..', '..')) || !fs.existsSync(diskPath)) return route.fulfill({ status: 404 });
        const contentType = ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(diskPath).toLowerCase()] || 'application/octet-stream';
        await route.fulfill({ status: 200, contentType, body: fs.readFileSync(diskPath) });
      });
      await page.goto('http://preview.local/art/cat-interactions-v2/preview.html');
      await page.evaluate(() => window.previewReady);
      await page.evaluate(() => { previewApi.setSpeed(0); previewApi.setAutonomy(false); });
      const dimensions = await page.evaluate(() => previewApi.dimensions());
      assert.strictEqual(dimensions[1], 176);
      await page.screenshot({ path: path.join(OUT, `${width}-idle.png`), fullPage: true });
      for (const id of ['cat-01', 'cat-02', 'cat-03']) {
        for (const action of ['eat', 'drink', 'scratch', 'sleep']) {
          await page.evaluate(async ({ id, action }) => previewApi.command(id, action), { id, action });
          const steps = await page.evaluate(id => {
            const points = [previewApi.snapshot()[id]];
            for (const ms of [110, 109, 1, 110, 110]) { previewApi.advance(ms); points.push(previewApi.snapshot()[id]); }
            return points;
          }, id);
          assert.strictEqual(steps[1].phase, 'fading-out');
          assert(steps[1].opacity > 0 && steps[1].opacity < 1);
          assert.deepStrictEqual(steps[1].rect, steps[0].rect);
          assert.deepStrictEqual(steps[2].rect, steps[0].rect);
          assert.strictEqual(steps[3].opacity, 0);
          assert.strictEqual(steps[3].action, action);
          assert.strictEqual(steps.at(-1).opacity, 1);
          const twoLoops = await page.evaluate(id => {
            previewApi.advance(7000);
            return previewApi.snapshot()[id];
          }, id);
          assert.strictEqual(twoLoops.action, action);
          assert.strictEqual(twoLoops.phase, 'playing');
          await page.evaluate(id => previewApi.setSelected(id), id);
          await page.screenshot({ path: path.join(OUT, `${width}-${id}-${action}.png`), fullPage: true });
          if (id === 'cat-01' && action === 'eat') {
            await page.locator('#room').screenshot({ path: path.join(OUT, `${width}-room-three-cats.png`) });
            await page.locator('#focus').screenshot({ path: path.join(OUT, `${width}-focus-176.png`) });
          }
          await page.evaluate(id => { previewApi.advance(previewApi.snapshot()[id].deadlineMs + 441); }, id);
          const after = await page.evaluate(id => previewApi.snapshot()[id], id);
          assert(after.action === 'idle' || after.phase === 'fading-out');
          await page.evaluate(() => previewApi.advance(450));
        }
        const beforePet = await page.evaluate(id => previewApi.snapshot()[id], id);
        await page.evaluate(async id => previewApi.command(id, 'pet'), id);
        const pet = await page.evaluate(id => previewApi.snapshot()[id], id);
        assert.strictEqual(pet.action, 'pet');
        assert.strictEqual(pet.phase, 'playing');
        assert.deepStrictEqual(pet.rect, beforePet.rect);
        await page.evaluate(() => previewApi.advance(2400));
        const petAfter = await page.evaluate(id => previewApi.snapshot()[id], id);
        assert.strictEqual(petAfter.action, 'idle');
        results.push({ width, id, dimensions, fade: '220/220', actions: 5, pet: 'instant', errors: [...errors] });
      }
      // A user command waits while another user-commanded cat owns the shared food zone.
      await page.evaluate(async () => {
        await previewApi.command('cat-01', 'eat'); previewApi.advance(440);
        await previewApi.command('cat-02', 'drink');
      });
      let occupied = await page.evaluate(() => previewApi.snapshot());
      assert.strictEqual(occupied['cat-02'].pending, 'drink');
      assert.strictEqual(occupied['cat-02'].action, 'idle');
      await page.evaluate(() => previewApi.advance(13000));
      occupied = await page.evaluate(() => previewApi.snapshot());
      assert.strictEqual(occupied['cat-02'].pending, null);
      assert(occupied['cat-02'].phase.startsWith('fading') || occupied['cat-02'].action === 'drink');
      await page.evaluate(() => previewApi.advance(450));
      occupied = await page.evaluate(() => previewApi.snapshot());
      assert.strictEqual(occupied['cat-02'].action, 'drink');
      // Old asynchronous loads cannot replace the final command for one cat.
      const latest = await page.evaluate(async () => {
        const a = previewApi.command('cat-03', 'eat');
        const b = previewApi.command('cat-03', 'scratch');
        const results = await Promise.all([a, b]);
        return { results, state: previewApi.snapshot()['cat-03'] };
      });
      assert.strictEqual(latest.results[0].accepted, false);
      assert.strictEqual(latest.results[1].accepted, true);
      assert.strictEqual(latest.state.pending, null);
      await page.evaluate(() => previewApi.advance(440));
      assert.strictEqual((await page.evaluate(() => previewApi.snapshot()['cat-03'])).action, 'scratch');
      // Hidden-page timing must not include the elapsed time away from the tab.
      const hiddenClock = await page.evaluate(() => {
        const before = previewApi.snapshot()['cat-03'].playheadMs;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        return before;
      });
      await page.waitForTimeout(350);
      const afterHidden = await page.evaluate(() => {
        const value = previewApi.snapshot()['cat-03'].playheadMs;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        return value;
      });
      assert.strictEqual(afterHidden, hiddenClock);
      await page.evaluate(() => { previewApi.advance(120000); previewApi.setAutonomy(true); previewApi.advance(41000); });
      await page.waitForTimeout(200);
      const autonomous = await page.evaluate(() => previewApi.snapshot());
      results.push({ width, autonomous: Object.fromEntries(Object.entries(autonomous).map(([id, cat]) => [id, { action: cat.action, zone: cat.zone, phase: cat.phase }])) });
      assert(Object.values(autonomous).every(cat => cat.mode !== 'manual'));
      assert(Object.values(autonomous).some(cat => cat.action !== 'idle' || cat.phase.startsWith('fading')));
      await page.evaluate(() => previewApi.advance(440));
      const autonomousActive = await page.evaluate(() => previewApi.snapshot());
      const owner = Object.entries(autonomousActive).find(([, cat]) => cat.zone !== 'activity' && cat.mode === 'autonomous');
      assert(owner, 'expected at least one autonomous cat in a functional zone');
      const challenger = ['cat-01', 'cat-02', 'cat-03'].find(id => id !== owner[0] && autonomousActive[id].zone === 'activity');
      assert(challenger);
      await page.evaluate(async ({ challenger, action }) => previewApi.command(challenger, action), { challenger, action: owner[1].action });
      const yielding = await page.evaluate(() => previewApi.snapshot());
      assert.strictEqual(yielding[challenger].pending, owner[1].action);
      assert.strictEqual(yielding[owner[0]].phase, 'fading-out');
      await page.evaluate(() => previewApi.advance(450));
      const yielded = await page.evaluate(() => previewApi.snapshot());
      assert.strictEqual(yielded[owner[0]].zone, 'activity');
      assert.strictEqual(yielded[challenger].pending, null);
      // A fresh preview verifies that a failed target-frame load leaves the current sprite untouched.
      const failurePage = await browser.newPage({ viewport: { width, height: 920 } });
      await failurePage.route('http://preview.local/**', async route => {
        const diskPath = path.join(__dirname, '..', '..', new URL(route.request().url()).pathname.replace(/^\//, ''));
        if (!fs.existsSync(diskPath)) return route.fulfill({ status: 404 });
        const contentType = ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(diskPath).toLowerCase()] || 'application/octet-stream';
        await route.fulfill({ status: 200, contentType, body: fs.readFileSync(diskPath) });
      });
      await failurePage.route('**/cat-01/mobile/scratch/loop/loop_001.webp', route => route.fulfill({ status: 404 }));
      await failurePage.goto('http://preview.local/art/cat-interactions-v2/preview.html');
      await failurePage.evaluate(() => window.previewReady);
      const failed = await failurePage.evaluate(async () => {
        const before = previewApi.snapshot()['cat-01'];
        const result = await previewApi.command('cat-01', 'scratch');
        return { before, result, after: previewApi.snapshot()['cat-01'], error: previewApi.error() };
      });
      assert.strictEqual(failed.result.accepted, false);
      assert.strictEqual(failed.after.action, failed.before.action);
      assert.deepStrictEqual(failed.after.rect, failed.before.rect);
      assert.strictEqual(failed.after.opacity, 1);
      assert(failed.error.includes('资源加载失败'));
      await failurePage.close();
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
