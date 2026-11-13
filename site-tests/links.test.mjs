/*
 * site-tests/links.test.mjs (task R2, Batch R)
 *
 * What it is: an offline link checker for the static site. For every HTML file in public/ (and
 * site.webmanifest) it collects every link and asset reference that points at this site and proves the
 * target file exists, the way nginx would serve it: `/x/` -> public/x/index.html, `/x.png` -> public/x.png.
 * Checked: href, src, srcset and content attributes in any HTML quoting style ("x", 'x' or unquoted x),
 * plus https://darkmatterits.com/... URLs inside JSON-LD blocks (logo, image, url). Root-absolute (`/x`) and https://darkmatterits.com/... values are
 * checked everywhere; relative values (`x.png`) in href/src/srcset are resolved against the page's folder.
 * Skipped: other hosts, mailto:, tel:, data: and other schemes, and same-page #fragments.
 * How it fits: CI runs `node --test site-tests/*.test.mjs` (.github/workflows/check.yml, "Site tests").
 * Before touching: Node built-ins only. A folder link without its slash (`/contact`) is a failure on
 * purpose: nginx would answer it with a 301, so pages must link the canonical `/contact/` form.
 * Every link must resolve strictly. (R2's temporary "pending until the R1 pages land" allowance was
 * removed by RA-fix once every contract page existed on main; it had become dead code.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SITE = 'https://darkmatterits.com';

/** Every file under public/, as forward-slash paths relative to public/. */
function walk(dir = PUBLIC, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel + '/'));
    else out.push(rel);
  }
  return out;
}

/**
 * Turns one reference into a site path ("/x/y") or null when it is not ours to check.
 * fromDir is the page's folder as a site path ("/" or "/contact/"); relative refs resolve against it
 * only when allowRelative is set (href/src/srcset; a `content` value is often plain text).
 */
function toSitePath(ref, fromDir, allowRelative) {
  const value = ref.trim();
  if (value === '' || value.startsWith('#')) return null;
  if (value.startsWith(SITE + '/') || value === SITE) return new URL(value).pathname;
  if (value.startsWith('//')) return null; // protocol-relative: another host
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // https: elsewhere, mailto:, tel:, data:, ...
  if (value.startsWith('/')) return new URL(value, SITE).pathname;
  return allowRelative ? new URL(value, SITE + fromDir).pathname : null;
}

/** Whether nginx (try_files $uri $uri/ =404, index index.html) would serve a file for this path. */
function resolves(sitePath) {
  const decoded = decodeURIComponent(sitePath);
  const target = path.join(PUBLIC, ...decoded.split('/').filter(Boolean), decoded.endsWith('/') ? 'index.html' : '');
  if (!target.startsWith(PUBLIC)) return false; // ../ out of the web root
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

/** All references in one HTML file as { attr, ref, sitePath }. */
function referencesIn(rel) {
  const html = fs.readFileSync(path.join(PUBLIC, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const fromDir = '/' + rel.replace(/[^/]*$/, '');
  const found = [];
  const add = (attr, ref, allowRelative) => {
    const sitePath = toSitePath(ref, fromDir, allowRelative);
    if (sitePath !== null) found.push({ attr, ref, sitePath });
  };

  // Groups 2/3/4 = double-quoted / single-quoted / unquoted value. Unquoted values are valid HTML and
  // browsers follow them, so they are checked like the others rather than refused (R2-fix1: before,
  // href=/x was silently skipped). The unquoted form stops at whitespace, quotes, = < > and backtick,
  // the characters HTML forbids in an unquoted attribute value.
  for (const m of html.matchAll(/\s(href|src|srcset|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const attr = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    if (attr === 'srcset') {
      // "a.webp 1x, b.webp 2x": the URL is the first token of each comma-separated candidate.
      for (const candidate of value.split(',')) add(attr, candidate.trim().split(/\s+/)[0], true);
    } else {
      add(attr, value, attr !== 'content');
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const u of m[1].matchAll(/"(https:\/\/darkmatterits\.com[^"]*)"/g)) add('json-ld', u[1], false);
  }
  return found;
}

// Proves the checker itself maps paths the way nginx serves them, so a pass below means something.
test('link checker maps paths like nginx', () => {
  assert.equal(toSitePath('/contact/', '/', true), '/contact/');
  assert.equal(toSitePath(SITE + '/img/og-image.png', '/', false), '/img/og-image.png');
  assert.equal(toSitePath('styles.css', '/contact/', true), '/contact/styles.css');
  assert.equal(toSitePath('/styles.css?v=2#x', '/', true), '/styles.css');
  assert.equal(toSitePath('mailto:a@b.c', '/', true), null);
  assert.equal(toSitePath('tel:+18562103508', '/', true), null);
  assert.equal(toSitePath('#services', '/', true), null);
  assert.equal(toSitePath('https://example.com/x', '/', true), null);
  assert.equal(toSitePath('width=device-width', '/', false), null);
  assert.equal(resolves('/'), true);
  assert.equal(resolves('/styles.css'), true);
  assert.equal(resolves('/img'), false, 'a folder without its slash is not a file');
  assert.equal(resolves('/no-such-page/'), false);
});

// Proves every internal link, asset, og/twitter image, canonical and JSON-LD URL in every page
// (404.html included) points at a file that exists in public/.
test('every internal reference in public/**/*.html resolves to a file', () => {
  const pages = walk().filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 2, 'expected at least index.html and 404.html');
  const broken = [];
  let checked = 0;
  for (const page of pages) {
    for (const { attr, ref, sitePath } of referencesIn(page)) {
      checked++;
      if (resolves(sitePath)) continue;
      broken.push(`${page}: ${attr}="${ref}" -> ${sitePath}`);
    }
  }
  assert.ok(checked > 0, 'no references found; the checker is not reading the pages');
  assert.deepEqual(broken, [], 'broken references:\n' + broken.join('\n'));
});

// Proves the web manifest's start_url, scope and icon paths resolve to files.
test('every reference in site.webmanifest resolves to a file', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'site.webmanifest'), 'utf8'));
  const refs = [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)].filter(Boolean);
  for (const ref of refs) {
    const sitePath = toSitePath(ref, '/', true);
    assert.ok(sitePath && resolves(sitePath), `site.webmanifest: ${ref} does not resolve`);
  }
});
