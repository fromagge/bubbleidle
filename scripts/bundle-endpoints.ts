// Download the current editor JS bundles and list every appeditor endpoint they reference.
// Use it to spot new/removed endpoints after Bubble ships an editor update.
//
//   node scripts/bundle-endpoints.ts            # prints endpoint names
//   node scripts/bundle-endpoints.ts --grep write   # prints code context around a string
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openBrowser, ensureSession, editorUrl, env, DATA_DIR } from '../src/session.ts';

const grepIdx = process.argv.indexOf('--grep');
const needle = grepIdx > 0 ? process.argv[grepIdx + 1] : undefined;
const dir = join(DATA_DIR, 'bundles');
mkdirSync(dir, { recursive: true });

const { browser, ctx, page } = await openBrowser();
const bundles: string[] = [];
page.on('response', async (r) => {
  const m = /\/package\/((?:early_|pre_)?edit(?:_optional)?_js)\//.exec(r.url());
  if (!m) return;
  const f = join(dir, `${m[1]}.js`);
  writeFileSync(f, await r.text());
  bundles.push(f);
});
try {
  await ensureSession(page);
  await page.goto(editorUrl(env.appId!), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
} finally { await ctx.close(); await browser.close(); }

const { readFileSync } = await import('node:fs');
const src = bundles.map((f) => readFileSync(f, 'utf8')).join('\n');
if (needle) {
  let i = -1, n = 0;
  while ((i = src.indexOf(needle, i + 1)) >= 0 && n++ < 5) console.log('----\n' + src.slice(Math.max(0, i - 800), i + 600));
} else {
  console.log([...new Set([...src.matchAll(/server:\/\/appeditor\/([a-zA-Z0-9_]+)/g)].map((m) => m[1]))].sort().join('\n'));
}
console.error(`bundles saved in ${dir}`);
