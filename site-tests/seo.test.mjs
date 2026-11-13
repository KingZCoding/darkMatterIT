/*
 * site-tests/seo.test.mjs (task R2, Batch R)
 *
 * What it is: checks the technical-SEO files in public/ against the URL and image contract in SITE.md
 * (repo root; sections 2, 7 and 10): sitemap.xml, robots.txt,
 * site.webmanifest, the icon and image files (names, pixel sizes, byte budgets) and the 404 page.
 * How it fits: CI runs `node --test site-tests/*.test.mjs` (.github/workflows/check.yml, "Site tests").
 * Its sibling links.test.mjs checks that every internal link resolves; R1's pages.test.mjs checks the pages.
 * Before touching: Node built-ins only (no package.json here). It is written against the contract, not
 * against today's pages, so it passes both before and after R1's new pages land. If the URL contract
 * changes, change CONTRACT_PATHS and public/sitemap.xml together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SITE = 'https://darkmatterits.com';

// The Batch R URL contract: the only pages that exist (404.html is not a page and is never listed).
const CONTRACT_PATHS = [
  '/',
  '/software-development/',
  '/managed-hosting/',
  '/networking-wifi/',
  '/tech-support/',
  '/hardware-pc-builds/',
  '/contact/',
];

const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
const bytes = (rel) => fs.readFileSync(path.join(PUBLIC, rel));

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

/** The <loc> values in sitemap.xml, in order. */
function sitemapLocs() {
  return [...read('sitemap.xml').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1]);
}

// ---------- Image header readers (dimensions without any image library) ----------

/** PNG: width/height and colour type from IHDR, and whether a tRNS (transparency) chunk exists. */
function pngInfo(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
  let hasTrns = false;
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'tRNS') hasTrns = true;
    if (type === 'IEND') break;
    off += 12 + len; // length + type + data + CRC
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25], hasTrns };
}

/** WebP: width/height from the first chunk (lossy VP8, lossless VP8L or extended VP8X). */
function webpInfo(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF', 'not a RIFF file');
  assert.equal(buf.toString('latin1', 8, 12), 'WEBP', 'not a WebP file');
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${chunk}`);
}

/** ICO: the size of every image in the directory (a stored 0 means 256). */
function icoSizes(buf) {
  assert.equal(buf.readUInt16LE(0), 0, 'ICO reserved field');
  assert.equal(buf.readUInt16LE(2), 1, 'ICO type must be 1 (icon)');
  const sizes = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const w = buf[6 + i * 16] || 256;
    const h = buf[7 + i * 16] || 256;
    sizes.push(`${w}x${h}`);
  }
  return sizes.sort();
}

// ---------- sitemap.xml ----------

// Proves the sitemap lists exactly the contract pages: absolute https URLs on the canonical host,
// trailing slash, no duplicates, nothing extra, nothing missing, and no <lastmod> (no one keeps it true).
test('sitemap.xml lists exactly the URL contract', () => {
  const raw = read('sitemap.xml');
  assert.match(raw, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const xml = raw.replace(/<!--[\s\S]*?-->/g, ''); // the header comment may name tags it explains
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(xml, /<lastmod>/);
  const locs = sitemapLocs();
  assert.deepEqual(locs, CONTRACT_PATHS.map((p) => SITE + p));
  assert.equal(new Set(locs).size, locs.length, 'duplicate <loc>');
});

// Proves no page can be added to public/ without also adding it to the sitemap (404.html excepted).
test('every public HTML page except 404.html is in the sitemap', () => {
  const locs = new Set(sitemapLocs());
  const pages = walk().filter((f) => f.endsWith('.html') && f !== '404.html');
  assert.ok(pages.includes('index.html'), 'home page missing');
  for (const file of pages) {
    const url = SITE + '/' + (file === 'index.html' ? '' : file.replace(/(^|\/)index\.html$/, '$1'));
    assert.ok(locs.has(url), `${file} is a page but ${url} is not in sitemap.xml`);
  }
  assert.ok(!locs.has(SITE + '/404.html'), '404.html must not be in the sitemap');
});

// ---------- robots.txt ----------

// Proves robots.txt lets every crawler in (no non-empty Disallow) and points at the sitemap.
test('robots.txt allows all and names the sitemap', () => {
  const lines = read('robots.txt').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  assert.ok(lines.includes('User-agent: *'));
  assert.ok(lines.includes('Allow: /'));
  for (const l of lines) assert.doesNotMatch(l, /^Disallow:\s*\S/i, `robots.txt blocks something: ${l}`);
  assert.ok(lines.includes(`Sitemap: ${SITE}/sitemap.xml`));
});

// ---------- site.webmanifest ----------

// Proves the manifest is valid JSON with the business name, root start URL, the site's dark
// background colour (the --bg token in styles.css when it exists) and icons that exist at their stated size.
test('site.webmanifest parses, uses the dark background and its icons exist', () => {
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.name, 'Dark Matter IT Solutions');
  assert.ok(manifest.short_name && manifest.short_name.length <= 15, 'short_name missing or too long for a home screen');
  assert.equal(manifest.start_url, '/');
  assert.match(manifest.background_color, /^#[0-9a-fA-F]{6}$/);
  assert.equal(manifest.theme_color, manifest.background_color);
  const bg = read('styles.css').match(/--bg\s*:\s*(#[0-9a-fA-F]{6})\b/);
  if (bg) assert.equal(manifest.background_color.toLowerCase(), bg[1].toLowerCase(), 'manifest colour differs from --bg in styles.css');

  const sizes = manifest.icons.map((i) => i.sizes).sort();
  assert.deepEqual(sizes, ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/[^/]/, `icon src must be root-absolute: ${icon.src}`);
    assert.equal(icon.type, 'image/png');
    const rel = icon.src.slice(1);
    assert.ok(fs.existsSync(path.join(PUBLIC, rel)), `manifest icon missing: ${icon.src}`);
    const { width, height } = pngInfo(bytes(rel));
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} is ${width}x${height}, manifest says ${icon.sizes}`);
  }
});

// ---------- Images and icons (the contract table) ----------

// Proves every file R1 references exists with the contract's pixel size, in the right format, and
// within a byte budget (the old 1.8 MB logo shown at 44 px is what this replaces).
test('images and icons match the contract table', () => {
  const pngs = [
    // [path, width, height, max bytes]
    ['img/logo-mark.png', 128, 128, 40_000],
    ['img/og-image.png', 1200, 630, 300_000],
    ['icons/icon-32.png', 32, 32, 10_000],
    ['icons/apple-touch-icon.png', 180, 180, 60_000],
    ['icons/icon-192.png', 192, 192, 60_000],
    ['icons/icon-512.png', 512, 512, 250_000],
  ];
  for (const [rel, w, h, max] of pngs) {
    const buf = bytes(rel);
    const info = pngInfo(buf);
    assert.equal(`${info.width}x${info.height}`, `${w}x${h}`, `${rel} dimensions`);
    assert.ok(buf.length <= max, `${rel} is ${buf.length} bytes, budget ${max}`);
  }

  const webp = bytes('img/logo-mark.webp');
  const wi = webpInfo(webp);
  assert.equal(`${wi.width}x${wi.height}`, '128x128', 'logo-mark.webp dimensions');
  assert.ok(webp.length < 15_000, `logo-mark.webp is ${webp.length} bytes, target < 15 KB`);

  const ico = bytes('favicon.ico');
  assert.deepEqual(icoSizes(ico), ['16x16', '32x32', '48x48']);
  assert.ok(ico.length <= 20_000, `favicon.ico is ${ico.length} bytes`);
});

// Proves the apple-touch-icon is opaque (iOS shows transparent areas as black): no alpha
// colour type (4 or 6) and no tRNS transparency chunk.
test('apple-touch-icon is opaque', () => {
  const info = pngInfo(bytes('icons/apple-touch-icon.png'));
  assert.ok(info.colorType !== 4 && info.colorType !== 6, `colour type ${info.colorType} has alpha`);
  assert.equal(info.hasTrns, false, 'has a tRNS transparency chunk');
});

// ---------- 404.html ----------

// Proves the 404 page is noindex, works at any path (root-absolute links and assets only), links
// home and to /contact/, uses only the contract classes and styles.css/script.js, has no inline JS,
// inline handlers or style attributes (VPS CSP), and carries the marker the CI smoke test looks for.
test('404.html follows the 404 contract', () => {
  const html = read('404.html');
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /<meta name="robots" content="noindex[^"]*">/);
  assert.match(body, /id="dmits-404-page"/);
  assert.match(body, /href="\/"/);
  assert.match(body, /href="\/contact\/"/);
  assert.doesNotMatch(body, /\sstyle\s*=/i, 'style attribute');
  assert.doesNotMatch(body, /\son[a-z]+\s*=/i, 'inline event handler');

  for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\ssrc="\/script\.js"/, 'only /script.js may be loaded');
    assert.equal(m[2].trim(), '', 'inline script');
  }
  const sheets = [...body.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map((m) => m[0]);
  assert.deepEqual(sheets.map((s) => s.match(/href="([^"]*)"/)[1]), ['/styles.css']);
  assert.doesNotMatch(body, /<style\b/i, 'inline <style> block');

  // Any quoting style, like the class check below (R2-fix1).
  for (const m of body.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const value = m[1] ?? m[2] ?? m[3];
    assert.match(value, /^(\/|mailto:|tel:|#)/, `404.html link is not root-absolute: ${value}`);
  }

  // class values in any HTML quoting style: "a b", 'a b' or unquoted a (R2-fix1: the double-quote-only
  // pattern let class='hero' through). Group 1/2/3 = double-quoted / single-quoted / unquoted value.
  const allowed = new Set(['container', 'btn', 'btn-primary', 'site-header', 'site-footer']);
  let classAttrs = 0;
  for (const m of body.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    classAttrs++;
    const value = m[1] ?? m[2] ?? m[3];
    for (const cls of value.split(/\s+/).filter(Boolean)) assert.ok(allowed.has(cls), `class not in the 404 contract: ${cls}`);
  }
  assert.ok(classAttrs > 0, 'no class attributes found; the class check is not reading the page');

  // No address and no old phone number in anything R2 writes (Cody 2026-11-13).
  assert.doesNotMatch(html, /209-?0353|2090353/);
});
