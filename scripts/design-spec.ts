// Extract a design spec from any live web page: computed colours, fonts, sizes and geometry of every
// visible element. Use it to rebuild a design in Bubble without guessing (guessing from a screenshot or
// a raw hex dump gets the theme wrong — ask this instead).
//
//   node scripts/design-spec.ts https://example.com [--width 1440] [--wait 6] [--out spec.json]
//
// Prints a summary and writes the full JSON. Feed the JSON to your agent, or read it yourself.
import { writeFileSync } from 'node:fs';
import { openBrowser } from '../src/session.ts';

const url = process.argv[2];
if (!url) { console.error('usage: node scripts/design-spec.ts <url> [--width 1440] [--wait 6] [--out file]'); process.exit(2); }
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const width = Number(arg('width', '1440'));
const wait = Number(arg('wait', '6'));
const out = arg('out', '');

const { browser, ctx, page } = await openBrowser();
try {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait * 1000);      // let intro animations settle
  const spec = await page.evaluate(() => {
    const S = (e: Element) => getComputedStyle(e);
    const body = S(document.body);
    const nodes: any[] = [];
    const seen = new Set<string>();
    for (const e of document.querySelectorAll('body *')) {
      const r = (e as HTMLElement).getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const s = S(e);
      const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim())
        .map((n) => n.textContent!.trim().replace(/\s+/g, ' ')).join(' ');
      const hasBox = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px';
      if (!own && !hasBox) continue;
      const key = `${Math.round(r.x)},${Math.round(r.y + scrollY)},${Math.round(r.width)},${own.slice(0, 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        tag: e.tagName, x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height),
        text: own.slice(0, 80), color: s.color, bg: s.backgroundColor, fs: s.fontSize, fw: s.fontWeight,
        ff: s.fontFamily.split(',')[0].replace(/"/g, ''), ls: s.letterSpacing, lh: s.lineHeight, align: s.textAlign,
        radius: s.borderRadius, border: s.borderTopWidth !== '0px' ? `${s.borderTopWidth} ${s.borderTopColor}` : '',
        borderLeft: s.borderLeftWidth !== '0px' ? `${s.borderLeftWidth} ${s.borderLeftColor}` : '',
        shadow: s.boxShadow === 'none' ? '' : s.boxShadow,
      });
    }
    const css = [...document.styleSheets].flatMap((sh) => { try { return [...(sh as CSSStyleSheet).cssRules].map((r) => r.cssText); } catch { return []; } });
    return {
      url: location.href,
      page: { bg: body.backgroundColor, color: body.color, font: body.fontFamily, height: document.body.scrollHeight },
      animations: [...new Set(css.filter((t) => /@keyframes|animation:/.test(t)).map((t) => t.slice(0, 120)))].slice(0, 30),
      nodes,
    };
  });
  const file = out || `/tmp/design-spec-${new URL(url).hostname}.json`;
  writeFileSync(file, JSON.stringify(spec, null, 1));
  console.log(`page bg=${spec.page.bg} text=${spec.page.color} font=${spec.page.font} height=${spec.page.height}`);
  console.log(`${spec.nodes.length} nodes → ${file}`);
  if (spec.animations.length) console.log(`animations:\n  ${spec.animations.slice(0, 8).join('\n  ')}`);
  for (const n of spec.nodes.slice(0, 12)) console.log(`  ${n.tag} @${n.x},${n.y} ${n.w}x${n.h} ${n.fs}/${n.fw} ${n.color} ${n.bg !== 'rgba(0, 0, 0, 0)' ? `bg=${n.bg}` : ''} ${JSON.stringify(n.text.slice(0, 40))}`);
} finally {
  await ctx.close();
  await browser.close();
}
