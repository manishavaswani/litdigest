/* LitDigest — tests/e2e.js
 * Browser e2e with Playwright + system Chromium (dev harness, not shipped).
 *   node tests/e2e.js          (serves the folder on :8765 itself)
 * Flow: open app -> add topic -> add AMJ from starter list + resolve a real
 * journal via OpenAlex -> generate digest with live API data -> verify cards
 * render -> export email HTML -> print view (emulated print media).
 * Fails on any JS/page error or unexpected console error; network console
 * messages caused by this sandbox's rate-limited egress IP (OpenAlex 429,
 * arXiv CORS relay failures) are reported separately.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function serve(root, port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

/* Console messages known to be caused by this sandbox's shared egress IP
 * (OpenAlex daily quota exhausted -> HTTP 429; arXiv has no CORS headers and
 * public relays are rate-limited here). The app handles all of these
 * gracefully; they are not JS defects. */
const ENV_NOISE = /Failed to load resource: the server responded with a status of (429|401|403|500|502|522)|Failed to load resource: net::ERR_FAILED|CORS|api\.allorigins|api\.cors\.lol|corsproxy\.io/;

(async () => {
  const root = path.resolve(__dirname, '..');
  const srv = await serve(root, 8765);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const envNoise = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') { return; }
    if (ENV_NOISE.test(msg.text())) { envNoise.push(msg.text()); } else { consoleErrors.push(msg.text()); }
  });
  page.on('pageerror', (err) => { consoleErrors.push('pageerror: ' + err.message); });

  let failures = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log('PASS  ' + name); }
    else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); }
  };

  await page.goto('http://127.0.0.1:8765/index.html');
  await page.waitForTimeout(500);
  check('page loads with title', (await page.title()).includes('LitDigest'));

  // --- Sources & Topics: add topics and journals ---
  await page.click('#tab-sources');
  await page.fill('#topics-input', 'strategic management\ncorporate governance');
  await page.waitForTimeout(700); // debounce

  await page.click('#starter-groups .chip:not(.added)'); // AMJ
  await page.waitForTimeout(200);
  const tracked = await page.locator('#tracked-list li').count();
  check('starter journal added to tracked list', tracked === 1, 'tracked=' + tracked);
  check('tracked journal shows ISSN', /ISSN 0001-4273/.test(await page.locator('#tracked-list').innerText()));

  // Journal resolution via OpenAlex sources API (live)
  await page.fill('#journal-query', 'Strategic Management Journal');
  await page.click('#journal-resolve');
  await page.waitForTimeout(4500);
  const candCount = await page.locator('#journal-candidates .candidate-card').count();
  if (candCount > 0) {
    check('journal resolution returns candidates (live OpenAlex)', true);
    await page.click('#journal-candidates .candidate-card .btn:not([disabled])');
    await page.waitForTimeout(200);
    check('resolved journal confirmed & tracked', (await page.locator('#tracked-list li').count()) === 2);
  } else {
    const status = await page.locator('#journal-resolve-status').innerText();
    const err = await page.locator('#sources-error').innerText().catch(() => '');
    console.log('WARN  journal resolution unavailable from this IP (' + (err || status) + ') — UI error path exercised');
    check('journal resolution fails gracefully when rate-limited', /fail|No journal|429/i.test(err + status));
  }

  // Toggle an arXiv category
  await page.click('#arxiv-groups .chip'); // econ.GN
  await page.waitForTimeout(200);

  // --- Digest: generate with live data ---
  await page.click('#tab-digest');
  await page.selectOption('#digest-days', '30');
  await page.click('#digest-run');
  await page.waitForSelector('#digest-results:not(.hidden)', { timeout: 120000 });
  await page.waitForFunction(() => {
    const btn = document.getElementById('digest-run');
    return btn && !btn.disabled;
  }, { timeout: 120000 });

  const cards = await page.locator('#newsletter-output .nl-card').count();
  check('newsletter renders paper cards', cards > 0, 'cards=' + cards);
  check('masthead shows newsletter title', (await page.locator('#newsletter-output .nl-title').innerText()).length > 0);
  check('stats strip present', /new paper/.test(await page.locator('#newsletter-output .nl-stats').innerText()));
  check('cards have Read paper links', (await page.locator('#newsletter-output .nl-card a.nl-card-link').count()) > 0);
  const sections = await page.locator('#newsletter-output .nl-section-heading').allInnerTexts();
  check('section headings render', sections.length > 0, sections.join(' | '));
  console.log('INFO  sections:', sections.join(' | '), '| cards:', cards);

  // --- Export email HTML ---
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#digest-export-email')
  ]);
  const out = path.join(__dirname, '.e2e-export.html');
  await download.saveAs(out);
  const html = fs.readFileSync(out, 'utf8');
  check('exported HTML self-contained (no script/link tags)', !/<script|<link/i.test(html));
  check('exported HTML has inline styles', (html.match(/style="/g) || []).length > 10);
  check('exported HTML external URLs are only paper links', ((html.match(/(?:src|href)="([^"]+)"/g) || [])
    .map(m => m.replace(/^(?:src|href)="/, '').replace(/"$/, ''))
    .filter(u => /^https?:/i.test(u))
    .every(u => /^https:\/\/(doi\.org|arxiv\.org)/.test(u))));
  fs.unlinkSync(out);

  // --- Print view (emulated print media): newsletter visible, chrome hidden ---
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const pv = await page.evaluate(() => ({
    header: getComputedStyle(document.querySelector('.site-header')).display,
    tabs: getComputedStyle(document.querySelector('.tab-bar')).display,
    controls: getComputedStyle(document.querySelector('.digest-controls')).display,
    newsletter: getComputedStyle(document.getElementById('newsletter-output')).display
  }));
  check('print view hides app chrome', pv.header === 'none' && pv.tabs === 'none' && pv.controls === 'none', JSON.stringify(pv));
  check('print view keeps newsletter visible', pv.newsletter !== 'none');
  await page.emulateMedia({ media: 'screen' });
  const printOk = await page.evaluate(() => { try { window.print(); return true; } catch (e) { return false; } });
  check('window.print() callable', printOk === true);

  // --- History saved ---
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('litdigest.history.v1') || '[]'));
  check('digest saved to history', hist.length === 1 && !!(hist[0].digest && hist[0].digest.sections), 'hist=' + hist.length);

  // --- Console errors ---
  if (envNoise.length) {
    console.log('INFO  environment-caused network console messages (handled gracefully, not JS errors): ' + envNoise.length);
  }
  check('zero JS/page errors and zero unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();
  srv.close();
  console.log(failures === 0 ? '\nE2E passed.' : '\n' + failures + ' E2E FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E crashed:', e); process.exit(1); });
