# Recipes

Task-by-task. Commands are `node bin/bubble.ts …` (shown as `bubble …`). Everything here was run against a
real app; where a recipe is untested it says so.

**Before any edit:** `bubble snapshot "before <task>"`. **After:** `bubble snapshot "after <task>" && bubble diff`.

---

## Find your way around a strange app

```bash
bubble pages                       # page names → paths
bubble reusables                   # reusable elements (headers, popups, …)
bubble outline dashboard           # element tree + workflows, with ids and paths
bubble snapshot && bubble search "Sign up"   # locate anything by its visible text
bubble find cmNce                  # id → path (ids appear in outlines and logs)
bubble get '%p3.bTIin.%el.cmNbr' --deep      # the raw JSON of a node
```
`outline` is the map; `search` is the index; `get --deep` is the source.

## Change a text

```bash
bubble outline index                                     # find the element key
bubble get '%p3.bTGbC.%el.bTGMB4.%p.%3'                  # see the current TextExpression
bubble set '%p3.bTGbC.%el.bTGMB4.%p.%3.%e.0' '"New headline"'
```
The JSON value is a shell argument, so quote it: `'"New headline"'` for a string, `'42'` for a number.

## Add an element ✅ verified

```bash
bubble create '%p3.bTGbC.%el' '{
  "%x": "Text", "%dn": "Subtitle", "%s1": "Text_body_16_",
  "%p": {"%t": 120, "%l": 60, "%w": 300, "%h": 40, "%z": 3,
         "fit_width": true, "collapse_when_hidden": true,
         "min_height_css": "0px", "min_width_css": "0px",
         "%3": {"%x": "TextExpression", "%e": {"0": "Hello"}}}}'
```
- Parent collection is `…%el` on a page, a group, or a reusable (`%ed.<key>.%el`).
- `id`, the collection key and `_index` entries are assigned for you.
- `%t/%l/%w/%h` are px; `%z` should be above its siblings.
- **`%s1` must be a style id that exists in this app.** Get the list:
  `bubble get styles --deep | python3 -c "import json,sys;print([k for k in json.load(sys.stdin) if k!='length'])"`.
  A bogus style is the easiest way to create an issue ("… - None (Custom) is not a possible option").
  Or omit `%s1` entirely.

## Add a workflow on a button ✅ verified

```bash
# 1. the button's id (not its key) — from `bubble outline`
# 2. create the event with its actions inline; action ids are assigned automatically
bubble create '%p3.bTGbC.%wf' '{
  "%x": "ButtonClicked", "%p": {"%ei": "bTGMG4"},
  "actions": {"0": {"%x": "ShowElement", "%p": {"%ei": "bTGMG4"}},
              "1": {"%x": "HideElement", "%p": {"%ei": "bTGMG4"}}}}'
```
Verify with `bubble screenshot index --tab Workflow` — the editor should list the event and show 0 issues.

Other events: `PageLoaded` (no `%ei`), `ConditionTrue` (`"%p": {"%c": <expression>, "run_when": "every_time"}`),
`DoInterval`, `LoggedIn`. Action shapes: see [APP-JSON.md](APP-JSON.md#workflows), or copy a real one:
`bubble find <id>` on an action you like, then `bubble get <path>`.

## Verify a page really renders ✅ verified

```bash
bubble preview              # full-page PNG of the RUNNING app (scrolls first, so lazy content loads)
bubble screenshot index     # the editor's view
```
Check both. An element with too little height renders in the editor and vanishes on the live page
(see [APP-JSON.md](APP-JSON.md#two-rules-that-cost-real-debugging-time-)).

## Build a whole page programmatically ✅ verified

`examples/yaek-clone.ts` rebuilds a real landing page (~60 elements: nav, hero, terminal panel, timeline,
footer) in about 90 seconds of API calls. It's the best worked example of element JSON, positioning,
colours, fonts and text sizing:

```bash
node examples/yaek-clone.ts --wipe        # --wipe clears the page's existing elements first
```

## Check for problems ✅ verified

```bash
bubble raw run_issue_checker '{"appname":"<app>","app_version":"test"}'
```
This is the authoritative check (`{"issues": []}` = clean). Note `_index.issues_list` /
`_index.issues_sub` are a **client-maintained cache** — the editor updates them, so they can hold stale
entries after API-only edits. Clear a stale one with `bubble set '_index.issues_list.<id>' 'null'`.

## Delete something ✅ verified

```bash
bubble delete '%p3.bTGbC.%el.bTGMH4'     # element, its children, and their _index entries
bubble delete '%p3.bTGbC.%wf.bTGMT4'     # workflow
```
Deleting a button does **not** delete workflows that reference it — delete those too, or they'll
show up as issues.

## Undo ✅ verified

```bash
bubble journal 5        # what was written, with previous values
bubble undo 2           # revert the last 2 writes (newest first)
```
`undo` restores the previous value from the journal, so it works across creates, sets and deletes made
through this tool. It does **not** know about changes made by humans in the editor — for those, use the
snapshot history (`bubble history`, `bubble diff <commit> <commit>`) and set values back manually.

## Debug a failing workflow

```bash
bubble logs --since 2h --errors        # failures only
bubble logs --since 20m                # full trace: running event → running action → completed/failed
bubble runs                            # is anything running at all?
```
Rows carry ids: `bubble find <id>` → path → `bubble get <path>` shows the logic. If the logs are empty,
the workflow isn't being triggered (check the event's `%ei` points at the right element, and that the page
you're testing is the one you edited).

## See what changed in the app (incl. by humans or Bubble's AI agent)

```bash
bubble snapshot                 # commits only if something changed
bubble history 10
bubble diff HEAD~1 HEAD
bubble changes 65497010306      # raw change feed since a last_change number
```
Run `bubble snapshot` on a schedule (or use `src/watcher.ts`) and you get a full git history of a no-code app.

## Learn how Bubble encodes a feature you don't know

The reliable loop:

```bash
bubble snapshot "before"
# ...build the thing once by hand in the Bubble editor...
bubble snapshot "after" && bubble diff
```
The diff is the exact JSON to reproduce. For the wire format (rather than the result), record the editor:
`node scripts/record.ts --headed --seconds 120` (see [DISCOVERY.md](DISCOVERY.md)).

## Work on several apps

```bash
bubble --app otherapp outline index
BUBBLEIDLE_WATCH_APPS=app1,app2 node src/watcher.ts
```

## Not covered yet

- **Database rows**: use Bubble's Data API (`https://<app>.bubbleapps.io/version-test/api/1.1/obj/<type>`,
  paid plans, token from Settings → API). The editor's own data browser uses `/elasticsearch/*`, unmapped.
- **Branches / deploy**: endpoints exist (`create_new_app_version`, `deploy_app_test_and_hotfix`) but need a
  paid plan and are unverified here. `bubble raw <endpoint> '<json>'` if you want to try.
