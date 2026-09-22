#!/usr/bin/env node
// Background watcher: polls an app for editor changes and server-log errors.
//
// Every BUBBLEIDLE_INTERVAL seconds (default 300):
//   - if the app changed (last_change moved): snapshot to git, record the diffstat
//   - fetch server logs since the last poll; collect "failed because of error" rows
//   - append events to .state/events.jsonl, desktop-notify (notify-send, if present)
//   - if BUBBLEIDLE_ON_EVENT is set, run it through `sh -c` with the event JSON on stdin and in $BUBBLEIDLE_EVENT
//     e.g.  BUBBLEIDLE_ON_EVENT='claude -p "$(cat scripts/prompts/triage.md)" --mcp-config mcp.json'
//
//   node src/watcher.ts [--once]
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { BubbleClient } from './client.ts';
import { snapshot } from './app.ts';
import { DATA_DIR, env, REPO_DIR } from './session.ts';

const INTERVAL = Number(process.env.BUBBLEIDLE_INTERVAL ?? 300) * 1000;
const HOOK = process.env.BUBBLEIDLE_ON_EVENT;
const once = process.argv.includes('--once');
const apps = (process.env.BUBBLEIDLE_WATCH_APPS ?? env.appId ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!apps.length) throw new Error('set BUBBLE_APP_ID or BUBBLEIDLE_WATCH_APPS');

const EVENTS = join(DATA_DIR, 'events.jsonl');
type State = { lastChange?: string; lastLogTs?: number };
const stateFile = (app: string) => join(DATA_DIR, `watcher-${app}.json`);
const load = (app: string): State => (existsSync(stateFile(app)) ? JSON.parse(readFileSync(stateFile(app), 'utf8')) : {});
const save = (app: string, s: State) => writeFileSync(stateFile(app), JSON.stringify(s));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function emit(event: Record<string, unknown>) {
  const e = { ts: new Date().toISOString(), ...event };
  appendFileSync(EVENTS, JSON.stringify(e) + '\n');
  log('EVENT', JSON.stringify(e).slice(0, 300));
  spawnSync('notify-send', ['-a', 'bubbleidle', `bubble: ${e.type} (${e.app})`, String(e.summary ?? '')], { stdio: 'ignore' });
  if (HOOK) {
    const p = spawn('sh', ['-c', HOOK], { cwd: REPO_DIR, env: { ...process.env, BUBBLEIDLE_EVENT: JSON.stringify(e) }, stdio: ['pipe', 'inherit', 'inherit'] });
    p.stdin.end(JSON.stringify(e));
  }
}

async function poll(app: string) {
  const c = new BubbleClient(app, env.version);
  const st = load(app);
  const now = Date.now();

  const lastChange = String(await c.load(['last_change']));
  if (lastChange !== st.lastChange) {
    const snap = await snapshot(c, st.lastChange ? 'change detected' : 'watcher baseline');
    if (st.lastChange && snap.changed) emit({ type: 'app_changed', app, commit: snap.commit, summary: snap.stat?.split('\n').at(-1), stat: snap.stat });
    st.lastChange = lastChange;
  }

  const after = st.lastLogTs ?? now - INTERVAL;
  const { rows } = await c.logs({ after, before: now, messages: ['failed because of error'] });
  if (rows?.length) {
    emit({ type: 'errors', app, count: rows.length, summary: `${rows.length} workflow error(s)`, rows: rows.slice(0, 20) });
  }
  st.lastLogTs = now;
  save(app, st);
}

async function tick() {
  for (const app of apps) {
    try { await poll(app); } catch (e: any) { log('poll failed', app, e?.message ?? e); }
  }
}

log(`watching ${apps.join(', ')} every ${INTERVAL / 1000}s${HOOK ? ' (hook set)' : ''}`);
await tick();
if (!once) setInterval(tick, INTERVAL);
