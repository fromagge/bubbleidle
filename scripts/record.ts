// Record what the editor does over the wire, to map new features or re-verify after Bubble changes.
//
//   node scripts/record.ts [--headed] [--tab Design] [--page index] [--seconds 120] [--name mything]
//
// --headed opens a visible Chromium (logged in as the bot) so a human can click around; without it the
// editor loads headless and you can script actions below. Writes .state/har/<name>.har and prints a
// summary of every /appeditor call with request/response bodies (write calls in full).
import { join } from 'node:path';
import { openBrowser, ensureSession, editorUrl, env, DATA_DIR } from '../src/session.ts';
import { mkdirSync } from 'node:fs';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? 'true'); };
const headed = process.argv.includes('--headed');
const tab = arg('tab', 'Design')!, pageName = arg('page', 'index')!, seconds = Number(arg('seconds', headed ? '120' : '15'));
const name = arg('name', `rec-${Date.now()}`)!;
const app = arg('app', env.appId);
if (!app) throw new Error('set BUBBLE_APP_ID or pass --app');

mkdirSync(join(DATA_DIR, 'har'), { recursive: true });
const harPath = join(DATA_DIR, 'har', `${name}.har`);
const { browser, ctx, page } = await openBrowser({ headless: !headed, harPath });
const calls: { endpoint: string; req?: string; resp?: string }[] = [];
page.on('response', async (r) => {
  const m = /\/appeditor\/([a-z_]+)/.exec(r.url());
  if (!m) return;
  const full = m[1] === 'write';
  const clip = (s = '') => (full ? s : s.slice(0, 300));
  calls.push({ endpoint: m[1], req: clip(r.request().postData() ?? ''), resp: clip(await r.text().catch(() => '')) });
});

try {
  await ensureSession(page);
  await page.goto(editorUrl(app, tab, pageName), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  console.error(headed ? `Editor open. Do your thing; recording for ${seconds}s...` : `Recording ${seconds}s headless...`);
  await page.waitForTimeout(seconds * 1000);
} finally {
  await ctx.close();
  await browser.close();
}

const noisy = new Set(['has_ever_trialed', 'calculate_derived', 'get_font_list', 'get_available_plans']);
for (const c of calls) {
  if (noisy.has(c.endpoint)) continue;
  console.log(`\n### ${c.endpoint}\nREQ  ${c.req}\nRESP ${c.resp}`);
}
console.error(`\nHAR saved: ${harPath}  (contains session cookies — never commit it)`);
