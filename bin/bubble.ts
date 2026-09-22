#!/usr/bin/env node
// bubble — CLI over Bubble's internal editor API. Every command prints JSON (or plain text for outlines/diffs).
// Run `node bin/bubble.ts help` for usage.
import { writeFileSync } from 'node:fs';
import { BubbleClient } from '../src/client.ts';
import { dumpApp, snapshot, snapshotLog, snapshotDiff, listPages, listReusables, searchSnapshot, outlinePage, pathOf, LEGEND } from '../src/app.ts';
import { setPath, createNode, deleteNode, undo, readJournal } from '../src/edits.ts';
import { openBrowser, ensureSession, screenshot, env, DATA_DIR } from '../src/session.ts';

const HELP = `bubble <command> [args]            (app: $BUBBLE_APP_ID or --app <id>, version: --version test)

Session
  doctor                        check config, session, browser, permissions
  login                         log in headlessly, save cookies to .state/
  apps                          list apps (id + name) visible to the account
  perms                         current account's permissions on the app

Read
  pages                         list pages and their paths
  reusables                     list reusable elements (definitions live under %ed)
  outline <page|reusable>       element tree + workflows of a page or reusable element
  get <path> [--deep]           value at a dotted path, e.g. %p3.bTGbC.%el  (--deep expands chunked nodes)
  find <id>                     resolve an object id (e.g. bTGYf) to its path
  dump [--out file]             full app JSON
  search <text>                 grep the latest snapshot (run 'snapshot' first)
  legend                        meaning of the %-prefixed keys

History
  snapshot [message]            save app into a git repo under .state/snapshots/<app>, commit if changed
  history [n]                   snapshot commit log
  diff [from] [to]              git diff between snapshots (default HEAD~1..HEAD)
  changes <last_change>         edits made by anyone since a last_change number

Write  (never touches 'live'; every write is journaled with its previous value)
  set <path> <json>             set a value at a path
  create <collectionPath> <json>  add a node to a keyed collection (…%el or …%wf); ids assigned automatically
  delete <path>                 delete a node (+ its _index entries)
  undo [n]                      revert the last n journaled writes
  journal [n]                   show the last n journaled writes

Observe
  logs [--since 1h] [--errors] [--until <ms>]   server logs
  runs                          workflow run counts
  versions                      app versions/branches
  screenshot [page] [--tab Design|Workflow|Data|Logs]   PNG of the editor (path printed)

Escape hatch
  raw <endpoint> [json]         POST /appeditor/<endpoint> with a JSON body (see docs/PROTOCOL.md for the list)
`;

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) { argv.splice(i, 1); return 'true'; }
  argv.splice(i, 2);
  return next;
};
const appFlag = flag('app');
const versionFlag = flag('version');
const deep = flag('deep') === 'true';
const out = flag('out');
const since = flag('since', '1h')!;
const until = flag('until');
const errorsOnly = flag('errors') === 'true';
const tab = flag('tab', 'Design')!;
const [cmd = 'help', ...rest] = argv;

const toPath = (p: string): string[] => (p.trim().startsWith('[') ? JSON.parse(p) : p.split('.').filter(Boolean));
const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const parseDur = (s: string) => {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) return Number(s);
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 's']!;
};
const client = () => new BubbleClient(appFlag ?? env.appId, versionFlag ?? env.version);

async function main() {
  switch (cmd) {
    case 'help': case '--help': case '-h': return print(HELP);
    case 'legend': return print(LEGEND);

    case 'doctor': {
      const report: Record<string, unknown> = {};
      report.config = { app: appFlag ?? env.appId ?? '(unset)', version: versionFlag ?? env.version, email: env.email ? env.email.replace(/(.).*@/, '$1***@') : '(unset)', state: DATA_DIR };
      if (!env.email || !env.password) report.credentials = 'MISSING — see .env.example';
      try {
        const { browser, ctx, page } = await openBrowser();
        try { await ensureSession(page); report.session = 'ok'; } finally { await ctx.close(); await browser.close(); }
      } catch (e: any) { report.session = `FAILED: ${e?.message ?? e}`; }
      if (env.appId || appFlag) {
        try { report.permissions = await client().permissions(); } catch (e: any) { report.permissions = `FAILED: ${e?.message ?? e}`; }
        try { report.versions = Object.keys(await client().versions()); } catch { /* ignore */ }
      } else report.permissions = 'skipped (no app id; run `bubble apps`)';
      return print(report);
    }

    case 'login': {
      const { browser, ctx, page } = await openBrowser();
      try { await ensureSession(page); } finally { await ctx.close(); await browser.close(); }
      return print({ ok: true, state: DATA_DIR });
    }
    case 'apps': {
      // The dashboard fetches app metadata via /elasticsearch/msearch; read it off the wire.
      const { browser, ctx, page } = await openBrowser();
      const apps = new Map<string, string>();
      page.on('response', async (r) => {
        if (!/elasticsearch\//.test(r.url())) return;
        const t = await r.text().catch(() => '');
        for (const m of t.matchAll(/"_source":\{[^{}]*\}/g)) {
          const id = /"realappname_text":"([^"]+)"/.exec(m[0])?.[1];
          if (id) apps.set(id, /"app_name_text":"([^"]+)"/.exec(m[0])?.[1] ?? id);
        }
      });
      try {
        await ensureSession(page);
        await page.goto('https://bubble.io/home/projects', { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(3000);
      } finally { await ctx.close(); await browser.close(); }
      return print([...apps].map(([id, name]) => ({ id, name })));
    }
    case 'perms': return print(await client().permissions());

    case 'pages': return print(await listPages(client()));
    case 'reusables': return print(await listReusables(client()));
    case 'outline': return print(await outlinePage(client(), rest[0] ?? 'index'));
    case 'get': {
      const c = client();
      return print(deep ? await c.loadDeep(toPath(rest[0] ?? '')) : await c.load(toPath(rest[0] ?? '')));
    }
    case 'find': return print(await pathOf(client(), rest[0]));
    case 'dump': {
      const app = await dumpApp(client());
      if (out) { writeFileSync(out, JSON.stringify(app, null, 2)); return print({ written: out }); }
      return print(app);
    }
    case 'search': return print(searchSnapshot(client().appId, rest.join(' ')));

    case 'snapshot': return print(await snapshot(client(), rest.join(' ') || 'snapshot'));
    case 'history': return print(snapshotLog(client().appId, Number(rest[0] ?? 20)));
    case 'diff': return print(snapshotDiff(client().appId, rest[0], rest[1]));
    case 'changes': return print(await client().changes(rest[0]));

    case 'set': return print(await setPath(client(), toPath(rest[0]), JSON.parse(rest[1])));
    case 'create': return print(await createNode(client(), toPath(rest[0]), JSON.parse(rest[1])));
    case 'delete': return print(await deleteNode(client(), toPath(rest[0])));
    case 'undo': return print(await undo(client(), Number(rest[0] ?? 1)));
    case 'journal': return print(readJournal(Number(rest[0] ?? 20)));

    case 'logs': {
      const before = until ? Number(until) : Date.now();
      const r = await client().logs({ after: before - parseDur(since), before, messages: errorsOnly ? ['failed because of error'] : undefined });
      return print(r.rows);
    }
    case 'runs': return print(await client().workflowRuns());
    case 'versions': return print(await client().versions());
    case 'screenshot': return print({ screenshot: await screenshot(client().appId, rest[0] ?? 'index', tab, client().version) });

    case 'raw': return print(await client().post(rest[0], rest[1] ? JSON.parse(rest[1]) : { appname: client().appId, app_version: client().version }));

    default:
      console.error(`unknown command: ${cmd}\n`);
      print(HELP);
      process.exit(2);
  }
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
