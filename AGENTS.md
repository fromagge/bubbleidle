# Operating manual for agents

You can read and modify a **Bubble.io** app from this repo. Bubble is a no-code builder; the app is a JSON
tree served by Bubble's private editor API. This repo wraps that API. You do **not** need a browser.

Run everything through the CLI (or the equivalent MCP tools if this repo's MCP server is connected):

```bash
node bin/bubble.ts <command>        # every command prints JSON; `help` lists them
```

## First 60 seconds on a task

1. `node bin/bubble.ts doctor` — config, session and permissions in one call (`permissions.app` must be `can_edit`).
2. `node bin/bubble.ts snapshot "before <task>"` — commits the app into a local git repo. **Always do this
   before editing.** It's your rollback and your diff tool.
3. `node bin/bubble.ts pages` / `reusables`, then `outline <name>` — get ids and paths of what you'll touch.
4. Work. After each edit: `node bin/bubble.ts snapshot "after X"` then `diff` to confirm exactly what changed.

## The mental model

- Everything lives at a **path**: `%p3.<pageKey>.%el.<elementKey>.%p.%3.%e.0` is "page → element →
  properties → text content → first part".
- Pages are under `%p3`, reusable elements under `%ed`, workflows in a page's `%wf`, child elements in `%el`.
- Every object has an `id` (`bTGYf`) **and** a collection key; they differ. `find <id>` resolves an id to a path.
- Terse keys: `%x` type, `%p` properties, `%dn` display name, `%ei` element-id reference, `%c` condition.
  Full grammar with real examples: **[docs/APP-JSON.md](docs/APP-JSON.md)**. Wire protocol: **[docs/PROTOCOL.md](docs/PROTOCOL.md)**.
- `length` keys inside `%el`/`%wf` are server-maintained counters. Ignore them; never write them.

## Reading

```bash
node bin/bubble.ts outline index                         # tree of elements + workflows with ids/paths
node bin/bubble.ts get '%p3.bTGbC.%el.bTGMB4' --deep      # raw JSON of a node
node bin/bubble.ts find bTGMA4                            # id → path
node bin/bubble.ts search "Sign up"                       # grep the snapshot (labels, names, ids)
```
`search` needs a snapshot first. It's usually the fastest way to locate a feature by its visible text.

## Writing

```bash
# change a value at a path (JSON-encoded second arg)
node bin/bubble.ts set '%p3.bTGbC.%el.bTGMB4.%p.%3.%e.0' '"New headline"'

# add a node to a keyed collection (ids and index entries are handled for you)
node bin/bubble.ts create '%p3.bTGbC.%el' '{"%x":"Text","%dn":"Subtitle","%s1":"Text_body_16_",
  "%p":{"%t":120,"%l":60,"%w":300,"%h":40,"%z":3,"fit_width":true,"min_height_css":"0px","min_width_css":"0px",
        "%3":{"%x":"TextExpression","%e":{"0":"Hello"}}}}'

node bin/bubble.ts delete '%p3.bTGbC.%el.bTGMB4'
node bin/bubble.ts undo 1        # revert the last write (journal-based)
```

Rules:
- **Never write to `live`.** The tool refuses, but don't try. Work on `test` (or a branch on paid plans).
- **Don't invent JSON shapes.** If you're unsure how Bubble encodes something, find an existing example
  (`search`/`get` in this app or any other app you can read) and copy its shape. If there's no example:
  ask the human to build it once in the editor, then `snapshot` + `diff` to read the exact encoding.
- Verify after writing: `outline`, `get`, or `screenshot <page>` (PNG of the real editor). The editor
  header shows an issue count; a screenshot is the cheapest way to catch a malformed node.
- Writes are journaled to `.state/journal.jsonl` with their previous values. `undo n` reverts them.
- There's a per-process write cap (`BUBBLEIDLE_MAX_WRITES`, default 200).

## Debugging a Bubble app

```bash
node bin/bubble.ts logs --since 2h --errors     # server-side workflow errors
node bin/bubble.ts logs --since 30m             # full event/action trace
node bin/bubble.ts runs                         # workflow run volume
node bin/bubble.ts history && node bin/bubble.ts diff   # what changed recently, and by whom (any editor)
```
Log rows carry the event/action names and ids; `find <id>` maps those to paths, then `get` shows the logic.

## When something doesn't work

- **401 / "not logged in"** → the session expired; the client re-logs in automatically. If it loops,
  run `node bin/bubble.ts login` and check credentials.
- **"Your plan does not allow"** → free-plan limit (export, branches, deploys). Not an auth problem.
- **A call 404s or returns something unexpected** → Bubble probably changed the editor.
  Re-record the traffic: see [docs/DISCOVERY.md](docs/DISCOVERY.md) (`scripts/record.ts`, ~20 min).
- **Unknown endpoint needed** → `node bin/bubble.ts raw <endpoint> '<json>'`; list them with
  `node scripts/bundle-endpoints.ts`.

## Housekeeping

- **Keep the repo clean.** Throwaway probe scripts, logs, crops and experiment output go in your own temp
  or scratch directory — never in the repo. `.state/` is for real runtime state only (session cookies,
  snapshots, journal, events) and is gitignored.
- Recorded HARs contain **session cookies**. Don't commit them; delete them when you're done.
- If you learn something durable about Bubble's format or behaviour, add it to `docs/` in the same session.
  That's the point of this repo: the next agent shouldn't rediscover it.

## Building UI

- Copy an existing design with real numbers, not guesses: `node scripts/design-spec.ts <url>` prints the
  page's computed colours, fonts, sizes, geometry and animations.
- Verify with **both** `bubble screenshot <page>` (editor) and `bubble preview` (the running app). Elements
  can render in the editor and vanish live — see the two rules in `docs/APP-JSON.md`.
- Animations are native: hide with `"%iv": false`, then a `PageLoaded` workflow of
  `PauseWFClient` → `ShowElement` → `AnimateElement`. See `docs/RECIPES.md`.

## Boundaries

- Don't touch apps other than the configured one unless asked (`--app` targets others).
- Don't deploy, delete pages, or change app settings/privacy rules unless explicitly asked.
- Database **rows** are not supported here yet; use Bubble's Data API for those.
- Report what you changed in terms of paths and ids, and mention the snapshot commit so the human can diff.
