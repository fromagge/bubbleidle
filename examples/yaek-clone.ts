// Example: build a landing page in a Bubble app entirely over the editor API.
// Recreates https://yaek.app on a page of the configured app.
//
//   node examples/yaek-clone.ts [--page index] [--wipe]
//
// --wipe deletes the page's existing elements first. Every write is journaled, so `bubble undo <n>`
// or a snapshot diff can roll it back.
import { BubbleClient } from '../src/client.ts';
import { listPages, outlinePage, snapshot } from '../src/app.ts';
import { createNode, setPath, deleteNode } from '../src/edits.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const pageName = arg('page', 'index')!;
const wipe = process.argv.includes('--wipe');

const c = new BubbleClient();
const page = (await listPages(c)).find((p) => p.name === pageName);
if (!page) throw new Error(`no page ${pageName}`);
const EL = [...page.path, '%el'];

// ---- palette / type scale (from yaek.app) --------------------------------
const BG = 'rgba(13,20,32,1)';         // #0d1420
const PANEL = 'rgba(10,15,24,1)';
const BORDER = 'rgba(28,38,53,1)';     // #1c2635
const FG = 'rgba(233,237,243,1)';
const MUTED = 'rgba(107,118,136,1)';   // #6b7688
const GREEN = 'rgba(127,208,163,1)';   // #7fd0a3
// Fonts: `%f` ("Family:::weight") only works for fonts registered in the app, and a Google font name
// alone is NOT loaded at runtime — it silently falls back to the app default. `font_family` (raw CSS)
// and `font_weight` do work, so use those. Hence the system mono stack rather than Geist Mono.
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const W = 1080;

let z = 2;
type T = { x: number; y: number; w: number; h?: number; text: string; size?: number; color?: string;
           mono?: boolean; weight?: string; align?: string; lh?: number };

// IMPORTANT: a Text element whose %h is smaller than one rendered line is dropped from the page
// entirely at runtime (it still looks fine in the editor and raises no issue). Always give it room.
const minHeight = (size: number, lh: number) => Math.ceil(size * lh) + 6;

async function text({ x, y, w, h, text, size = 16, color = FG, mono, weight, align, lh = 1.5 }: T) {
  const p: Record<string, unknown> = {
    '%t': y, '%l': x, '%w': w, '%h': Math.max(h ?? 0, minHeight(size, lh)), '%z': z++,
    '%fs': size, '%fc': color, '%lh': lh,
    fit_width: false, collapse_when_hidden: true, min_height_css: '0px', min_width_css: '0px',
    '%3': { '%x': 'TextExpression', '%e': { '0': text } },
  };
  if (mono) p.font_family = MONO_STACK;
  if (weight) p.font_weight = weight;
  if (align) p['%fa'] = align;
  const r = await createNode(c, EL, { '%x': 'Text', '%dn': text.slice(0, 28), '%p': p });
  return r.id;
}

async function box({ x, y, w, h, bg = PANEL, border = BORDER, radius = 12 }: { x: number; y: number; w: number; h: number; bg?: string; border?: string; radius?: number }) {
  return createNode(c, EL, {
    '%x': 'Group', '%dn': 'Panel', '%p': {
      '%t': y, '%l': x, '%w': w, '%h': h, '%z': z++, '%bgc': bg, '%br': radius, '%bw': 1, '%bc': border, '%bs': 'none', '%bos': 'solid',
      container_layout: 'fixed', min_height_css: '0px', min_width_css: '0px',
    },
  });
}

async function button({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return createNode(c, EL, {
    '%x': 'Button', '%dn': `Button ${label}`, '%p': {
      '%t': y, '%l': x, '%w': w, '%h': h, '%z': z++, '%bgc': FG, '%fc': BG, font_weight: '500', '%fs': 15, '%br': 8,
      fit_width: false, min_height_css: '0px', min_width_css: '0px',
      '%3': { '%x': 'TextExpression', '%e': { '0': label } },
    },
  });
}

// ---- go ------------------------------------------------------------------
await snapshot(c, 'before yaek clone');

if (wipe) {
  const existing = (await c.load([...page.path, '%el'])) as Record<string, unknown> | null;
  for (const key of Object.keys(existing ?? {})) {
    if (key !== 'length') await deleteNode(c, [...EL, key]);
  }
}

// page: dark background, tall enough for the whole thing
await setPath(c, [...page.path, '%p', 'backdrop_bgcolor'], BG);
await setPath(c, [...page.path, '%p', '%bgc'], BG);
await setPath(c, [...page.path, '%p', '%h'], 2760);
await setPath(c, [...page.path, '%p', 'min_height_px'], 2760);
await setPath(c, [...page.path, '%p', '%t1'], { '%x': 'TextExpression', '%e': { '0': 'Yaek — the calendar you can talk to like a computer' } });

const L = 140, CW = 800;   // left margin, content width

// nav
await text({ x: L, y: 32, w: 120, text: 'Yaek', size: 18, weight: '600' });
await button({ x: W - L - 96, y: 26, w: 96, h: 36, label: 'Sign in' });

// hero
await text({ x: L, y: 132, w: CW, text: 'a calendar · a task list · a habit loop · a terminal', size: 13, color: MUTED, mono: true });
await text({ x: L, y: 168, w: CW, h: 120, text: 'The calendar you can talk to like a computer.', size: 46, weight: '600', lh: 1.15 });
await text({ x: L, y: 300, w: CW, h: 52, text: 'Yaek gathers your calendars into one quiet place — and it will explain itself. Ask it:', size: 18, color: MUTED });

// terminal panel
const termY = 376, termH = 392;
await box({ x: L, y: termY, w: CW, h: termH });
await text({ x: L + 24, y: termY + 18, w: 300, text: '~/ — yaek', size: 12, color: MUTED, mono: true });
const term: [string, string[]][] = [
  ['$ yaek what-are-you', [
    'One calendar view for Google, iCloud, Outlook and CalDAV.',
    'Tasks you can drop onto the week, or track by the hour.',
    'Habits that resurface each morning. That is the whole app.']],
  ['$ yaek what-do-you-keep --about me', [
    'As little as possible. Flip retention off and: nothing.',
    'yaek forget --all wipes your account. No 30-day limbo.']],
  ['$ yaek is-the-ai-on', ['no. it stays off until you turn it on.']],
];
let ty = termY + 52;
for (const [cmd, out] of term) {
  await text({ x: L + 24, y: ty, w: CW - 48, text: cmd, size: 14, color: GREEN, mono: true });
  ty += 26;
  for (const line of out) {
    await text({ x: L + 24, y: ty, w: CW - 48, text: line, size: 14, color: MUTED, mono: true });
    ty += 22;
  }
  ty += 14;
}
await text({ x: L + 24, y: ty, w: 40, text: '$', size: 14, color: GREEN, mono: true });

// cta
await button({ x: (W - 120) / 2, y: 812, w: 120, h: 44, label: 'Sign in' });
await text({ x: L, y: 872, w: CW, text: 'no tracking · no ads · leaves no trace if you ask', size: 13, color: MUTED, mono: true, align: 'center' });

// day section
await text({ x: L, y: 952, w: CW, text: 'instead of a feature grid', size: 13, color: GREEN, mono: true });
await text({ x: L, y: 982, w: CW, h: 44, text: 'Here’s a day, scheduled in Yaek', size: 34, weight: '600' });

const day: [string, string, string, string][] = [
  ['07:30', 'Morning check-in', 'habit', 'Your habits surface once, quietly. Tick them off and they sink to the bottom until tomorrow. Streaks count themselves — nothing shouts at you.'],
  ['09:00', 'One week, every account', 'calendar', 'Work Google, personal iCloud, the team Outlook — merged into a single week you can drag things around in. Deselect a calendar and it gets out of the way.'],
  ['13:00', 'Timeframe a task, or track it', 'task', 'Two kinds of tasks: ones you drop onto the calendar as a block of time, and ones you log hours against toward a monthly target. Kanban if you like columns.'],
  ['16:00', 'Ask the assistant — if you want', 'optional · off by default', '“Find me two hours for the proposal this week.” It answers from your own calendar and nothing else. Never on unless you turned it on; never trained on your data.'],
  ['23:59', 'And if you want to leave no trace', 'privacy', 'Retention is a setting, not a promise buried in a policy. Turn it off and Yaek keeps only your live week. Or wipe everything:'],
];
let dy = 1064;
for (const [time, title, tag, body] of day) {
  await text({ x: L, y: dy + 2, w: 90, text: time, size: 14, color: GREEN, mono: true });
  await text({ x: L + 110, y: dy, w: 440, text: title, size: 20, weight: '500' });
  await text({ x: L + 110, y: dy + 28, w: 300, text: tag, size: 12, color: MUTED, mono: true });
  await text({ x: L + 110, y: dy + 56, w: 690, h: 52, text: body, size: 15, color: MUTED });
  dy += 148;
}
await text({ x: L + 110, y: dy - 40, w: 400, text: '$ yaek forget --all', size: 14, color: GREEN, mono: true });
await text({ x: L + 110, y: dy - 16, w: 500, text: 'account + data deleted. gone means gone.', size: 14, color: MUTED, mono: true });

// honest bit
const hy = dy + 60;
await text({ x: L, y: hy, w: CW, text: 'the honest bit', size: 13, color: GREEN, mono: true });
await text({ x: L, y: hy + 30, w: CW, h: 80, text: 'No testimonials on this page. No “trusted by 10,000 teams.” Just what it does.', size: 28, weight: '600', lh: 1.3 });

const honest: [string, string][] = [
  ['It syncs with', 'Google Calendar, iCloud, Outlook, Fastmail and anything CalDAV. That list is complete, not “and more.”'],
  ['The CLI is not a gimmick.', 'Yaek was terminal-first; the window came second. Both read the same local store.'],
  ['No prices on this page yet.', 'When there are, they will be plain numbers right here — not “contact sales.”'],
  ['We are small.', 'If something breaks, the person who wrote it reads your email.'],
];
let oy = hy + 130;
for (const [head, body] of honest) {
  await text({ x: L, y: oy, w: 260, text: '—', size: 14, color: MUTED, mono: true });
  await text({ x: L, y: oy + 24, w: 300, text: head, size: 16, weight: '500' });
  await text({ x: L + 330, y: oy + 24, w: 470, h: 48, text: body, size: 15, color: MUTED });
  oy += 104;
}

// footer
const fy = oy + 40;
await button({ x: (W - 120) / 2, y: fy, w: 120, h: 44, label: 'Sign in' });
await text({ x: L, y: fy + 96, w: 120, text: 'Yaek', size: 16, weight: '600' });
await text({ x: L, y: fy + 124, w: 420, text: '© 2026 Yaek · Privacy · Terms', size: 13, color: MUTED, mono: true });

const snap = await snapshot(c, 'yaek clone');
console.log(await outlinePage(c, pageName));
console.log('snapshot:', snap.commit, snap.stat?.trim());
