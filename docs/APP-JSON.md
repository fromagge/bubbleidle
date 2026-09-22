# The app JSON language

Everything in a Bubble app (pages, elements, workflows, expressions, data types) is one JSON tree with
terse `%`-prefixed keys. Examples below come from real apps. The best way to learn a construct you don't
see here: **build it once in the editor, then `bubble snapshot` + `bubble diff`**. That shows the exact JSON.

## Common keys

| key | meaning |
|---|---|
| `%x` | type: element type (`Text`, `Button`, `Group`, `Popup`, `Input`, `Image`, `Icon`, `Link`, `RepeatingGroup`, `CustomElement`…), event type, action type, expression node type |
| `%p` | properties of the node |
| `id` | object id (short uid, see PROTOCOL §4). **Different from the collection key** the node is stored under |
| `%dn` | display name in the editor ("Button A") |
| `%nm` | name (page name; or the operator/field name on a `Message` expression node) |
| `%el` | child elements, keyed by uid (+ server-maintained `length`) |
| `%wf` | workflows on a page / reusable, keyed by uid |
| `actions` | a workflow's actions, keyed `"0"`, `"1"`, … in execution order |
| `%s` | conditional states of an element (keyed by uid) |
| `%s1` | style id (`Text_body_16_`, …; see top-level `styles`) |
| `%c` | condition expression |
| `%ei` | reference to an element **id** (not key) |
| `%ci` | on a `CustomElement` instance: id of the reusable definition |
| `%t %l %w %h %z` | top, left, width, height, z-index (px) |
| `%3` | a Text element's content (a `TextExpression`) |
| `%t1` | page title (a `TextExpression`) |
| `%f3` | fields of a data type |
| `%d` | display name (data types, fields, option values) |
| `%v` | value (field type `text`/`number`/…, or a literal in a property) |

Run `bubble legend` for the list in machine form.

## Elements

```json
{"%x": "Text", "%dn": "Text A", "id": "bTGLo1", "%s1": "Text_body_16_",
 "%p": {"%t": 60, "%l": 60, "%w": 300, "%h": 40, "%z": 2, "fit_width": true, "collapse_when_hidden": true,
        "min_height_css": "0px", "min_width_css": "0px",
        "%3": {"%x": "TextExpression", "%e": {"0": "Hello"}}}}
```
Stored at `%p3.<pageKey>.%el.<elementKey>` (nested groups: `…%el.<groupKey>.%el.<childKey>`).

Icon: `"%p": {"%9i": "fa fa-sitemap", "%ic": "rgba(158,158,158,1)", ...}`.

### Two rules that cost real debugging time ⚠️

**1. A Text element whose `%h` is smaller than one rendered line silently disappears** from the running
page. Not truncated — absent from the DOM. The editor still shows it, and `run_issue_checker` reports
nothing. Give every Text at least `ceil(%fs × %lh) + ~6` px of height (or set it to fit height).
This is the single easiest way to build a page that looks right in the editor and renders half-empty.

**2. Fonts.** `%f` is `"Family:::weight"` (`"Arial:::"`, `"var(--font_default):::600"`) but only resolves
for fonts **registered in the app**. Naming any Google font there (`"Geist:::500"`) silently falls back to
the app default — and adding `settings.client_safe.font_tokens` entries does not load the webfont either.
What does work on any app: the raw CSS properties **`font_family`** (e.g.
`"ui-monospace, SFMono-Regular, Menlo, monospace"`) and **`font_weight`** (`"600"`) in `%p`.

Also worth knowing: Bubble **lazy-renders below the fold**, so inspecting the live DOM without scrolling
makes elements look missing when they're fine. `bubble preview` scrolls before capturing.
Reusable instance: `{"%x":"CustomElement","%dn":"Header A","%p":{"%ci":"AId", ...}}`.

### Conditional states (`%s`)
```json
"%s": {"cmMoE": {"%x": "State",
  "%c": {"%x": "ThisElement", "%p": {"%ei": "bTKSY"},
         "%n": {"%x": "Message", "%nm": "is_hovered",
                "%n": {"%x": "Message", "%nm": "or_", "%a": { ...another expression... }}}},
  "%p": {"%bgc": "rgba(80,150,254,1)", "%ic": "rgba(255,255,255,1)"}}}
```

## Expressions

An expression is a chain: a **source** node (`%x`) followed by `%n` ("next") nodes, which are
`{"%x":"Message","%nm":"<operator or field>"}` with an optional argument `%a`.

| Bubble editor | JSON |
|---|---|
| `Current User is logged out` | `{"%x":"CurrentUser","%n":{"%x":"Message","%nm":"not_logged_in"}}` |
| `Input A's value` | `{"%x":"GetElement","%p":{"%ei":"cmNdK"},"%n":{"%x":"Message","%nm":"get_data"}}` |
| `This element is hovered` | `{"%x":"ThisElement","%p":{"%ei":"<id>"},"%n":{"%x":"Message","%nm":"is_hovered"}}` |
| `Get menu from page URL = "dashboard"` | `{"%x":"GetParamFromUrl","%p":{"parameter_name":{"%x":"TextExpression","%e":{"0":"menu"}}},"%n":{"%x":"Message","%nm":"equals","%a":"dashboard"}}` |
| static text | `{"%x":"TextExpression","%e":{"0":"some text"}}` |
| `A or B` | `…,"%n":{"%x":"Message","%nm":"or_","%a":<B>}` |
| `Current User's field` | `{"%x":"CurrentUser","%n":{"%x":"Message","%nm":"<field_key>"}}` |

A `TextExpression`'s `%e` holds numbered parts (`{"0":"Hi"}` for plain text). Dynamic parts are expression
objects in further slots. Not yet verified in detail, so build one in the editor and `bubble diff` before writing it.

## Workflows

```json
{"%x": "ButtonClicked", "id": "bTKaF", "%p": {"%ei": "bTKSN"},
 "actions": {
   "0": {"%x": "ScrollToElement", "id": "bTLDj", "%p": {"%ei": "bTHLK"}},
   "1": {"%x": "ChangePage", "id": "bTKaI",
         "%p": {"%ei": "bTHLK", "add_parameters": true,
                "url_parameters": {"0": {"%k": "menu", "%v": {"%x":"TextExpression","%e":{"0":"graphs"}}}}}}}}
```
Stored at `%p3.<pageKey>.%wf.<wfKey>`. `%p.%ei` is the **id** of the triggering element.

Event types seen: `ButtonClicked`, `ConditionTrue` (`%p.%c` + `run_when: "every_time"|…`), `PageLoaded`,
`DoInterval`, `LoggedIn`, `APIEvent` (backend workflow under `api`), plugin events `<pluginId>-<key>`.

Action types seen (`%x`) and key params:

| action | `%p` |
|---|---|
| `ChangePage` | `%ei`: page id; `add_parameters`, `url_parameters` |
| `ScrollToElement`, `ShowElement`, `HideElement`, `SetFocusToElement`, `AnimateElement` | `%ei`: element id |
| `SetCustomState` | `%ei`: element id, `custom_state`: `"custom.<name>_"`, `%v`: value |
| `LogIn` | `%em`: email expression, `%pw`: password expression |
| `SignUp`, `LogOut`, `ResetPassword`, `UpdateCredentials`, `MakeChangeCurrentUser`, `ResetInputs`, `OpenURL`, `PauseWFClient` | (inspect with `bubble get` on an existing one) |
| plugin actions | `%x` = `<pluginId>-<key>` |

Workflow-level conditions go in `%p.%c`. Disabled: `%p.workflow_disabled: true`.

## Data types (`user_types`)

```json
"ezchart": {"%d": "EzChart",
            "%f3": {"lable_text": {"%d": "Lable", "%v": "text"},
                    "datanumber_number": {"%d": "DataNumber", "%v": "number"}}}
```
The field key is `<name>_<type>`. `user` is the built-in User type. Privacy rules live in
`<type>.privacy_role.<role>` with `%c` (condition) and `permissions` (`view_all`, `search_for`, …).

## Option sets

```json
"%ts": {"%d": "Tabs", "values": {"my_details": {"%d": "My Details", "sort_factor": 1}, ...}}
```

## Backend workflows (`api`)
```json
"cmOiW": {"%x": "APIEvent", "id": "cmOiU", "%p": {"expose": false}}
```
