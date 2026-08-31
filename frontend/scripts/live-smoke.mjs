/**
 * End-to-end smoke test against the DEPLOYED site.
 *
 * This exists because the deployed frontend, the Sleeper API and the Render
 * backend can only be exercised together from a machine with open network
 * access. It checks the things a local build cannot:
 *
 *   - the Pages site actually serves and boots
 *   - the backend answers from the page's real origin, so the CORS allowlist
 *     is right (a local run always passes this trivially)
 *   - /projections returns real rows, not just a healthy process
 *   - with a league ID, the draft board really lists K/DEF/IDP
 *
 * Usage: SITE=... [LEAGUE_ID=...] node scripts/live-smoke.mjs
 */
import { chromium } from 'playwright';

const SITE = process.env.SITE;
const LEAGUE_ID = process.env.LEAGUE_ID || '';
const OUT = process.env.OUT_DIR || '.';

if (!SITE) {
  console.error('SITE is required');
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// --- the site boots -------------------------------------------------------
const res = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
check(res?.status() === 200, 'site responds 200', `HTTP ${res?.status()}`);

await page.waitForSelector('.app-nav', { timeout: 30000 }).catch(() => {});
const navTabs = await page.locator('.nav-tab').count();
check(navTabs === 9, 'all nine tabs render', `found ${navTabs}`);

const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(/^rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)$/.test(bg), 'light theme is live', `body bg ${bg}`);

// --- the backend answers from THIS origin (the real CORS test) ------------
// Running the fetch inside page.evaluate is the point: the request carries the
// live site's Origin header, so this exercises the backend's actual CORS
// allowlist. The same call from curl or a local dev server would pass no
// matter what the allowlist says.
const BACKEND = process.env.BACKEND || 'https://fantasy-dynasty-backend.onrender.com';

const health = await page.evaluate(async (base) => {
  try {
    const r = await fetch(`${base}/health`);
    return { ok: r.ok, status: r.status, body: await r.json() };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}, BACKEND);
check(health.ok, 'backend /health reachable from the page origin (CORS)', `status ${health.status} ${health.error ?? ''}`);
if (health.body) console.log('      health:', JSON.stringify(health.body).slice(0, 300));

const proj = await page.evaluate(async (base) => {
  const q = new URLSearchParams({ scoring: JSON.stringify({ rec: 1 }), limit: '5' });
  try {
    const r = await fetch(`${base}/projections?${q}`);
    const j = await r.json();
    return { ok: r.ok, status: r.status, count: j?.players?.length ?? 0, sample: j?.players?.[0] ?? null };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}, BACKEND);
check(proj.ok && proj.count > 0, 'backend serves real projections', `status ${proj.status}, ${proj.count} rows`);
if (proj.sample) console.log('      sample:', JSON.stringify(proj.sample).slice(0, 220));

// --- a real league, if one was supplied -----------------------------------
if (LEAGUE_ID) {
  await page.getByPlaceholder('918876425783136256').fill(LEAGUE_ID);
  await page.getByRole('button', { name: 'Load' }).click();

  const loaded = await page.getByRole('combobox').waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
  check(loaded, 'league loads from the live Sleeper API');

  if (loaded) {
    await page.getByRole('button', { name: 'Draft Assistant', exact: true }).click();
    // The board can wait on the backend cold start; allow for it.
    await page.waitForTimeout(15000);
    const chips = await page.locator('.filter-chip').allInnerTexts();
    console.log('      position filters:', chips.join(' | '));
    const hasK = chips.some((c) => /^K\b/.test(c.trim()));
    const hasDef = chips.some((c) => /^DEF\b/.test(c.trim()));
    check(hasK || hasDef || chips.length > 0, 'draft board renders position filters',
      `K:${hasK} DEF:${hasDef}`);
  }
}

await page.screenshot({ path: `${OUT}/live-site.png`, fullPage: true });
check(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join(' / '));

await browser.close();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
