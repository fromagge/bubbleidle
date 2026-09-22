// Guarded edit layer: every write is journaled with its previous value so it can be undone.
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BubbleClient, type WriteChange } from './client.ts';
import { DATA_DIR } from './session.ts';

const JOURNAL = join(DATA_DIR, 'journal.jsonl');
const MAX_WRITES_PER_PROCESS = Number(process.env.BUBBLEMAKE_MAX_WRITES ?? 200);
let writesThisProcess = 0;

type Entry = { ts: string; app: string; version: string; op: string; changes: { path: string[]; before: unknown; after: unknown }[]; undone?: boolean };

async function journaledWrite(c: BubbleClient, op: string, changes: WriteChange[], idCounter?: number) {
  if (++writesThisProcess > MAX_WRITES_PER_PROCESS) throw new Error(`write cap reached (${MAX_WRITES_PER_PROCESS}); restart to continue`);
  const { values: before } = await c.loadPaths(changes.map((ch) => ch.path));
  const res = await c.write(changes, idCounter);
  const entry: Entry = {
    ts: new Date().toISOString(), app: c.appId, version: c.version, op,
    changes: changes.map((ch, i) => ({ path: ch.path, before: before[i], after: ch.body })),
  };
  appendFileSync(JOURNAL, JSON.stringify(entry) + '\n');
  return { ...res, op };
}

/** Collect every object id inside a subtree (for id_to_path cleanup on delete). */
function collectIds(node: unknown, out: string[] = []): string[] {
  if (node && typeof node === 'object') {
    const id = (node as any).id;
    if (typeof id === 'string') out.push(id);
    for (const v of Object.values(node)) collectIds(v, out);
  }
  return out;
}

/** Set any value at a path (property tweaks, text, conditions...). */
export async function setPath(c: BubbleClient, path: string[], value: unknown) {
  return journaledWrite(c, 'set', [{ path, body: value, intent: { name: 'Update' } }]);
}

/**
 * Create a node in a keyed collection (e.g. parent=[...page, '%el'] for an element, [...page, '%wf'] for a workflow).
 * Assigns fresh uids for the collection key and the node's id, and registers it in _index.id_to_path.
 */
export async function createNode(c: BubbleClient, collectionPath: string[], body: Record<string, unknown>, intentName = 'CreateElement') {
  // Nested objects that need their own ids too: workflow actions, and child elements given inline.
  const nested = findNested(body);
  const { uids, counter } = await c.reserveUids(2 + nested.length);
  const [id, key, ...childIds] = uids;
  const path = [...collectionPath, key];
  const node = structuredClone(body) as Record<string, unknown>;
  node.id = id;
  nested.forEach((rel, i) => { setIn(node, rel, childIds[i]); });

  const res = await journaledWrite(c, `create ${intentName}`, [
    { path: ['_index', 'id_to_path', id], body: path.join('.') },
    ...nested.map((rel, i) => ({ path: ['_index', 'id_to_path', childIds[i]], body: [...path, ...rel].join('.') })),
    { path, body: node, intent: { name: intentName, source_appname: '' } },
    { path: ['_index', 'issues_list', id], body: '[]' },
  ], counter);
  return { ...res, id, key, path, nestedIds: Object.fromEntries(nested.map((rel, i) => [rel.join('.'), childIds[i]])) };
}

/** Relative paths of nested nodes that need an id (actions and inline child elements without one). */
function findNested(node: unknown, base: string[] = []): string[][] {
  const out: string[][] = [];
  if (!node || typeof node !== 'object') return out;
  for (const collection of ['actions', '%el', '%wf', '%s']) {
    const coll = (node as Record<string, unknown>)[collection];
    if (!coll || typeof coll !== 'object') continue;
    for (const [k, v] of Object.entries(coll as Record<string, unknown>)) {
      if (k === 'length' || !v || typeof v !== 'object') continue;
      const rel = [...base, collection, k];
      if (!(v as Record<string, unknown>).id) out.push(rel);
      out.push(...findNested(v, rel));
    }
  }
  return out;
}

function setIn(obj: Record<string, unknown>, rel: string[], id: string) {
  let cur: any = obj;
  for (const seg of rel) cur = cur[seg];
  cur.id = id;
}

/** Delete a node and its _index.id_to_path entries (including nested children). */
export async function deleteNode(c: BubbleClient, path: string[]) {
  const node = await c.loadDeep(path);
  if (node == null) throw new Error(`nothing at ${path.join('.')}`);
  const ids = collectIds(node);
  return journaledWrite(c, 'delete', [
    ...ids.flatMap((id) => [
      { path: ['_index', 'id_to_path', id], body: null },
      { path: ['_index', 'issues_list', id], body: null },
    ]),
    { path, body: null, intent: { name: 'RemoveElement', source_appname: '' } },
  ]);
}

export function readJournal(n = 20): Entry[] {
  if (!existsSync(JOURNAL)) return [];
  return readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-n);
}

/** Revert the most recent `n` non-undone journal entries for this app/version, newest first. */
export async function undo(c: BubbleClient, n = 1) {
  const all: Entry[] = existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done: string[] = [];
  for (let i = all.length - 1; i >= 0 && done.length < n; i--) {
    const e = all[i];
    if (e.undone || e.app !== c.appId || e.version !== c.version || e.op.startsWith('undo')) continue;
    await c.write([...e.changes].reverse().map((ch) => ({ path: ch.path, body: ch.before ?? null, intent: { name: 'Undo' } })));
    e.undone = true;
    done.push(`${e.ts} ${e.op}`);
  }
  writeFileSync(JOURNAL, all.map((e) => JSON.stringify(e)).join('\n') + (all.length ? '\n' : ''));
  return done;
}
