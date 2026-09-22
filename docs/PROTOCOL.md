# Bubble editor protocol (reverse-engineered)

Bubble has no public API for editing an app's structure. The editor at `bubble.io/page?id=<app>` is a big
JavaScript app that talks to `https://bubble.io/appeditor/*` over plain JSON/HTTP. This doc is everything
bubbleidle relies on. All of it was observed from real traffic (HAR recordings) and from the editor bundle
(`edit.js`). See [DISCOVERY.md](DISCOVERY.md) for how, and how to re-verify when Bubble changes something.

> Status legend: ✅ verified end-to-end by bubbleidle · 👀 observed in traffic/code, not yet exercised

## 1. Auth ✅

- Log in at `https://bubble.io/login?mode=login` (note: `/log-in` is a 404). The page contains a hidden
  sign-up form with its own email/password inputs; use the *visible* email input and `#login-password`,
  then click the visible **Log in** button. Google/SSO accounts can't use this — use an email+password account.
- Auth lives in cookies on `bubble.io`: `meta_live_u2main`, `meta_live_u2main.sig`, `meta_u1main`.
  bubbleidle logs in once with headless Chromium, saves Playwright `storageState`, and then sends every
  cookie for `*.bubble.io` on plain `fetch` requests.
- Headers sent (the minimum that works): `content-type: application/json`, `origin: https://bubble.io`,
  `x-requested-with: XMLHttpRequest`, `x-bubble-appname: <app>`, `x-bubble-platform: web`,
  `x-bubble-breaking-revision: 5`, a normal desktop Chrome `user-agent` (headless Chromium advertises
  `HeadlessChrome` — don't send that).
- Expired session → 401/403 or "not logged in" → log in again. **Exception:** 401 with
  `"Your plan does not allow..."` is a plan limit, not an auth failure; don't retry.
- One login = one person per Bubble ToS, one concurrent session. Use a dedicated bot account added as a
  collaborator; don't share the human's login.

## 2. Reading the app definition ✅

The whole app is one JSON tree ("app JSON"). You read it by **path arrays** (`["%p3","bTGbC","%el"]`).

### `POST /appeditor/load_multiple_paths/<app>/<version>`

```json
{"path_arrays": [["settings"], ["_index","page_name_to_path"], ["%p3","bTGbC"]], "no_chunking": false}
```
Response:
```json
{"last_change": 65497010306,
 "data": [ {"path_version_hash": "59e5c9493f..."},       // big → fetch with load_single_path
           {"data": {"index": "%p3.bTGbC", ...}},        // small → inline
           {"keys": ["id_to_path", "issues_sub", ...]}, // huge → list of child keys; load each child
           {"data": null} ]}                             // doesn't exist
```
`version` is `test` (development) or `live`, or a branch id on paid plans.

### `GET /appeditor/load_single_path/<app>/<version>/<path_version_hash>/<seg1>/<seg2>/...`

Each path segment is **base32-encoded UTF-8** with the alphabet `0123456789abcdefghjkmnpqrtuvwxyz`
(Crockford without `s`, plus `u`), MSB-first, no padding. `settings` → `edjq8x39dtkq6`,
`_index` → `bxmpwt35f0`. Response is `{"last_change", "data"}` **or** `{"last_change", "keys":[...]}`
for very large nodes (recurse). Implementation: `encodeSegment()` in `src/client.ts`.

### The root can't be listed

`[[]]` returns null. Known top-level keys:

| key | contents |
|---|---|
| `%p3` | pages (`%x: "Page"`, `%nm` = page name); deleted pages may linger as `null` tombstones |
| `%ed` | reusable element definitions (names in `_index.custom_name_to_id`; instances are `%x: "CustomElement"` with `%p.%ci` = definition id) |
| `_index` | `id_to_path`, `page_name_to_path`, `page_name_to_id`, `custom_name_to_id`, `issues_list`, `issues_sub`, `type_to_path`, `responsive` |
| `user_types` | data types (fields in `%f3`) and their privacy rules (`privacy_role`) |
| `option_sets` | option sets |
| `api` | backend (API) workflows |
| `styles` | style definitions |
| `settings` | app settings (`client_safe`, `secure`) incl. API connector config |
| `mobile_views` | native mobile views |
| `element_definitions`, `global_expressions` | present on some apps; often null |
| `_id`, `creation_date`, `last_change`, `last_change_date`, `uid_counter`, `favicon` | scalars |

`_index.id_to_path` maps **every object id to its dotted path** (`"bTGky": "%p3.AAX.%el.bTHDP"`) —
the fastest way to find anything.

### Full export 👀
`GET /appeditor/export/<version>/<app>.bubble` returns the whole app as a `.bubble` file, **but only on
paid plans** (free plan → 401 "Your plan does not allow you to download your app"). bubbleidle walks the
tree instead (`dumpApp()`), which works on every plan.

## 3. Writing ✅

### `POST /appeditor/write`

```json
{"v": 1, "appname": "test-28320", "app_version": "test",
 "changes": [
   {"body": "%p3.bTGbC.%el.bTGLq1", "path_array": ["_index","id_to_path","bTGLo1"],
    "intent": {"name": "Update index"}, "version_control_api_version": 4, "changelog_data": [],
    "session_id": "1790097631994x50"},
   {"body": {"%x": "Text", "%dn": "Text A", "id": "bTGLo1", "%s1": "Text_body_16_",
             "%p": {"%t": 236, "%l": 315, "%w": 100, "%h": 36, "%z": 2, "fit_width": true}},
    "path_array": ["%p3","bTGbC","%el","bTGLq1"],
    "intent": {"name": "CreateElement", "id": 1, "source_appname": ""}, "version_control_api_version": 4,
    "changelog_data": [], "session_id": "1790097631994x50"},
   {"body": "[]", "path_array": ["_index","issues_list","bTGLo1"], "intent": {"name":"Update index"}, ...},
   {"type": "id_counter", "value": 10000012}
 ]}
```
Response: `{"last_change": "65497064995", "last_change_date": "...", "id_counter": "10000012"}`

Rules learned:
- A change **sets the value at `path_array` to `body`**. Any depth works (e.g. set just
  `…%el.<key>.%p.%3.%e.0` to change a text). `body: null` **deletes**.
- Changes in one request are applied together. The editor sends the node + index updates in one batch;
  do the same.
- **Keep `_index.id_to_path` in sync**: add an entry when creating an object with an `id`, set it to null
  when deleting. The editor also maintains `_index.issues_list.<id>` (`"[]"`) and
  `_index.issues_sub.<pageId>` (JSON string list of ids with issues); optional for correctness.
- Keyed collections (`%el`, `%wf`) have a `length` field the **server** maintains. Don't write it; skip it
  when iterating.
- `intent.name` is free-form metadata for Bubble's change history (`CreateElement`, `RemoveElement`,
  `Update index`, …). `session_id` format `<ms timestamp>x<2 digits>`; any stable value per process works.
- Include `{"type":"id_counter","value":N}` whenever you allocated new ids (see §4).
- **Nested nodes need ids too.** A workflow's `actions.<n>` each carry their own `id` and their own
  `_index.id_to_path` entry (`…%wf.<key>.actions.0`). `createNode()` assigns these automatically.
- `_index.issues_list` / `_index.issues_sub` are a **client-side cache** of the editor's issue checker,
  not the source of truth: they can keep stale entries after API-only edits. The authoritative check is
  `POST /appeditor/run_issue_checker {"appname","app_version"}` → `{"issues": [...]}` ✅.
- Writes to `live` are rejected by bubbleidle (and `live` is `readonly` in `get_versions`).

The editor also shows the change live to any open editor tab (verified: HTTP-created element appears in
the editor with 0 issues).

## 4. Object ids ✅

Every element/workflow/action has an `id`, and every keyed collection entry has a key; both are
"short uids" generated from a **shared per-app counter**:

1. `POST /appeditor/check_count` `{"appname", "browser_id"}` → `{"id_counter": 10000000, "editor_id": 1}`.
   `browser_id` is a random 7-digit string the client keeps forever (bubbleidle stores it in
   `.state/browser-id`); `editor_id` is tied to it and becomes the id **suffix**.
2. Reserve: counters are taken in batches of 6, using the top 3 of each batch
   (`count+4, count+5, count+6`), then `POST /appeditor/set_count {"appname","count": count+6}`.
3. Encode: `short_uid(counter, editor_id)` — base-52 (`A–Z a–z`), 3 digits if < 70304,
   5 digits (+190102016 offset) if < 175478784, else 10 digits (+0x1edcf7bcf280000); append `editor_id`.
   `10000004, editor 1` → `bTGLo1`.
4. Send `{"type":"id_counter","value": <new count>}` in the write.

The editor refuses to write with a bad counter ("Invalid uid counter; aborting action to avoid damage
to app") — always go through `reserveUids()` in `src/client.ts`.

## 5. Logs & monitoring

### Server logs ✅ `POST /appeditor/get_jetstream_logs`
```json
{"ascending": true,
 "tags": {"message": ["running event","event condition passed","event condition failed, terminating",
                      "running action","action condition failed","action completed","event completed",
                      "failed because of error","server_db.modify"],
          "appname": "test-28320", "app_version": "test"},
 "after": 1790097638138, "before": 1790097758139, "is_state_ar": true}
```
→ `{"rows": [{..., "tags": {"message": ...}}]}`. Filter `message` to `["failed because of error"]` for
errors. The editor pages through results by moving `after`/`before`.

### Other ✅
- `POST /appeditor/get_workflow_runs {"appname","platform":"web"}` → current + monthly run counts
- `POST /appeditor/get_versions {"appname"}` → versions/branches (`live`, `test`, branches on paid plans)
- `POST /appeditor/get_current_user_permissions {"appname","app_version"}` →
  `{"admin","master","permissions":{"app":"can_edit","data":"can_edit","logs":"can_view"}}`
- `GET /appeditor/changes/<app>/<version>/<last_change>/<session_id>` → changes by others since
  `last_change` (`[]` if none). `last_change` comes back on every load/write.

## 6. Endpoint catalogue 👀

All `server://appeditor/<name>` endpoints referenced by the editor bundle (POST JSON unless noted).
Use `bubble raw <name> '<json>'` to call any of them. Interesting ones:

| area | endpoints |
|---|---|
| read/write | `load_multiple_paths`, `load_single_path`, `write`, `changes`, `get_latest_changes`, `derived`, `calculate_derived`, `warm_derived` |
| ids | `check_count`, `set_count` |
| versions | `get_versions`, `create_new_app_version` `{appname, app_version, from_app_version, version_control_api_version}`, `copy_app_version`, `delete_app_version`, `commit_test_version`, `deploy_app_test_and_hotfix`, `restore_to`, `get_restore_history`, `detect_conflicts`, `finalize_merge` |
| issues | `check_app_issues`, `run_issue_checker` |
| logs/usage | `get_jetstream_logs`, `get_workflow_runs`, `read_time_series`, `get_usage_data2`, `get_workload_usage_breakdown`, `get_page_load_metrics` |
| data | `list_bulk_operations`, `run_bulk`, `schedule_bulk_operation`, `schedule_csv_upload`, `schedule_data_export`, `get_db_size`, `list_upcoming_tasks`, `cancel_task` |
| plugins | `get_plugin`, `get_installed_libraries`, `save_plugin`, `get_raw_plugin` |
| export/import | `export` (GET, paid), `import` |
| AI agent | `get_agent_permissions`, `set_agent_permissions`, `list_pending_ai_edit_undos`, `get_ai_credit_balance` |

Full list: see `grep -oE 'server://appeditor/[a-zA-Z0-9_]+'` over the bundle (DISCOVERY.md §3).

## 7. Things not done yet

- **Database rows** (the Data tab). The editor queries app data through `/elasticsearch/msearch|mget`
  and the app's own domain; not mapped yet. For now use Bubble's official Data API
  (`https://<app>.bubbleapps.io/version-test/api/1.1/obj/<type>`, needs Settings → API enabled + token).
- **Deploy / branches** — needs a paid plan; endpoints listed above, not exercised.
