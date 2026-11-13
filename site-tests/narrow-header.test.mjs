/*
 * site-tests/narrow-header.test.mjs (task D1-fix2)
 *
 * What it proves: the narrow-phone step in public/styles.css that keeps the header on one row from
 * 320px up is still there, and the pages carry the markup it needs.
 *   1. Under 480px (`@media (max-width: 479px)`): the menu's Contact and Call buttons stack in one
 *      column, so the full phone number fits inside its button.
 *   2. Under 375px (`@media (max-width: 374px)`): the Menu button is a 44px square showing only its
 *      bars, and `.menu-label` is clipped (still in the page, so screen readers keep the name "Menu").
 *   3. Every page with the phone Menu button wraps the word in `<span class="menu-label">`.
 *
 * This is a CSS and markup check, not a layout measurement: there is no headless browser in CI. The
 * real gaps (brand text to buttons, 8px or more at 320, 360, 375 and 414) were measured in a browser
 * and are recorded in the D1-fix2 handoff; SITE.md section 11 lists the widths to re-check by eye.
 *
 * When this fails: restore the media block or the span named in the message, then run
 * `node site-tests/bump-asset-versions.mjs` if styles.css changed.
 *
 * Node built-ins only. CI runs it with the other site tests: node --test site-tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs
  .readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // comments out first

/**
 * The body of the first @media block whose condition is exactly `query` (whitespace ignored), or ''.
 * Walks the braces so the nested rule blocks are kept whole.
 */
function mediaBody(query) {
  const want = query.replace(/\s+/g, '');
  for (const m of CSS.matchAll(/@media([^{]+)\{/g)) {
    if (m[1].replace(/\s+/g, '') !== want) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < CSS.length && depth > 0; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
    }
    return CSS.slice(start, i - 1);
  }
  return '';
}

/** The declarations a selector gets inside one block of CSS, as a Map (last one wins). */
function declsIn(body, selector) {
  const decls = new Map();
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (!selectors.includes(selector)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return decls;
}

// Proves: below 480px the two menu buttons stack, so "(856) 210-3508" is not squeezed into half a row.
test('under 480px the menu Contact and Call buttons stack', () => {
  const body = mediaBody('(max-width: 479px)');
  assert.ok(body, 'styles.css has no @media (max-width: 479px) block');
  assert.equal(declsIn(body, '.mobile-cta').get('grid-template-columns'), '1fr');
});

// Proves: below 375px the Menu button is icon-only and 44px square, with the word clipped, not removed.
test('under 375px the Menu button shows only its bars and keeps its name', () => {
  const body = mediaBody('(max-width: 374px)');
  assert.ok(body, 'styles.css has no @media (max-width: 374px) block');
  assert.equal(declsIn(body, '.menu-btn').get('width'), '44px');
  const label = declsIn(body, '.menu-label');
  assert.equal(label.get('position'), 'absolute', '.menu-label must be clipped, not display: none');
  assert.equal(label.get('clip-path'), 'inset(50%)');
  assert.notEqual(label.get('display'), 'none', 'display: none would remove the name for screen readers');
});

// Proves: every page with the phone Menu button has the span the narrow step hides.
test('every Menu button wraps its word in .menu-label', () => {
  const pages = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) pages.push(p);
    }
  };
  walk(path.join(ROOT, 'public'));
  const withMenu = pages.filter((p) => fs.readFileSync(p, 'utf8').includes('class="menu-btn"'));
  assert.ok(withMenu.length >= 7, `expected the Menu button on at least 7 pages, found ${withMenu.length}`);
  for (const p of withMenu) {
    assert.match(
      fs.readFileSync(p, 'utf8'),
      /class="menu-btn">[\s\S]*?<span class="menu-label">Menu<\/span><\/summary>/,
      `${path.relative(ROOT, p)}: the word Menu is not wrapped in <span class="menu-label">`,
    );
  }
});
