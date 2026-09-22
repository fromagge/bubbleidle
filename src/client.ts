// Direct HTTP client for Bubble's internal editor API. Uses cookies from the Playwright session;
// re-logs in via headless browser when they expire.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_FILE, DATA_DIR, env, openBrowser, ensureSession } from './session.ts';

export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

// Base32 (Crockford minus 's', plus 'u') used by load_single_path to encode each path segment.
const B32 = '0123456789abcdefghjkmnpqrtuvwxyz';
export function encodeSegment(s: string): string {
  let bits = 0, val = 0, out = '';
  for (const byte of Buffer.from(s, 'utf8')) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

type PathResult = { data?: unknown; path_version_hash?: string; keys?: string[] };

export class BubbleClient {
  appId: string;
  version: string;
  private cookie = '';

  constructor(appId = env.appId, version = env.version) {
    if (!appId) throw new Error('BUBBLE_APP_ID not set (run `bubble apps` to list the ids this account can see)');
    this.appId = appId;
    this.version = version;
    this.loadCookies();
  }

  private loadCookies() {
    if (!existsSync(STATE_FILE)) return;
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    this.cookie = state.cookies
      .filter((c: any) => c.domain.replace(/^\./, '').endsWith('bubble.io'))
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');
  }

  async relogin() {
    const { browser, ctx, page } = await openBrowser();
    try { await ensureSession(page); } finally { await ctx.close(); await browser.close(); }
    this.loadCookies();
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json',
      cookie: this.cookie,
      origin: 'https://bubble.io',
      referer: `https://bubble.io/page?id=${this.appId}&tab=Design&name=index`,
      'user-agent': UA,
      'x-bubble-appname': this.appId,
      'x-bubble-platform': 'web',
      'x-bubble-breaking-revision': '5',
      'x-requested-with': 'XMLHttpRequest',
      ...extra,
    };
  }

  async request(method: string, path: string, body?: unknown, retry = true): Promise<any> {
    const res = await fetch(`https://bubble.io${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const authFail = (res.status === 401 || res.status === 403 || /not logged in|login required/i.test(text.slice(0, 300)))
      && !/plan does not allow|upgrade/i.test(text);
    if (authFail && retry) { await this.relogin(); return this.request(method, path, body, false); }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  post(endpoint: string, body: unknown = {}) {
    return this.request('POST', `/appeditor/${endpoint}`, body);
  }

  permissions() {
    return this.post('get_current_user_permissions', { appname: this.appId, app_version: this.version });
  }

  /** Load values at several paths; chunked results are fetched transparently. */
  async loadPaths(paths: string[][]): Promise<{ lastChange: number; values: unknown[] }> {
    const r = await this.request('POST', `/appeditor/load_multiple_paths/${this.appId}/${this.version}`, {
      path_arrays: paths, no_chunking: false,
    });
    const values = await Promise.all(
      (r.data as PathResult[]).map((d, i) => (d.path_version_hash ? this.loadSingle(paths[i], d.path_version_hash) : d.data ?? (d.keys ? { __keys: d.keys } : null))),
    );
    return { lastChange: r.last_change, values };
  }

  async loadSingle(path: string[], hash: string): Promise<unknown> {
    const enc = path.map(encodeSegment).join('/');
    const r = await this.request('GET', `/appeditor/load_single_path/${this.appId}/${this.version}/${hash}/${enc}`);
    return r.data;
  }

  async load(path: string[]): Promise<unknown> {
    return (await this.loadPaths([path])).values[0];
  }

  /** Load a path fully, recursing into nodes the server returns as key lists. */
  async loadDeep(path: string[]): Promise<unknown> {
    const v = await this.load(path);
    return this.expand(path, v);
  }

  private async expand(path: string[], v: unknown): Promise<unknown> {
    if (!v || typeof v !== 'object' || !('__keys' in v)) return v;
    const keys = (v as { __keys: string[] }).__keys;
    const { values } = await this.loadPaths(keys.map((k) => [...path, k]));
    const out: Record<string, unknown> = {};
    await Promise.all(keys.map(async (k, i) => { out[k] = await this.expand([...path, k], values[i]); }));
    return out;
  }

  // ---- writes -------------------------------------------------------------

  private browserId = persistentBrowserId();
  private sessionId = `${Date.now()}x${Math.floor(Math.random() * 90 + 10)}`;

  checkCount(): Promise<{ id_counter: number; editor_id: number }> {
    return this.post('check_count', { appname: this.appId, browser_id: this.browserId });
  }

  setCount(count: number) {
    return this.post('set_count', { appname: this.appId, count });
  }

  /** Reserve `n` fresh uids from the shared app counter. */
  async reserveUids(n: number): Promise<{ uids: string[]; counter: number }> {
    const { shortUid, allocate } = await import('./uid.ts');
    const { id_counter, editor_id } = await this.checkCount();
    const { counters, next } = allocate(Number(id_counter), n);
    await this.setCount(next);
    return { uids: counters.map((c) => shortUid(c, editor_id)), counter: next };
  }

  /** Send a batch of path writes. `body: null` deletes. */
  async write(changes: WriteChange[], idCounter?: number): Promise<{ last_change: string }> {
    if (this.version === 'live') throw new Error('refusing to write to live');
    const payload = {
      v: 1,
      appname: this.appId,
      app_version: this.version,
      changes: [
        ...changes.map((c) => ({
          body: c.body,
          path_array: c.path,
          intent: c.intent ?? { name: 'Update index' },
          version_control_api_version: 4,
          changelog_data: [],
          session_id: this.sessionId,
        })),
        ...(idCounter !== undefined ? [{ type: 'id_counter', value: idCounter }] : []),
      ],
    };
    return this.post('write', payload);
  }

  // ---- ops / observability -------------------------------------------------

  versions() {
    return this.post('get_versions', { appname: this.appId });
  }

  workflowRuns(platform: 'web' | 'mobile' | 'web_and_mobile' = 'web') {
    return this.post('get_workflow_runs', { appname: this.appId, platform });
  }

  /** Server logs between two epoch-ms timestamps. `messages` filters on log tag types. */
  logs(opts: { after: number; before: number; messages?: string[]; ascending?: boolean; version?: string }) {
    return this.post('get_jetstream_logs', {
      ascending: opts.ascending ?? true,
      tags: {
        message: opts.messages ?? LOG_MESSAGES,
        appname: this.appId,
        app_version: opts.version ?? this.version,
      },
      after: opts.after,
      before: opts.before,
      is_state_ar: true,
    }) as Promise<{ rows: any[] }>;
  }

  /** Edits made to the app since `lastChange` (by anyone). */
  changes(lastChange: number | string) {
    return this.request('GET', `/appeditor/changes/${this.appId}/${this.version}/${lastChange}/${this.sessionId}`);
  }
}

function persistentBrowserId(): string {
  const f = join(DATA_DIR, 'browser-id');
  if (!existsSync(f)) writeFileSync(f, String(Math.round(Math.random() * 1e7)));
  return readFileSync(f, 'utf8').trim();
}

export type WriteChange ={ path: string[]; body: unknown; intent?: Record<string, unknown> };

export const LOG_MESSAGES = [
  'running event', 'event condition passed', 'event condition failed, terminating', 'running action',
  'action condition failed', 'action completed', 'event completed', 'failed because of error', 'server_db.modify',
];
