#!/usr/bin/env node
// MCP server (stdio) exposing bubbleidle to Claude Code, Codex, Cursor, etc.
// Register:  claude mcp add bubble -- node /abs/path/to/bubbleidle/src/mcp.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BubbleClient } from './client.ts';
import { listPages, listReusables, outlinePage, pathOf, snapshot, snapshotDiff, snapshotLog, searchSnapshot, LEGEND } from './app.ts';
import { setPath, createNode, deleteNode, undo, readJournal } from './edits.ts';
import { env, screenshot } from './session.ts';

const server = new McpServer({ name: 'bubbleidle', version: '0.1.0' });

const clients = new Map<string, BubbleClient>();
const client = (app?: string) => {
  const id = app ?? env.appId;
  if (!id) throw new Error('No app: pass `app` or set BUBBLE_APP_ID');
  if (!clients.has(id)) clients.set(id, new BubbleClient(id, env.version));
  return clients.get(id)!;
};
const path = z.union([z.string(), z.array(z.string())]).describe('Dotted path like "%p3.bTGbC.%el" or an array of segments');
const toPath = (p: string | string[]) => (Array.isArray(p) ? p : p.split('.').filter(Boolean));
const app = z.string().optional().describe('Bubble app id (defaults to BUBBLE_APP_ID)');
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
  server.registerTool(name, { description, inputSchema: shape }, async (a: any) => {
    try { return text(await fn(a)); } catch (e: any) { return { ...text(`error: ${e?.message ?? e}`), isError: true }; }
  });
}

tool('bubble_legend', 'Meaning of the terse %-keys in Bubble app JSON. Read docs/APP-JSON.md for full grammar.', {}, async () => LEGEND);
tool('bubble_permissions', "The bot account's permissions on the app.", { app }, async (a) => client(a.app).permissions());
tool('bubble_pages', 'List pages with their paths.', { app }, async (a) => listPages(client(a.app)));
tool('bubble_reusables', 'List reusable elements with their definition paths (under %ed).', { app }, async (a) => listReusables(client(a.app)));
tool('bubble_outline', 'Element tree and workflows (with ids and paths) of a page or reusable element. Start here.',
  { app, name: z.string().describe('page or reusable name') }, async (a) => outlinePage(client(a.app), a.name));
tool('bubble_get', 'Read the JSON at a path. deep=true expands chunked subtrees.',
  { app, path, deep: z.boolean().optional() }, async (a) => (a.deep ? client(a.app).loadDeep(toPath(a.path)) : client(a.app).load(toPath(a.path))));
tool('bubble_find', 'Resolve an object id (element/workflow/action id) to its path.', { app, id: z.string() }, async (a) => pathOf(client(a.app), a.id));
tool('bubble_search', 'Grep the latest snapshot for text (names, labels, field keys, ids). Run bubble_snapshot first.',
  { app, text: z.string() }, async (a) => searchSnapshot(client(a.app).appId, a.text));

tool('bubble_snapshot', 'Save the full app into a local git repo and commit if changed. Do this before and after edits.',
  { app, message: z.string().optional() }, async (a) => snapshot(client(a.app), a.message ?? 'snapshot'));
tool('bubble_history', 'Snapshot commit log.', { app, n: z.number().optional() }, async (a) => snapshotLog(client(a.app).appId, a.n ?? 20));
tool('bubble_diff', 'Diff between two snapshots (default: previous vs latest). Best way to learn how an editor action is encoded.',
  { app, from: z.string().optional(), to: z.string().optional() }, async (a) => snapshotDiff(client(a.app).appId, a.from, a.to));
tool('bubble_changes', 'Edits made by anyone since a last_change number.', { app, last_change: z.string() }, async (a) => client(a.app).changes(a.last_change));

tool('bubble_set', 'Set the value at a path (null deletes a leaf). Journaled and undoable. Never touches live.',
  { app, path, value: z.any() }, async (a) => setPath(client(a.app), toPath(a.path), a.value));
tool('bubble_create', 'Add a node to a keyed collection (path ending in %el or %wf). id and key are assigned; _index is updated.',
  { app, collection: path, node: z.record(z.string(), z.any()).describe('node JSON without id, e.g. {"%x":"Text","%dn":"Title","%p":{...}}'),
    intent: z.string().optional().describe('e.g. CreateElement, CreateWorkflow') },
  async (a) => createNode(client(a.app), toPath(a.collection), a.node, a.intent ?? 'CreateElement'));
tool('bubble_delete', 'Delete a node and its _index entries. Journaled and undoable.', { app, path }, async (a) => deleteNode(client(a.app), toPath(a.path)));
tool('bubble_undo', 'Revert the last n journaled writes (newest first).', { app, n: z.number().optional() }, async (a) => undo(client(a.app), a.n ?? 1));
tool('bubble_journal', 'Recent journaled writes with before/after values.', { n: z.number().optional() }, async (a) => readJournal(a.n ?? 20));

tool('bubble_logs', 'Server logs. since like "15m", "2h", "1d". errors_only filters to failures.',
  { app, since: z.string().optional(), errors_only: z.boolean().optional() }, async (a) => {
    const ms = (s: string) => { const m = /^(\d+)([smhd])$/.exec(s); return m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 's']! : Number(s); };
    const before = Date.now();
    return (await client(a.app).logs({ after: before - ms(a.since ?? '1h'), before, messages: a.errors_only ? ['failed because of error'] : undefined })).rows;
  });
tool('bubble_runs', 'Workflow run counts.', { app }, async (a) => client(a.app).workflowRuns());
tool('bubble_versions', 'App versions / branches.', { app }, async (a) => client(a.app).versions());
tool('bubble_raw', 'POST any /appeditor/<endpoint> (see docs/PROTOCOL.md §6). Escape hatch.',
  { app, endpoint: z.string(), body: z.record(z.string(), z.any()).optional() },
  async (a) => client(a.app).post(a.endpoint, a.body ?? { appname: client(a.app).appId, app_version: client(a.app).version }));

server.registerTool('bubble_screenshot', {
  description: 'Screenshot the editor for a page (tab: Design, Workflow, Data, Logs) to visually verify changes.',
  inputSchema: { app, page: z.string().optional(), tab: z.string().optional() },
}, async (a: any) => {
  try {
    const file = await screenshot(client(a.app).appId, a.page ?? 'index', a.tab ?? 'Design');
    return { content: [{ type: 'image' as const, data: readFileSync(file).toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: file }] };
  } catch (e: any) { return { ...text(`error: ${e?.message ?? e}`), isError: true }; }
});

await server.connect(new StdioServerTransport());
