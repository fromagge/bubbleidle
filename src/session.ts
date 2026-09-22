// Config + browser session. The browser is only used to log in (and for screenshots / re-recording);
// everything else goes over plain HTTP in client.ts using the cookies saved here.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { config } from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REPO_DIR = join(import.meta.dirname, '..');

// Config precedence: real env vars > $BUBBLEIDLE_ENV > <repo>/.env > ~/.config/bubbleidle/.env
for (const f of [process.env.BUBBLEIDLE_ENV, join(REPO_DIR, '.env'), join(homedir(), '.config/bubbleidle/.env')]) {
  if (f && existsSync(f)) config({ path: f, quiet: true });
}

export const DATA_DIR = process.env.BUBBLEIDLE_STATE ?? join(REPO_DIR, '.state');
export const STATE_FILE = join(DATA_DIR, 'storage-state.json');
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const env = {
  email: process.env.BUBBLE_EMAIL ?? '',
  password: process.env.BUBBLE_PASSWORD ?? '',
  appId: process.env.BUBBLE_APP_ID && process.env.BUBBLE_APP_ID !== '...' ? process.env.BUBBLE_APP_ID : undefined,
  version: process.env.BUBBLE_VERSION ?? 'test',
};

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']) {
    if (existsSync(p)) return p;
  }
  return undefined; // falls back to a Playwright-managed browser (`npx playwright install chromium`)
}

export interface OpenOpts {
  headless?: boolean;
  harPath?: string;
}

export async function openBrowser(opts: OpenOpts = {}): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: opts.headless ?? true });
  const ctx = await browser.newContext({
    storageState: existsSync(STATE_FILE) ? STATE_FILE : undefined,
    viewport: { width: 1600, height: 1000 },
    recordHar: opts.harPath ? { path: opts.harPath, content: 'embed' } : undefined,
  });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto('https://bubble.io/home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  return !/\/login|signup/i.test(page.url());
}

export async function login(page: Page): Promise<void> {
  if (!env.email || !env.password) throw new Error('BUBBLE_EMAIL / BUBBLE_PASSWORD not set (see .env.example)');
  // /log-in is a 404; the real form is /login?mode=login. The page also has a hidden signup form
  // with its own email/password inputs, hence the :visible / #login-password selectors.
  await page.goto('https://bubble.io/login?mode=login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.locator('input[type="email"]:visible').first().fill(env.email);
  await page.locator('#login-password').fill(env.password);
  await page.locator('button:visible', { hasText: /^\s*Log in\s*$/ }).first().click();
  await page.waitForURL((u) => !/\/login/i.test(u.toString()), { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

export async function ensureSession(page: Page): Promise<void> {
  if (!(await isLoggedIn(page))) await login(page);
  await page.context().storageState({ path: STATE_FILE });
}

export function editorUrl(appId: string, tab = 'Design', pageName = 'index', version = env.version) {
  return `https://bubble.io/page?id=${appId}&tab=${tab}&name=${pageName}${version === 'test' ? '' : `&version=${version}`}`;
}

/** Screenshot the editor (e.g. to visually verify an edit). Returns the PNG path. */
export async function screenshot(appId: string, pageName = 'index', tab = 'Design', version = env.version): Promise<string> {
  const file = join(DATA_DIR, `screenshot-${appId}-${pageName.replace(/\W+/g, '_')}-${tab}.png`);
  const { browser, ctx, page } = await openBrowser();
  try {
    await ensureSession(page);
    await page.goto(editorUrl(appId, tab, pageName, version), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: file });
  } finally { await ctx.close(); await browser.close(); }
  return file;
}

/** Screenshot the *running* app (not the editor). The editor can look fine while the page doesn't render. */
export async function preview(appId: string, pagePath = '', version = env.version, fullPage = true): Promise<string> {
  const file = join(DATA_DIR, `preview-${appId}-${pagePath.replace(/\W+/g, '_') || 'index'}.png`);
  const base = `https://${appId}.bubbleapps.io${version === 'live' ? '' : `/version-${version}`}/${pagePath}`;
  const { browser, ctx, page } = await openBrowser();
  try {
    await ensureSession(page);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    // Bubble lazy-renders below the fold: scroll through before capturing.
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 600) { await page.mouse.wheel(0, 600); await page.waitForTimeout(250); }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: file, fullPage });
  } finally { await ctx.close(); await browser.close(); }
  return file;
}
