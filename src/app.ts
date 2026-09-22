// Read-side model of a Bubble app: full dumps, git snapshots, id lookup, summaries.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BubbleClient } from './client.ts';
import { DATA_DIR } from './session.ts';

// load_multiple_paths can't list the root, so these are the known top-level keys.
export const TOP_KEYS = [
  '_id', 'settings', 'styles', 'user_types', 'option_sets', '%p3', 'mobile_views', 'element_definitions',
  'api', 'global_expressions', '_index', 'uid_counter', 'last_change', 'last_change_date', 'creation_date',
];

// Short keys used throughout the app JSON.
export const LEGEND: Record<string, string> = {
  '%p3': 'pages', '%el': 'child elements', '%wf': 'workflows', '%p': 'properties', '%x': 'type',
  '%nm': 'name', '%dn': 'display name', '%d': 'display', '%s1': 'style id', '%c': 'condition',
  '%a': 'argument', '%n': 'next (chained expression)', '%t': 'top', '%l': 'left', '%w': 'width', '%h': 'height',
  '%z': 'z-index', '%e': 'text entries', '%v': 'value', actions: 'workflow actions keyed by order',
};

export async function dumpApp(c: BubbleClient): Promise<Record<string, unknown>> {
  const { values } = await c.loadPaths(TOP_KEYS.map((k) => [k]));
  const out: Record<string, unknown> = {};
  await Promise.all(TOP_KEYS.map(async (k, i) => {
    const v = values[i];
    out[k] = v && typeof v === 'object' && '__keys' in v ? await c.loadDeep([k]) : v;
  }));
  return out;
}

export function snapshotDir(appId: string) {
  return join(DATA_DIR, 'snapshots', appId);
}

/** Write the app as one file per top-level key into a git repo; commit if anything changed. */
export async function snapshot(c: BubbleClient, message = 'snapshot'): Promise<{ changed: boolean; commit?: string; stat?: string }> {
  const dir = snapshotDir(c.appId);
  mkdirSync(dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  if (!existsSync(join(dir, '.git'))) {
    git('init', '-q');
    git('config', 'user.email', 'bubblemake@localhost');
    git('config', 'user.name', 'bubblemake');
  }
  const app = await dumpApp(c);
  for (const [k, v] of Object.entries(app)) {
    if (k === 'last_change' || k === 'last_change_date' || k === 'uid_counter') continue;
    writeFileSync(join(dir, `${k.replace(/%/g, '_')}.json`), JSON.stringify(v, sortedReplacer, 2) + '\n');
  }
  git('add', '-A');
  if (!git('status', '--porcelain')) return { changed: false };
  git('commit', '-q', '-m', `${message} (last_change ${app.last_change})`);
  return { changed: true, commit: git('rev-parse', '--short', 'HEAD'), stat: git('show', '--stat', '--format=', 'HEAD') };
}

export function snapshotLog(appId: string, n = 20): string {
  const dir = snapshotDir(appId);
  if (!existsSync(join(dir, '.git'))) return '(no snapshots yet)';
  return execFileSync('git', ['-C', dir, 'log', `-${n}`, '--format=%h %ci %s', '--stat'], { encoding: 'utf8' });
}

export function snapshotDiff(appId: string, from = 'HEAD~1', to = 'HEAD'): string {
  return execFileSync('git', ['-C', snapshotDir(appId), 'diff', from, to], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

function sortedReplacer(_k: string, v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
}

/** Resolve a Bubble object id (e.g. "bTGYf") to its path array via _index.id_to_path. */
export async function pathOf(c: BubbleClient, id: string): Promise<string[] | null> {
  const p = (await c.load(['_index', 'id_to_path', id])) as string | null;
  return p ? p.split('.') : null;
}

export async function listPages(c: BubbleClient) {
  const idx = (await c.load(['_index', 'page_name_to_path'])) as Record<string, string>;
  return Object.entries(idx ?? {}).map(([name, path]) => ({ name, path: path.split('.') }));
}

/** Compact outline of a page: element tree and workflows with types and names. */
export async function outlinePage(c: BubbleClient, pageName: string): Promise<string> {
  const pages = await listPages(c);
  const pg = pages.find((p) => p.name === pageName);
  if (!pg) throw new Error(`page not found: ${pageName}; have ${pages.map((p) => p.name).join(', ')}`);
  const node = (await c.loadDeep(pg.path)) as any;
  const lines: string[] = [`page ${pageName}  path=${pg.path.join('.')}  id=${node?.id}`];
  const walk = (els: Record<string, any> | undefined, depth: number, base: string) => {
    for (const [key, el] of Object.entries<any>(els ?? {})) {
      if (key === 'length') continue;
      lines.push(`${'  '.repeat(depth)}- ${el['%x']} "${el['%dn'] ?? el['%nm'] ?? ''}" id=${el.id} key=${base}.%el.${key}`);
      walk(el['%el'], depth + 1, `${base}.%el.${key}`);
    }
  };
  lines.push('elements:');
  walk(node?.['%el'], 1, pg.path.join('.'));
  lines.push('workflows:');
  for (const [key, wf] of Object.entries<any>(node?.['%wf'] ?? {})) {
    if (key === 'length') continue;
    const acts = Object.values<any>(wf.actions ?? {}).map((a) => a['%x']).join(' → ');
    lines.push(`  - ${wf['%x']} "${wf['%p']?.['%dn'] ?? wf['%dn'] ?? ''}" id=${wf.id} key=${pg.path.join('.')}.%wf.${key}  actions: ${acts || '(none)'}`);
  }
  return lines.join('\n');
}
