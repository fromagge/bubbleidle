# bubbleidle

**Give any AI agent full read/write access to a Bubble.io app** — pages, elements, workflows, data types,
server logs, version history — through Bubble's own (undocumented) editor API.

Bubble has no public API for editing an app's structure, and its AI agent only lives inside Bubble's editor.
bubbleidle reverse-engineers the editor protocol so your agent (Claude Code, Codex, Cursor, a cron script)
can inspect and change a Bubble app from a terminal, unattended.

Reads and writes go over **plain HTTP** (~200–900 ms per call). A headless browser is used only to log in
once and to take screenshots. Every write is **journaled and undoable**, and the whole app is
**snapshotted into git**, so you get diffs and history of a no-code app.

```console   # example session
$ bubble outline index
page index  path=%p3.bTGbC  id=bTGYf
elements:
  - Text "Hero title" id=bTGMA4 key=%p3.bTGbC.%el.bTGMB4
workflows:
  - ButtonClicked "" id=bTKaF key=%p3.bTGbC.%wf.bTKaH  actions: ScrollToElement → ChangePage

$ bubble set '%p3.bTGbC.%el.bTGMB4.%p.%3.%e.0' '"Welcome back"'
$ bubble logs --since 2h --errors
$ bubble snapshot "before refactor" && bubble diff
$ bubble undo 1
```

> ⚠️ This uses endpoints Bubble does not document or support. It can break when Bubble ships an editor
> update ([re-discovery takes ~20 min](docs/DISCOVERY.md)), and automating the editor is a gray area under
> Bubble's ToS (one person per login, no interfering with the platform). Use a **dedicated bot account**
> and a **test app**, not a client's production app. You own the risk.

## Install

Requirements: **Node ≥ 22** (uses native TypeScript execution), a Chromium/Chrome binary, `git`.

```bash
git clone <this repo> && cd bubbleidle
npm install                       # playwright-core, dotenv, MCP SDK, zod
cp .env.example .env              # then fill it in (or put it in ~/.config/bubbleidle/.env)
node bin/bubble.ts login          # logs in headlessly, saves cookies to .state/
node bin/bubble.ts doctor         # verify config, session, permissions
node bin/bubble.ts apps           # lists app ids the account can see → set BUBBLE_APP_ID
node bin/bubble.ts snapshot       # first snapshot: the app is now in git
```

No Chromium? `npx playwright install chromium`, or set `CHROMIUM_PATH`.

### The bot account
Create a **separate Bubble account** with email+password (not Google SSO) and invite it as a collaborator
on the app (Settings → Collaboration) with edit rights. Bubble allows one person and one session per login,
so sharing your own login means fighting your own editor tab. Put its credentials in `.env`.

## Use it from an agent

| Agent | Setup |
|---|---|
| **Any** (Codex, scripts, CI) | Run the CLI: `node bin/bubble.ts <cmd>`. Every command prints JSON. Point the agent at [AGENTS.md](AGENTS.md). |
| **Claude Code** | `claude mcp add bubble -- node /abs/path/bubbleidle/src/mcp.ts` for native tools, plus the bundled skill and subagents (see below). |
| **Cursor / others** | Same MCP server; see [`mcp.example.json`](mcp.example.json). |

The repo ships agent instructions so a fresh agent needs no explanation:

- [`AGENTS.md`](AGENTS.md) — operating manual (read first; `CLAUDE.md` points here)
- [`skills/bubble/SKILL.md`](skills/bubble/SKILL.md) — Claude skill (symlinked at `.claude/skills/bubble`)
- [`.claude/agents/`](.claude/agents) — `bubble-debugger` and `bubble-builder` subagents

## Commands

`node bin/bubble.ts help` prints them all. The main ones:

| | |
|---|---|
| `doctor`, `login`, `apps`, `perms` | check setup, session and access |
| `pages`, `reusables`, `outline <name>` | structure at a glance |
| `get <path> [--deep]`, `find <id>`, `search <text>` | read anything |
| `snapshot [msg]`, `history`, `diff [a] [b]`, `changes <n>` | version history of the app |
| `set <path> <json>`, `create <collection> <json>`, `delete <path>` | edits (journaled) |
| `undo [n]`, `journal [n]` | safety net |
| `logs [--since 2h] [--errors]`, `runs`, `versions` | observability |
| `screenshot [page] [--tab Design]`, `preview [path]` | see the editor / the running app |
| `raw <endpoint> [json]` | call any of ~200 editor endpoints |

Flags: `--app <id>` (default `$BUBBLE_APP_ID`), `--version test|live|<branch>` (writes to `live` are refused).

## Worked example

[`examples/yaek-clone.ts`](examples/yaek-clone.ts) rebuilds the yaek.app landing page — nav, hero, a
terminal panel, a five-item timeline, footer, ~60 elements — in one run, then snapshots it:

```bash
node examples/yaek-clone.ts --wipe
```

## Background mode

```bash
BUBBLEIDLE_INTERVAL=300 node src/watcher.ts        # poll every 5 min
```
It snapshots the app whenever it changes, collects workflow errors from the server logs, appends to
`.state/events.jsonl`, sends a desktop notification, and can hand the event to any command:

```bash
BUBBLEIDLE_ON_EVENT='claude -p "Triage this Bubble event and report. Do not edit anything."' \
  node src/watcher.ts
```
Install as a user service: [`scripts/bubbleidle.service`](scripts/bubbleidle.service).

## How it works

1. **Log in** headlessly once → cookies saved (`.state/storage-state.json`).
2. **Read** the app JSON tree by path: `POST /appeditor/load_multiple_paths` + `GET /appeditor/load_single_path`.
3. **Write** by sending path/value changes to `POST /appeditor/write`, with ids minted from the app's
   shared counter exactly as the editor does.
4. **Snapshot** = walk the tree, write one JSON file per top-level key, `git commit`.

Full details, including every endpoint and the JSON dialect:

- [docs/PROTOCOL.md](docs/PROTOCOL.md) — the wire protocol (auth, read, write, ids, logs, endpoint catalogue)
- [docs/APP-JSON.md](docs/APP-JSON.md) — what `%p3`, `%el`, `%wf`, `%x`, `%ei`… mean, with real examples
- [docs/RECIPES.md](docs/RECIPES.md) — task-by-task: add an element, wire a workflow, debug from logs
- [docs/DISCOVERY.md](docs/DISCOVERY.md) — how this was reverse-engineered, and how to redo it when Bubble changes

## Layout

```
bin/bubble.ts        CLI (agent-agnostic entry point)
src/session.ts       config, login, cookies, screenshots
src/client.ts        HTTP client for the editor API (read, write, ids, logs)
src/uid.ts           Bubble's short-uid generator + batch allocation
src/app.ts           app model: dump, snapshot/diff, outline, search
src/edits.ts         guarded writes: journal + undo
src/mcp.ts           MCP server (22 tools)
src/watcher.ts       background poller
scripts/record.ts    record editor traffic (re-discovery)
scripts/bundle-endpoints.ts   list endpoints from Bubble's editor bundle
.state/              cookies, HARs, snapshots, journal, events  (gitignored, contains secrets)
```

## Limits

- **Database rows** aren't mapped yet — use Bubble's official Data API for those (needs a paid plan + token).
- **Export** (`/appeditor/export`) and **branches/deploys** need a paid plan. Snapshots work on any plan.
- Only email+password accounts (no Google SSO) can be used for the bot.
