/*
 * site-tests/bump-asset-versions.mjs (task D1)
 *
 * What it is: rewrites the cache-busting version on every reference to the site's shared assets in
 * public/**\/*.html, so a phone that cached an old stylesheet always fetches the new one when a page
 * changes. Each reference becomes `/<asset>?v=<version>`, where <version> is the first 10 hex
 * characters of the SHA-256 of the asset with LF line endings (so a Windows checkout with CRLF gives
 * the same version as CI).
 *
 * Versioned assets (VERSIONED_ASSETS below): /styles.css, /script.js and the icon sprite
 * /img/icons.svg (nginx caches the sprite for 7 days, so a new icon would otherwise be missing).
 *
 * How to run, from the repo root, after changing any of those files:
 *   node site-tests/bump-asset-versions.mjs           rewrite the versions in place
 *   node site-tests/bump-asset-versions.mjs --check   change nothing; exit 1 and list stale pages
 * site-tests/assets.test.mjs fails when a version is missing or stale, and imports the helpers below,
 * so the test and this script always agree on what "current" means.
 *
 * Node built-ins only (no package.json in this repo).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Assets that carry ?v=, as paths relative to public/ (the site path is "/" + this). */
export const VERSIONED_ASSETS = ['styles.css', 'script.js', 'img/icons.svg'];

/** Version for one asset: first 10 hex of sha256 of its text with CRLF/CR turned into LF. */
export function assetVersion(rel, publicDir = PUBLIC) {
  const text = fs.readFileSync(path.join(publicDir, rel), 'utf8').replace(/\r\n?/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 10);
}

/** { 'styles.css': 'abc123...', ... } for every versioned asset. */
export function currentVersions(publicDir = PUBLIC) {
  return Object.fromEntries(VERSIONED_ASSETS.map((rel) => [rel, assetVersion(rel, publicDir)]));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex for root-absolute references to one asset inside an attribute value: `/styles.css`,
 * `/styles.css?v=anything`, followed by a quote or a #fragment. Group 1 = the ?v=... part, if any.
 */
export function referenceRe(rel) {
  return new RegExp(`(?<=["'])/${escapeRe(rel)}(\\?v=[^"'#\\s]*)?(?=["'#])`, 'g');
}

/** The HTML with every versioned-asset reference set to `?v=<current version>`. */
export function withVersions(html, versions) {
  let out = html;
  for (const [rel, version] of Object.entries(versions)) {
    out = out.replace(referenceRe(rel), `/${rel}?v=${version}`);
  }
  return out;
}

/** Every .html file under public/, as absolute paths. */
export function htmlFiles(dir = PUBLIC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

/** Rewrites (or with check=true, only reports) stale versions. Returns the stale files. */
export function bump({ check = false, publicDir = PUBLIC } = {}) {
  const versions = currentVersions(publicDir);
  const stale = [];
  for (const file of htmlFiles(publicDir)) {
    const html = fs.readFileSync(file, 'utf8');
    const updated = withVersions(html, versions);
    if (updated === html) continue;
    stale.push(path.relative(publicDir, file));
    if (!check) fs.writeFileSync(file, updated);
  }
  return { versions, stale };
}

// Run only when called directly (the test imports this file without side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  const { versions, stale } = bump({ check });
  for (const [rel, version] of Object.entries(versions)) console.log(`/${rel}?v=${version}`);
  if (check && stale.length > 0) {
    console.error(`Stale asset versions in: ${stale.join(', ')}\nRun: node site-tests/bump-asset-versions.mjs`);
    process.exit(1);
  }
  console.log(stale.length === 0 ? 'All pages already current.' : `${check ? 'Stale' : 'Updated'}: ${stale.join(', ')}`);
}
