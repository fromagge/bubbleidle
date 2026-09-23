---
name: bubble
description: Read, debug and edit a Bubble.io no-code app from the terminal — pages, elements, workflows, data types, server logs, snapshots and undo — via Bubble's private editor API. Use whenever a task mentions a Bubble app, bubbleapps.io, the Bubble editor, or a no-code app built in Bubble.
---

# Working on a Bubble app

This skill drives **bubbleidle**, which speaks Bubble's private editor API over HTTP. No browser needed.
Let `$BI` be the bubbleidle repo path (this skill lives in `$BI/skills/bubble`).

```bash
node $BI/bin/bubble.ts <command>     # JSON out; `help` lists everything
```
If an MCP server named `bubble` is connected, its `bubble_*` tools are the same commands — prefer them.

## Always

0. `doctor` if anything seems off — it checks config, session and permissions.

1. `snapshot "before <task>"` before any edit — it commits the whole app to git and is your undo/diff.
2. `outline <page|reusable>` to get ids and paths before touching anything.
3. `diff` after edits to confirm exactly what changed; `undo n` if wrong.
4. Never write to the `live` version.

## Orientation

| goal | command |
|---|---|
| what pages exist | `pages`, `reusables` |
| what's on a page | `outline index` |
| find by visible text | `snapshot` then `search "Sign up"` |
| id → location | `find bTGMA4` |
| raw JSON | `get '%p3.bTGbC.%el.bTGMB4' --deep` |
| see it | `screenshot index` (PNG of the real editor; header shows the issue count) |

## The JSON dialect

Paths look like `%p3.<page>.%el.<element>.%p.<property>`. Keys: `%x` type, `%p` properties, `%dn` display
name, `%el` children, `%wf` workflows, `actions` keyed `"0","1",…`, `%ei` element-id reference, `%c`
condition, `%s` conditional states, `%3` text content. Ignore `length` keys.

Read **`$BI/docs/APP-JSON.md`** before writing any node — it has real examples of elements, expressions,
workflows, actions, data types and option sets. Read **`$BI/docs/RECIPES.md`** for step-by-step tasks.

**Never invent JSON.** Copy the shape of an existing example from this app (or another readable app). If
none exists, ask the human to do it once in the editor, then `snapshot` + `diff` to read the exact encoding.

## Editing

```bash
set '<path>' '<json value>'          # change anything, e.g. text: …%p.%3.%e.0
create '<…%el|…%wf>' '<node json>'   # ids + index entries handled automatically
delete '<path>'
undo [n]
```

## Debugging

```bash
logs --since 2h --errors    # workflow errors from the server
logs --since 30m            # full event/action trace
history; diff               # recent changes to the app (including by humans)
```
Map ids in log rows to logic with `find` + `get`.

## Building or copying a design

```bash
node $BI/scripts/design-spec.ts <url>   # real colours/fonts/sizes/geometry of any page — don't guess
node $BI/examples/landing-page.ts --wipe  # full worked page: hero, terminal panel, cards, badges, reveal
preview                                  # screenshot the RUNNING app, not just the editor
```
Two runtime traps (details in `$BI/docs/APP-JSON.md`): a Text whose content doesn't fit its fixed height
disappears from the live page, and `font_family` must be a single family, not a CSS stack.

Animations are native Bubble: `"%iv": false` on the element, then a `PageLoaded` workflow with
`PauseWFClient` → `ShowElement` → `AnimateElement` per element.

Keep scratch files out of the repo — use your own temp directory.

## If Bubble changed and something breaks

`$BI/docs/DISCOVERY.md` explains how to re-record the protocol (`node $BI/scripts/record.ts --headed`) and
how to list current endpoints (`node $BI/scripts/bundle-endpoints.ts`). `raw <endpoint> '<json>'` calls any
endpoint directly.
