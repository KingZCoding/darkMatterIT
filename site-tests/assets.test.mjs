/*
 * site-tests/assets.test.mjs (task D1)
 *
 * What it proves: every page asks for the CURRENT version of the shared assets, so a browser that
 * cached an old stylesheet, script or icon sprite never mixes it with new HTML (the broken look seen on
 * phones after the redesign). Versions are `?v=` + the first 10 hex of the asset's SHA-256 with LF line
 * endings; site-tests/bump-asset-versions.mjs computes them and rewrites the pages.
 *
 * When this fails after you edit styles.css, script.js or img/icons.svg, run from the repo root:
 *   node site-tests/bump-asset-versions.mjs
 *
 * Node built-ins only. CI runs it with the other site tests: node --test site-tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PUBLIC,
  VERSIONED_ASSETS,
  assetVersion,
  currentVersions,
  htmlFiles,
  referenceRe,
  withVersions,
  bump,
} from './bump-asset-versions.mjs';

// The eight HTML files: the seven contract pages and the 404 page.
const PAGES = [
  'index.html',
  'software-development/index.html',
  'managed-hosting/index.html',
  'networking-wifi/index.html',
  'tech-support/index.html',
  'hardware-pc-builds/index.html',
  'contact/index.html',
  '404.html',
];

const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// Proves: each of the 8 pages loads the stylesheet and the script with the exact current version.
test('every page loads /styles.css and /script.js with the current ?v= version', () => {
  const versions = currentVersions();
  for (const rel of PAGES) {
    const html = stripComments(read(rel));
    assert.match(
      html,
      new RegExp(`<link rel="stylesheet" href="/styles\\.css\\?v=${versions['styles.css']}">`),
      `${rel}: stylesheet link missing or not ?v=${versions['styles.css']} (run node site-tests/bump-asset-versions.mjs)`,
    );
    assert.match(
      html,
      new RegExp(`<script src="/script\\.js\\?v=${versions['script.js']}" defer></script>`),
      `${rel}: script tag missing or not ?v=${versions['script.js']} (run node site-tests/bump-asset-versions.mjs)`,
    );
  }
});

// Proves: no reference to a versioned asset anywhere in public/**/*.html is unversioned or stale
// (this also covers every <use href="/img/icons.svg?v=...#id"> icon).
test('no page references a versioned asset without its current version', () => {
  const versions = currentVersions();
  const files = htmlFiles();
  assert.ok(files.length >= PAGES.length, 'htmlFiles() found too few pages');
  const problems = [];
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const rel of VERSIONED_ASSETS) {
      for (const m of html.matchAll(referenceRe(rel))) {
        if (m[1] !== `?v=${versions[rel]}`) problems.push(`${path.relative(PUBLIC, file)}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'stale or missing versions (run node site-tests/bump-asset-versions.mjs):\n' + problems.join('\n'));
});

// Proves: the version ignores line endings (a CRLF checkout gives the same hash as LF) and changes
// when the content changes.
test('asset versions are 10 hex, line-ending independent and content sensitive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmits-assets-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.css'), 'body {\n  color: red;\n}\n');
    fs.writeFileSync(path.join(dir, 'b.css'), 'body {\r\n  color: red;\r\n}\r\n');
    fs.writeFileSync(path.join(dir, 'c.css'), 'body {\n  color: blue;\n}\n');
    const a = assetVersion('a.css', dir);
    assert.match(a, /^[0-9a-f]{10}$/);
    assert.equal(assetVersion('b.css', dir), a, 'CRLF must give the same version as LF');
    assert.notEqual(assetVersion('c.css', dir), a, 'different content must give a different version');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const rel of VERSIONED_ASSETS) assert.match(assetVersion(rel), /^[0-9a-f]{10}$/, rel);
});

// Proves: the bump script rewrites missing and stale versions, keeps #fragments, leaves other paths
// alone, and its --check mode reports without writing.
test('bump-asset-versions rewrites missing and stale versions and nothing else', () => {
  const v = { 'styles.css': '1111111111', 'script.js': '2222222222', 'img/icons.svg': '3333333333' };
  const before = [
    '<link rel="stylesheet" href="/styles.css">',
    '<script src="/script.js?v=old" defer></script>',
    '<svg><use href="/img/icons.svg?v=0#i-code"></use></svg>',
    '<a href="/contact/">x</a> <link rel="stylesheet" href="/other/styles.css">',
  ].join('\n');
  const after = withVersions(before, v);
  assert.match(after, /href="\/styles\.css\?v=1111111111"/);
  assert.match(after, /src="\/script\.js\?v=2222222222"/);
  assert.match(after, /href="\/img\/icons\.svg\?v=3333333333#i-code"/);
  assert.match(after, /href="\/other\/styles\.css"/, 'a different path must not be touched');
  assert.equal(withVersions(after, v), after, 'running twice changes nothing');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmits-bump-'));
  try {
    fs.mkdirSync(path.join(dir, 'img'));
    fs.writeFileSync(path.join(dir, 'styles.css'), 'a{}\n');
    fs.writeFileSync(path.join(dir, 'script.js'), '1;\n');
    fs.writeFileSync(path.join(dir, 'img', 'icons.svg'), '<svg/>\n');
    fs.writeFileSync(path.join(dir, 'index.html'), '<link rel="stylesheet" href="/styles.css">');
    const checked = bump({ check: true, publicDir: dir });
    assert.deepEqual(checked.stale, ['index.html']);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<link rel="stylesheet" href="/styles.css">', '--check must not write');
    bump({ publicDir: dir });
    assert.equal(
      fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
      `<link rel="stylesheet" href="/styles.css?v=${assetVersion('styles.css', dir)}">`,
    );
    assert.deepEqual(bump({ check: true, publicDir: dir }).stale, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
