/*
 * site-tests/readability.test.mjs (task D1-fix1)
 *
 * What it proves: the site stays easy to read on a phone and on a desktop.
 *   1. Contrast: the key text colours meet WCAG AA (4.5:1, the normal-text bar) on every surface they
 *      actually sit on. Colours are read from public/styles.css itself (the :root tokens and the rules
 *      that use them), so changing a token or a surface re-runs the maths. Translucent surfaces are
 *      composited over --bg, which is what the page shows behind them; a gradient is checked at every
 *      colour stop.
 *   2. Text size: no font-size in the stylesheet is below 0.875rem (14px). The one exception is
 *      `font-size: 0`, which hides a label visually (the phone "View" arrow keeps only its icon) and so
 *      is not visible text.
 *   3. Body and description text is 1rem (16px) or more with a line-height of 1.5 or more, button
 *      labels are 1rem or more, and buttons and other tap targets are at least 44px tall.
 *
 * When this fails: pick a lighter text colour (or a darker surface) from the brand palette at the top
 * of styles.css, or raise the font-size / min-height named in the message. Then run
 * `node site-tests/bump-asset-versions.mjs`, because styles.css changed.
 *
 * Node built-ins only. CI runs it with the other site tests: node --test site-tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles.css');
const CSS = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // comments out first
const ROOT_PX = 16; // browsers' default root font size; rem values are multiples of it
const AA_NORMAL = 4.5;
const MIN_TEXT_PX = 14;

// ---------------------------------------------------------------- Parsing the stylesheet

/**
 * Every innermost rule in the stylesheet, as { selectors: string[], decls: Map<prop, value> }.
 * A rule inside @media is found too (its selector text starts after the @media brace); the @media
 * wrapper itself is never matched because its body contains braces. Later rules come later in the list.
 */
function parseRules(css) {
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = new Map();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s*!important$/, ''));
    }
    rules.push({ selectors, decls });
  }
  return rules;
}
const RULES = parseRules(CSS);

/** All values a selector (exact match in a selector list) gives a property, in file order. */
function declsFor(selector, prop) {
  return RULES.filter((r) => r.selectors.includes(selector) && r.decls.has(prop)).map((r) => r.decls.get(prop));
}

/** The first value a selector gives a property; fails the test when the stylesheet has none. */
function declFor(selector, prop) {
  const values = declsFor(selector, prop);
  assert.ok(values.length > 0, `styles.css has no "${prop}" for "${selector}" (did a selector change?)`);
  return values[0];
}

/** The custom properties (tokens) from the first :root block. */
const TOKENS = RULES.find((r) => r.selectors.includes(':root')).decls;

/** Replaces var(--x) with the token's value, recursively. */
function resolveVars(value) {
  let out = value;
  for (let i = 0; i < 10 && out.includes('var('); i += 1) {
    out = out.replace(/var\((--[\w-]+)\)/g, (_, name) => {
      assert.ok(TOKENS.has(name), `token ${name} is not defined in :root`);
      return TOKENS.get(name);
    });
  }
  return out;
}

// ---------------------------------------------------------------- Colour maths (WCAG 2.x)

/** Parses #rgb, #rrggbb or rgb()/rgba() into { r, g, b, a } (0-255 channels, alpha 0-1). */
function parseColor(text) {
  const value = resolveVars(text.trim());
  let m = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  assert.ok(m, `cannot read colour "${text}" (resolved to "${value}")`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** Every colour in a background value (a plain colour or each stop of a gradient), in order. */
function colorsIn(text) {
  const value = resolveVars(text);
  const found = value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi) || [];
  assert.ok(found.length > 0, `no colour found in "${text}"`);
  return found.map(parseColor);
}

/** Paints a (possibly translucent) colour over an opaque one, as the browser does. */
function over(top, base) {
  const mix = (t, b) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a: 1 };
}

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two opaque colours (1 to 21). */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- The surfaces text sits on

const BG = parseColor(declFor(':root', '--bg'));

/** The opaque colours a selector's background shows: each stop composited over --bg. */
function surface(selector, prop = 'background') {
  return colorsIn(declFor(selector, prop)).map((c) => over(c, BG));
}

/** Named surfaces. "page glow" is --bg under the brightest nebula glow of the page background. */
const SURFACES = {
  'page --bg': [BG],
  'page glow': [over(colorsIn(declFor('html::before', 'background'))[0], BG)],
  'service card': surface('.card'),
  'panel': surface('.panel'),
  'info block': surface('.info'),
  'menu panel': surface('.mobile-panel'),
  'footer': surface('.site-footer'),
  'header': surface('.site-header::before'),
  'price pill': surface('.price-pills a'),
  'ghost button': surface('.btn-ghost'),
  'form field': surface('input', 'background-color'),
};

/**
 * The key text/background pairs: [what, text colour value, surface names].
 * Each entry is a colour the page really uses, read from the rule that uses it.
 */
const PAIRS = [
  ['body text', declFor('body', 'color'), ['page --bg', 'page glow', 'service card', 'panel', 'info block', 'footer']],
  ['soft text (lead, lists, info)', 'var(--text-soft)', ['page --bg', 'page glow', 'service card', 'panel', 'info block', 'footer', 'price pill']],
  ['muted text', 'var(--muted)', ['page --bg', 'page glow', 'service card', 'panel', 'info block', 'menu panel', 'footer']],
  ['card price line', declFor('.card-meta', 'color'), ['service card']],
  ['link colour', declFor('a', 'color'), ['page --bg', 'page glow', 'panel', 'info block']],
  ['card "View" link', declFor('.card-go', 'color'), ['service card']],
  ['kicker / eyebrow violet', declFor('.kicker', 'color'), ['page --bg', 'page glow', 'menu panel']],
  ['header brand line', declFor('.brand-sub', 'color'), ['header']],
  ['footer link', declFor('.site-footer a', 'color'), ['footer']],
  ['ghost button label', declFor('.btn', 'color'), ['ghost button']],
  ['form field text', declFor('input', 'color'), ['form field']],
  ['form placeholder', declFor('::placeholder', 'color'), ['form field']],
];

/** Every ratio, for the handoff table and for the assertions below. */
function allRatios() {
  const rows = [];
  for (const [what, fg, surfaces] of PAIRS) {
    const text = parseColor(fg);
    for (const name of surfaces) {
      assert.ok(SURFACES[name], `unknown surface ${name}`);
      for (const bg of SURFACES[name]) rows.push({ what, on: name, ratio: contrast(over(text, bg), bg) });
    }
  }
  // Primary buttons: dark label on the brand gradient, checked at both ends and every stop between.
  const label = parseColor(declFor('.btn-primary', 'color'));
  const stops = colorsIn(declFor('.btn-primary', 'background')).map((c) => over(c, BG));
  assert.ok(stops.length >= 2, 'the primary button gradient should have at least two stops');
  stops.forEach((stop, i) => {
    const end = i === 0 ? 'start' : i === stops.length - 1 ? 'end' : `stop ${i + 1}`;
    rows.push({ what: 'primary button label', on: `gradient ${end}`, ratio: contrast(label, stop) });
  });
  return rows;
}

// ---------------------------------------------------------------- Tests

// Proves: every key text colour reaches WCAG AA 4.5:1 on each surface it sits on, including the dark
// label at both ends of the gradient buttons.
test('text colours meet WCAG AA contrast on their surfaces', (t) => {
  const rows = allRatios();
  for (const row of rows) t.diagnostic(`${row.what} on ${row.on}: ${row.ratio.toFixed(2)}:1`);
  const failing = rows.filter((row) => row.ratio < AA_NORMAL);
  assert.deepEqual(
    failing.map((row) => `${row.what} on ${row.on}: ${row.ratio.toFixed(2)}:1`),
    [],
    `below AA ${AA_NORMAL}:1`,
  );
});

/** Converts a font-size value to px; clamp() and min() count at their smallest. null = not a size. */
function fontPx(value) {
  const v = value.trim();
  if (v === '0') return 0;
  const clamp = v.match(/^(?:clamp|min|max)\(\s*([^,]+)/i);
  if (clamp) return fontPx(clamp[1]);
  const m = v.match(/^([\d.]+)(rem|px)$/);
  if (m) return Number(m[1]) * (m[2] === 'rem' ? ROOT_PX : 1);
  return null;
}

// Proves: no visible text anywhere is set below 14px. `font-size: 0` (visually hidden label) is the
// only allowed exception; em, % and keyword sizes are refused because their size depends on context.
test('no font-size below 14px (0.875rem)', () => {
  const problems = [];
  for (const rule of RULES) {
    for (const [prop, value] of rule.decls) {
      if (prop !== 'font-size') continue;
      const px = fontPx(value);
      const where = `${rule.selectors.join(', ')} { font-size: ${value} }`;
      if (px === null) problems.push(`${where}: use rem or px so the size can be checked`);
      else if (px !== 0 && px < MIN_TEXT_PX) problems.push(`${where}: ${px}px is below ${MIN_TEXT_PX}px`);
    }
  }
  assert.deepEqual(problems, []);
});

/** Smallest px value a selector ever gives a property (every rule, every media query). */
function smallestPx(selector, prop) {
  const values = declsFor(selector, prop).map(fontPx);
  assert.ok(values.length > 0, `styles.css has no "${prop}" for "${selector}"`);
  assert.ok(values.every((v) => v !== null), `${selector} ${prop}: unreadable value`);
  return Math.min(...values);
}

// Proves: reading text is 16px or more with roomy line spacing, on phones as well (the base rules
// are the phone rules; wider screens only add).
test('body and description text is 16px or more with line-height 1.5 or more', () => {
  for (const selector of ['body', '.info p', '.card-desc', '.lead', '.site-footer']) {
    assert.ok(smallestPx(selector, 'font-size') >= 16, `${selector}: font-size below 16px`);
  }
  for (const selector of ['body', '.info p', '.card-desc', '.lead', '.site-footer']) {
    for (const value of declsFor(selector, 'line-height')) {
      assert.ok(Number(value) >= 1.5, `${selector}: line-height ${value} is below 1.5`);
    }
  }
});

// Proves: button labels are 16px and bold, and every button and tap target is at least 44px tall.
test('button labels are 16px bold and tap targets are 44px or taller', () => {
  assert.ok(smallestPx('.btn', 'font-size') >= 16, '.btn label below 16px');
  assert.ok(Number(declFor('.btn', 'font-weight')) >= 600, '.btn label not bold');
  assert.ok(smallestPx('.menu-btn', 'font-size') >= 16, 'Menu button label below 16px');
  assert.equal(declsFor('.btn-small', 'font-size').length, 0, '.btn-small must keep the 16px .btn label');
  const targets = [
    ['.btn', 'min-height'],
    ['.btn-small', 'min-height'],
    ['.icon-btn', 'height'],
    ['.menu-btn', 'height'],
    ['.price-pills a', 'min-height'],
    ['.breadcrumbs a', 'min-height'],
    ['.footer-list a', 'min-height'],
    ['.back-link', 'min-height'],
    ['.other-list a', 'min-height'],
    ['.brand', 'min-height'],
  ];
  for (const [selector, prop] of targets) {
    assert.ok(smallestPx(selector, prop) >= 44, `${selector} ${prop} is below 44px`);
  }
});
