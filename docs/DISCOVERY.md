# How this was reverse-engineered (and how to redo it)

Bubble ships editor updates constantly. Nothing here is a supported API, so when something breaks, you
re-run this process. It took about an hour the first time; redoing a piece of it takes ~20 minutes.

Everything below was done from a throwaway Bubble account on a scratch app, with a headless Chromium
driven by Playwright. No Bubble source was decompiled; the editor bundle is public JavaScript.

## The method, in one line

**Drive the real editor, record the traffic, replay it as plain HTTP.**

## 1. Get in

- `https://bubble.io/log-in` is a 404 — the real form is `https://bubble.io/login?mode=login`.
- The login page also contains a **hidden sign-up form** with its own `input[type=email]` and
  `input[type=password]`. Naive selectors grab those and time out. Use the visible email input,
  `#login-password`, and the visible `Log in` button (`src/session.ts`).
- After login, `https://bubble.io/home/projects` lists the apps. The dashboard fetches them through
  `POST /elasticsearch/msearch`; the response contains `"app_name_text"` (display name) and
  `"realappname_text"` (**the app id you need**). `bubble apps` reads them off the wire.

## 2. Record the editor

```bash
node scripts/record.ts --headed --seconds 180        # a human clicks around; all traffic is captured
node scripts/record.ts --tab Logs --seconds 20       # headless, just load a tab
```
It writes `.state/har/<name>.har` (**contains session cookies — never commit**) and prints every
`/appeditor/*` call with request and response bodies (`write` calls in full).

Load the Design tab once and you'll see the read protocol: `load_multiple_paths` with `path_arrays`,
`load_single_path/<app>/<version>/<hash>/<encoded-path>`, plus `check_count` / `set_count` for ids.

To decode HARs by hand:
```python
import json; h=json.load(open('.state/har/x.har'))
for e in h['log']['entries']:
    if '/appeditor/' in e['request']['url']:
        print(e['request']['method'], e['request']['url'])
        print(' REQ ', (e['request'].get('postData') or {}).get('text','')[:400])
        print(' RESP', (e['response'].get('content') or {}).get('text','')[:400])
```

## 3. Read the editor bundle

```bash
node scripts/bundle-endpoints.ts                 # every server://appeditor/<name> the editor can call (~212)
node scripts/bundle-endpoints.ts --grep write    # code context around a string
```
The bundle (~22 MB `edit.js`, plus `pre_edit.js` and `edit_optional.js`) is minified but readable. It's how
the following were recovered — grep for the constant or function name to re-check them:

| what | where to look |
|---|---|
| write payload shape | `location.post("server://appeditor/write"` — the `send()` function just above it builds `{v, appname, app_version, changes:[…]}` |
| id generation | `function short_uid(` and `ALPHABET=` / `THREE_DIGIT_MAX` / `FIVE_DIGIT_OFFSET` constants |
| id batching | `UID_BATCH_SIZE`, `SKIPPED_PORTION_OF_BATCH_SIZE`, `get_count_or_throw` |
| log query shape | `server://appeditor/get_jetstream_logs` (its `fetch_params`) |
| permissions | `current_user_rights()` |

## 4. Work out the path encoding

`load_single_path` URLs encode each path segment. Collect the encoded segments from a HAR, match them to
the path arrays in the preceding `load_multiple_paths` request, and brute-force the alphabet:

```python
# base32, MSB-first, no padding; try candidate alphabets until every segment decodes to ASCII
alpha = '0123456789abcdefghjkmnpqrtuvwxyz'   # ← the answer: Crockford minus 's', plus 'u'
```
`settings` → `edjq8x39dtkq6`, `_index` → `bxmpwt35f0`.

## 5. Capture a real write before writing anything

Don't guess the write format — make the editor do it:

```bash
node scripts/record.ts --seconds 25 --name add-element   # with a scripted drag, or --headed and do it by hand
```
Adding one Text element produced **four** changes in one request: the element node, `_index.id_to_path`,
`_index.issues_list`, `_index.issues_sub`, plus an `id_counter` entry. Deleting produced the same paths with
`body: null`. That's where the rules in [PROTOCOL.md §3](PROTOCOL.md#3-writing-) come from.

**This is the technique for anything not yet mapped**: do it once in the editor with recording on, read the
payload, then reproduce it. The alternative — `snapshot`, do it in the editor, `snapshot`, `diff` — shows
the resulting JSON without the wire format, and is usually enough for learning node shapes.

## 6. Verify end-to-end

The check that matters: create something over HTTP, then open the editor and look.

```bash
node bin/bubble.ts create '%p3.<page>.%el' '{...}' && node bin/bubble.ts screenshot index
```
The element must render **and the editor's issue counter must stay at 0**. Then `undo 1` and confirm it's
gone, including its `_index` entry (`find <id>` → null).

## What was checked and what wasn't

Verified end-to-end on a live app: login, session reuse, reading the whole tree (incl. chunked nodes),
snapshots/diffs, creating an element, setting a deep property, deleting, undo, logs query, versions,
permissions, run counts, change feed, screenshots.

Observed but not exercised: branch creation, deploy, merge/conflict endpoints (paid plans), plugin
endpoints, bulk data operations, `import`/`export` (paid), the AI-agent endpoints.

Not mapped: **database rows** (the Data tab uses `/elasticsearch/*` against the app's own domain).
