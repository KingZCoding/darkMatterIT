// site-tests/pages.test.mjs: checks the static pages built by task R1 (Batch R).
//
// Run from the repo root:  node --test site-tests/*.test.mjs
// Node built-ins only (no package.json here). CI runs the same command (R2 adds the step).
//
// What these tests guard, and why it matters:
//   - every page in the URL contract exists and has its own title, description, canonical and share tags;
//   - no street address, postal code or geo data anywhere (Cody's decision, 2026-11-13; see SITE.md);
//   - the old phone number is gone from public/ and the new one is on every page;
//   - the contact form's <select> values equal the mailer's SERVICES/URGENCIES, so a request is never
//     silently filed under "Other"/"Normal";
//   - the pages obey the CSP (no inline JS, no on*= handlers, no style="", nothing loaded from other hosts).
// Added by R1-fix1 (review findings, reviewer-R1):
//   - JSON-LD types follow the contract (home ProfessionalService; each service page one Service and one
//     BreadcrumbList Home -> itself; no FAQPage, because no page shows a FAQ);
//   - every JSON-LD telephone and every tel: link in public/ is the new number, in its one right form;
//   - the only prices anywhere on the pages or in JSON-LD are $79 and $35 (Cody's rule A9.7: no invented prices);
//   - styles.css still defines the classes R2's 404 page depends on;
//   - every page links the favicon, icon-32, apple-touch-icon and manifest at the contract paths;
//   - script.js has a message for every error code mailer/app.js can return (read from app.js as text);
//   - a no-JavaScript submit of the contact form is impossible (button ships disabled, script.js enables it).
// Added by RA-fix (Batch R audit findings F1 and F2):
//   - no served file in public/ carries maintainer notes (records paths, server internals): comments in
//     served files are sent to every visitor, so the full notes live in SITE.md;
//   - every page's <title> is 65 characters or less and every description is 160 or less;
//   - a service page's descriptions and its visible "Where" panel name the same service area.
// Added by RA-fix2 (review findings, reviewer-RA):
//   - og and twitter descriptions are the same text as the meta description (in the length test);
//   - served comments never discuss the business address (no-address rule).
//
// SERVICES and URGENCIES are read by PARSING mailer/app.js, not importing it. Importing app.js would
// load express, helmet and express-rate-limit from mailer/node_modules, so the site tests would fail
// whenever `npm ci` had not run in mailer/ first, and would no longer be "Node built-ins only".
// app.js itself starts no server (server.js does), but its package imports are a dependency we avoid.
//
// The HTML is checked with small regular expressions. That is enough for pages we write ourselves;
// it is not a general HTML parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const SITE = 'https://darkmatterits.com';

// The URL contract (BATCH-R-CONTRACT.md): URL -> file under public/.
const PAGES = {
  '/': 'index.html',
  '/software-development/': 'software-development/index.html',
  '/managed-hosting/': 'managed-hosting/index.html',
  '/networking-wifi/': 'networking-wifi/index.html',
  '/tech-support/': 'tech-support/index.html',
  '/hardware-pc-builds/': 'hardware-pc-builds/index.html',
  '/contact/': 'contact/index.html',
};

const NEW_PHONE_DISPLAY = '(856) 210-3508';
const NEW_PHONE_TEL = 'tel:+18562103508';
// Every way the old number could be written: 209-0353, 2090353, 209 0353, 209.0353.
const OLD_PHONE_RE = /209[\s.\-]?0353/;

const read = (rel) => readFileSync(join(PUBLIC, rel), 'utf8');
const pageHtml = Object.fromEntries(
  Object.entries(PAGES).map(([url, file]) => [url, existsSync(join(PUBLIC, file)) ? read(file) : '']),
);

/** Every file under `dir`, recursively, as absolute paths. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** All HTML comments removed, so a test never passes or fails because of comment text. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Value of an attribute inside one tag string, or null. */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/** All opening tags of one element name, e.g. tags(html, 'meta'). */
const tags = (html, name) => stripComments(html).match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];

/** content="" of <meta name|property="key">, or null. */
function meta(html, key) {
  const tag = tags(html, 'meta').find((t) => attr(t, 'name') === key || attr(t, 'property') === key);
  return tag ? attr(tag, 'content') : null;
}

/** Bodies of every <script type="application/ld+json"> block, parsed. Throws if one is not JSON. */
function jsonLd(html) {
  const blocks = [...stripComments(html).matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.map((m) => JSON.parse(m[1]));
}

/** Every key used anywhere inside a parsed JSON value. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** Read `export const NAME = [ 'a', 'b' ];` out of mailer/app.js without importing it (see header). */
function mailerList(name) {
  const src = readFileSync(join(ROOT, 'mailer', 'app.js'), 'utf8');
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(m, `mailer/app.js no longer has "export const ${name} = [...]"; update this parser`);
  const items = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  assert.ok(items.length > 0, `${name} parsed as empty`);
  return items;
}

/** Option values of <select id="..."> in order. */
function selectValues(html, id) {
  const m = stripComments(html).match(new RegExp(`<select\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`, 'i'));
  assert.ok(m, `no <select id="${id}">`);
  return (m[1].match(/<option\b[^>]*>/gi) || []).map((t) => attr(t, 'value'));
}

// ---------------------------------------------------------------- Pages exist
// Proves: every URL in the contract has its index.html, so nginx's try_files $uri/ finds it.
test('every URL-contract page exists and is not empty', () => {
  for (const [url, file] of Object.entries(PAGES)) {
    assert.ok(existsSync(join(PUBLIC, file)), `${url} -> public/${file} is missing`);
    assert.ok(pageHtml[url].length > 500, `public/${file} looks empty`);
  }
});

// ---------------------------------------------------------------- Titles and descriptions
// Proves: search results and shares never show two pages with the same title or description.
test('each page has a unique <title> and meta description', () => {
  const titles = new Map();
  const descriptions = new Map();
  for (const [url, html] of Object.entries(pageHtml)) {
    const title = (stripComments(html).match(/<title>([^<]+)<\/title>/i) || [])[1];
    const description = meta(html, 'description');
    assert.ok(title && title.trim().length > 10, `${url}: missing or short <title>`);
    assert.ok(description && description.length >= 50, `${url}: missing or short meta description`);
    assert.ok(description.length <= 200, `${url}: meta description over 200 characters`);
    assert.ok(!titles.has(title), `${url}: same <title> as ${titles.get(title)}`);
    assert.ok(!descriptions.has(description), `${url}: same description as ${descriptions.get(description)}`);
    titles.set(title, url);
    descriptions.set(description, url);
  }
});

// ---------------------------------------------------------------- Canonical and share tags
// Proves: each page names itself (https, trailing slash) as canonical, and its Open Graph / Twitter
// tags point at the same URL and an absolute https image, so shares and Google agree on the page.
test('canonical equals the contract URL; og and twitter tags are complete', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    const expected = `${SITE}${url}`;
    const canon = tags(html, 'link').filter((t) => attr(t, 'rel') === 'canonical');
    assert.equal(canon.length, 1, `${url}: expected exactly one canonical link`);
    assert.equal(attr(canon[0], 'href'), expected, `${url}: canonical`);
    assert.equal(meta(html, 'og:url'), expected, `${url}: og:url`);
    for (const key of ['og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      assert.ok(meta(html, key), `${url}: missing ${key}`);
    }
    assert.match(meta(html, 'og:image'), /^https:\/\/darkmatterits\.com\//, `${url}: og:image must be absolute https`);
    assert.match(meta(html, 'twitter:image'), /^https:\/\/darkmatterits\.com\//, `${url}: twitter:image must be absolute https`);
    assert.ok(meta(html, 'theme-color'), `${url}: missing theme-color`);
    assert.ok(tags(html, 'link').some((t) => attr(t, 'rel') === 'manifest' && attr(t, 'href') === '/site.webmanifest'), `${url}: missing manifest link`);
    assert.equal(meta(html, 'keywords'), null, `${url}: meta keywords should be gone`);
    assert.ok(!tags(html, 'meta').some((t) => /^geo\./.test(attr(t, 'name') || '')), `${url}: geo.* meta tags should be gone`);
  }
});

// ---------------------------------------------------------------- Structured data
// Proves: every JSON-LD block is valid JSON, and none of it carries an address or geo position.
test('JSON-LD parses and contains no address or geo keys', () => {
  const forbidden = new Set(['address', 'streetAddress', 'postalCode', 'addressLocality', 'geo', 'latitude', 'longitude', 'hasMap']);
  for (const [url, html] of Object.entries(pageHtml)) {
    let blocks;
    assert.doesNotThrow(() => (blocks = jsonLd(html)), `${url}: a JSON-LD block is not valid JSON`);
    assert.ok(blocks.length > 0, `${url}: no JSON-LD`);
    const bad = allKeys(blocks).filter((k) => forbidden.has(k));
    assert.deepEqual(bad, [], `${url}: JSON-LD has address/geo keys`);
  }
  const home = jsonLd(pageHtml['/'])[0];
  assert.equal(home['@type'], 'ProfessionalService');
  assert.equal(home.telephone, '+1-856-210-3508');
  // Only the two confirmed prices may appear as offers.
  const tech = JSON.stringify(jsonLd(pageHtml['/tech-support/']));
  const hosting = JSON.stringify(jsonLd(pageHtml['/managed-hosting/']));
  assert.match(tech, /"minPrice":"79\.00"/);
  assert.match(hosting, /"price":"35\.00"/);
  for (const url of ['/software-development/', '/networking-wifi/', '/hardware-pc-builds/']) {
    assert.ok(!/"offers"/.test(JSON.stringify(jsonLd(pageHtml[url]))), `${url}: no confirmed price, so no offers`);
  }
});

// ---------------------------------------------------------------- No address anywhere
// Proves: no address shows in page text, meta or data on any public file (Cody, 2026-11-13).
test('no address markup or address keys anywhere in public/', () => {
  for (const file of walk(PUBLIC).filter((f) => /\.(html|js|css|json|webmanifest|xml|txt)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/streetAddress|"address"\s*:|<address\b|itemprop="address"/i.test(text), `${relative(ROOT, file)} contains address markup`);
  }
});

// ---------------------------------------------------------------- Phone numbers
// Proves: the old number cannot be called from any file the site serves, and every page offers the new one.
test('old phone number is absent from every file in public/', () => {
  for (const file of walk(PUBLIC)) {
    // latin1 keeps binary files readable byte-for-byte, so a number baked into any file is still caught.
    const text = readFileSync(file, 'latin1');
    assert.ok(!OLD_PHONE_RE.test(text), `${relative(ROOT, file)} still has the old number 209-0353`);
  }
});

test('new phone number is on every page and in script.js', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    assert.ok(html.includes(NEW_PHONE_DISPLAY), `${url}: missing ${NEW_PHONE_DISPLAY}`);
    assert.ok(html.includes(`href="${NEW_PHONE_TEL}"`), `${url}: missing ${NEW_PHONE_TEL} link`);
  }
  assert.ok(read('script.js').includes(`'${NEW_PHONE_DISPLAY}'`), 'script.js: PHONE_DISPLAY is not the new number');
});

// ---------------------------------------------------------------- Contact form
// Proves: the form sends exactly the values the mailer accepts, has every field the API reads,
// keeps the honeypot hidden from people, and lives only on /contact/.
test('contact form fields and option values match mailer/app.js', () => {
  const html = pageHtml['/contact/'];
  assert.deepEqual(selectValues(html, 'service'), mailerList('SERVICES'), 'service options != SERVICES');
  assert.deepEqual(selectValues(html, 'urgency'), mailerList('URGENCIES'), 'urgency options != URGENCIES');

  const form = (stripComments(html).match(/<form\b[^>]*id="contactForm"[^>]*>[\s\S]*?<\/form>/i) || [])[0];
  assert.ok(form, '/contact/ has no #contactForm');
  for (const field of ['name', 'email', 'phone', 'service', 'urgency', 'message', 'website']) {
    assert.ok(new RegExp(`\\bid="${field}"[^>]*\\bname="${field}"|\\bname="${field}"[^>]*\\bid="${field}"`).test(form), `form field ${field} missing (id and name must match)`);
  }
  const honeypot = tags(form, 'input').find((t) => attr(t, 'name') === 'website');
  assert.equal(attr(honeypot, 'tabindex'), '-1', 'honeypot must have tabindex="-1"');
  assert.equal(attr(honeypot, 'autocomplete'), 'off', 'honeypot must have autocomplete="off"');
  assert.match(form, /<div class="hp" aria-hidden="true">\s*<label for="website">/, 'honeypot must sit in the hidden .hp wrapper');
  assert.match(html, /<noscript>[\s\S]*tel:\+18562103508[\s\S]*<\/noscript>/, 'noscript fallback must give the new phone');

  // The JSON body keys script.js sends are the field ids, plus the honeypot.
  const js = read('script.js');
  assert.match(js, /fetch\('\/api\/support'/);
  for (const key of ['name', 'email', 'phone', 'service', 'urgency', 'message']) {
    assert.match(js, new RegExp(`${key}: fieldValue\\('${key}'\\)`), `script.js does not send ${key}`);
  }

  for (const [url, other] of Object.entries(pageHtml)) {
    if (url !== '/contact/') assert.ok(!/id="contactForm"/.test(other), `${url}: the form belongs on /contact/ only`);
  }
});

// ---------------------------------------------------------------- CSP and self-hosting
// Proves: pages would run under the VPS CSP and Cody's no-inline rule, and load nothing from other hosts.
test('no inline scripts, handlers or styles; no external assets', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    const clean = stripComments(html);
    for (const m of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const open = `<script${m[1]}>`;
      const isJsonLd = attr(open, 'type') === 'application/ld+json';
      if (!isJsonLd) {
        assert.equal(m[2].trim(), '', `${url}: inline JavaScript found`);
        assert.match(attr(open, 'src') || '', /^\/[^/]/, `${url}: script src must be root-absolute on this site`);
      }
    }
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(clean), `${url}: inline on*= event handler found`);
    assert.ok(!/<[a-z][^>]*\sstyle\s*=/i.test(clean), `${url}: style="" attribute found`);
    assert.ok(!/<style\b/i.test(clean), `${url}: <style> block found (use /styles.css)`);
    assert.ok(!/<iframe\b|<embed\b|<object\b/i.test(clean), `${url}: embeds are not allowed`);

    const assetRefs = [
      ...tags(html, 'img').map((t) => attr(t, 'src')),
      ...tags(html, 'source').map((t) => attr(t, 'srcset')),
      ...tags(html, 'script').map((t) => attr(t, 'src')),
      ...tags(html, 'link').filter((t) => attr(t, 'rel') !== 'canonical').map((t) => attr(t, 'href')),
    ].filter(Boolean);
    for (const ref of assetRefs) {
      assert.match(ref, /^\/(?!\/)/, `${url}: asset "${ref}" is not a root-absolute local path`);
    }
  }
  const css = read('styles.css');
  assert.ok(!/@import|@font-face/i.test(css), 'styles.css must not import CSS or fonts');
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) {
    assert.ok(/^data:|^\/(?!\/)/.test(m[1]), `styles.css: url(${m[1].slice(0, 40)}) is not data: or local`);
  }
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(read('script.js')), 'script.js must not write HTML');
});

// ---------------------------------------------------------------- Accessibility basics
// Proves: each page has one <h1>, a skip link to #main, the footer outside <main>, and only
// root-absolute internal links (pages live in sub-folders, so relative links would break).
test('one h1, skip link, footer outside main, root-absolute internal links', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    const clean = stripComments(html);
    assert.equal((clean.match(/<h1\b/gi) || []).length, 1, `${url}: expected exactly one <h1>`);
    assert.match(clean, /<a class="skip-link" href="#main">/, `${url}: missing skip link`);
    assert.match(clean, /<main id="main"/, `${url}: <main id="main"> missing`);
    const mainEnd = clean.indexOf('</main>');
    const footerStart = clean.indexOf('<footer');
    assert.ok(mainEnd > 0 && footerStart > mainEnd, `${url}: footer must come after </main>`);
    assert.match(clean, /<html lang="en">/, `${url}: <html lang="en"> missing`);
    for (const t of tags(html, 'a')) {
      const href = attr(t, 'href') || '';
      assert.ok(/^(\/|#|https:\/\/|mailto:|tel:)/.test(href), `${url}: link "${href}" must be root-absolute`);
    }
  }
});

// ---------------------------------------------------------------- Old assets gone
// Proves: the old 1.8 MB logo files were removed and nothing still points at them.
test('old logo PNGs are deleted and unreferenced', () => {
  for (const name of ['logo.png', 'logo-192.png', 'logo-512.png']) {
    assert.ok(!existsSync(join(PUBLIC, name)), `public/${name} should be deleted`);
  }
  for (const html of Object.values(pageHtml)) assert.ok(!/logo(-192|-512)?\.png/.test(html.replace(/logo-mark\.png/g, '')));
});

// ================================================================ R1-fix1 additions
// Each test below closes a gap the R1 review proved by breaking the rule and seeing the suite still pass.

/** Every value stored under `key` anywhere inside a parsed JSON value. */
function valuesOf(value, key, out = []) {
  if (Array.isArray(value)) value.forEach((v) => valuesOf(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) out.push(v);
      valuesOf(v, key, out);
    }
  }
  return out;
}

/** The @type of a JSON-LD node as a list (schema.org allows a string or an array). */
const typesOf = (node) => [].concat(node['@type'] ?? []);

/** Every .html file under public/ (includes R2's 404.html once both branches are merged). */
const htmlFiles = () => walk(PUBLIC).filter((f) => f.endsWith('.html'));

// The five service pages (every contract page except home and /contact/).
const SERVICE_URLS = Object.keys(PAGES).filter((url) => url !== '/' && url !== '/contact/');

// ---------------------------------------------------------------- JSON-LD types
// Proves: the structured data has the shape the contract sets. Home is the business; each service page
// has exactly one Service and one BreadcrumbList that runs Home -> that page; no FAQPage anywhere,
// since Google only allows FAQPage where the same questions are visible and no page shows a FAQ.
test('JSON-LD @types follow the contract; no FAQPage', () => {
  const homeTypes = jsonLd(pageHtml['/']).flatMap(typesOf);
  assert.ok(homeTypes.includes('ProfessionalService'), '/: home JSON-LD must be a ProfessionalService');

  for (const url of SERVICE_URLS) {
    const blocks = jsonLd(pageHtml[url]);
    const count = (type) => blocks.filter((b) => typesOf(b).includes(type)).length;
    assert.equal(count('Service'), 1, `${url}: expected exactly one Service block`);
    assert.equal(count('BreadcrumbList'), 1, `${url}: expected exactly one BreadcrumbList block`);
    const crumbs = blocks.find((b) => typesOf(b).includes('BreadcrumbList')).itemListElement || [];
    const items = crumbs.map((c) => (typeof c.item === 'string' ? c.item : c.item?.['@id']));
    assert.deepEqual(items, [`${SITE}/`, `${SITE}${url}`], `${url}: breadcrumb must be Home -> this page`);
  }

  for (const [url, html] of Object.entries(pageHtml)) {
    const allTypes = valuesOf(jsonLd(html), '@type').flat();
    assert.ok(!allTypes.includes('FAQPage'), `${url}: FAQPage found but no page shows a FAQ`);
  }
});

// ---------------------------------------------------------------- Phone number forms
// Proves: no wrong number can hide anywhere: every JSON-LD "telephone" (including a nested provider)
// is +1-856-210-3508, and every tel: link in every HTML file under public/ is exactly tel:+18562103508.
// (The earlier test only checks that ONE correct link exists per page.)
test('every JSON-LD telephone and every tel: link is the new number', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    for (const phone of valuesOf(jsonLd(html), 'telephone')) {
      assert.equal(phone, '+1-856-210-3508', `${url}: JSON-LD telephone`);
    }
  }
  for (const file of htmlFiles()) {
    const html = stripComments(readFileSync(file, 'utf8'));
    for (const m of html.matchAll(/href\s*=\s*"(tel:[^"]*)"/gi)) {
      assert.equal(m[1], NEW_PHONE_TEL, `${relative(ROOT, file)}: wrong tel: link`);
    }
  }
});

// ---------------------------------------------------------------- Only the two true prices
// Proves: no invented price reaches the site (rule A9.7). Every "$<number>" in a page, comments removed
// (so visible text, <title>, meta tags and JSON-LD text are all covered), is $79 or $35, and every JSON-LD
// price field (price, minPrice, maxPrice, lowPrice, highPrice) is 79 or 35.
test('the only prices on any page are $79 and $35', () => {
  const allowedText = /^\$(79|35)(\.00)?$/;
  const priceKeys = ['price', 'minPrice', 'maxPrice', 'lowPrice', 'highPrice'];
  for (const [url, html] of Object.entries(pageHtml)) {
    for (const m of stripComments(html).matchAll(/\$\s*\d[\d,]*(\.\d+)?/g)) {
      assert.match(m[0].replace(/\s/g, ''), allowedText, `${url}: unconfirmed price "${m[0]}"`);
    }
    const blocks = jsonLd(html);
    for (const key of priceKeys) {
      for (const value of valuesOf(blocks, key)) {
        assert.ok([79, 35].includes(Number(value)), `${url}: JSON-LD ${key} "${value}" is not 79 or 35`);
      }
    }
  }
});

// ---------------------------------------------------------------- 404 styling contract
// Proves: styles.css still has a rule for every class R2's 404.html uses. Comments are removed first,
// and a class only counts when it appears in a selector (before a "{"), as a whole name: ".btn" is not
// satisfied by ".btn-primary".
test('styles.css defines the 404-page contract classes', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]).join('\n');
  for (const cls of ['container', 'btn', 'btn-primary', 'site-header', 'site-footer']) {
    assert.ok(new RegExp(`\\.${cls}(?![\\w-])`).test(selectors), `styles.css: no rule for .${cls}`);
  }
});

// ---------------------------------------------------------------- Icons and manifest
// Proves: every page's <head> links the icons and manifest exactly as the contract table names them,
// so phones, tabs and "add to home screen" all find R2's files.
test('every page links favicon, icon-32, apple-touch-icon and manifest at the contract paths', () => {
  for (const [url, html] of Object.entries(pageHtml)) {
    const links = tags(html, 'link');
    const has = (check) => links.some(check);
    assert.ok(has((t) => attr(t, 'rel') === 'icon' && attr(t, 'href') === '/favicon.ico' && attr(t, 'sizes') === 'any'), `${url}: favicon.ico link`);
    assert.ok(has((t) => attr(t, 'rel') === 'icon' && attr(t, 'href') === '/icons/icon-32.png' && attr(t, 'type') === 'image/png' && attr(t, 'sizes') === '32x32'), `${url}: icon-32 link`);
    assert.ok(has((t) => attr(t, 'rel') === 'apple-touch-icon' && attr(t, 'href') === '/icons/apple-touch-icon.png'), `${url}: apple-touch-icon link`);
    assert.ok(has((t) => attr(t, 'rel') === 'manifest' && attr(t, 'href') === '/site.webmanifest'), `${url}: manifest link`);
  }
});

// ---------------------------------------------------------------- Error messages
// Proves: script.js has its own message for every error code mailer/app.js can send, so a known
// failure is never shown as a guess. Codes are read from app.js as text (every `error: ...` object
// value, including the ternary in the error handler), the same no-import way mailerList() reads SERVICES.
test('script.js has a message for every mailer error code', () => {
  const app = readFileSync(join(ROOT, 'mailer', 'app.js'), 'utf8');
  const codes = new Set();
  for (const m of app.matchAll(/\berror:\s*([^}]*)\}/g)) {
    for (const c of m[1].matchAll(/'([a-z_]+)'/g)) codes.add(c[1]);
  }
  // Guard the parser itself: if app.js is restyled and nothing is found, fail loudly instead of passing.
  for (const known of ['invalid_email', 'rate_limited', 'busy', 'too_large']) {
    assert.ok(codes.has(known), `parser found no "${known}" in mailer/app.js; update this test`);
  }

  const js = read('script.js');
  const block = js.match(/const ERROR_TEXT = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'script.js: no "const ERROR_TEXT = { ... };" block');
  const keys = new Set([...block[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]));
  for (const code of codes) assert.ok(keys.has(code), `script.js ERROR_TEXT has no message for "${code}"`);
});

// ---------------------------------------------------------------- No-JavaScript submit
// Proves: with JavaScript off the form cannot post to /contact/ (nginx answers that with an error page).
// The submit button ships disabled and only script.js enables it, after attaching the JSON handler;
// the form keeps method="post" with no action, so form data can never end up in a URL or access log.
test('contact form cannot be submitted without JavaScript', () => {
  const form = (stripComments(pageHtml['/contact/']).match(/<form\b[^>]*id="contactForm"[^>]*>[\s\S]*?<\/form>/i) || [])[0];
  assert.ok(form, '/contact/ has no #contactForm');
  const open = form.match(/<form\b[^>]*>/i)[0];
  assert.equal(attr(open, 'action'), null, 'the form must not have an action (the mailer only takes JSON)');
  assert.equal(attr(open, 'method'), 'post', 'keep method="post" so data never lands in a URL');
  const submits = tags(form, 'button').filter((t) => attr(t, 'type') === 'submit');
  assert.equal(submits.length, 1, 'expected one submit button');
  assert.match(submits[0], /\sdisabled(\s|>|=)/, 'the submit button must ship disabled');
  assert.ok(!/<input\b[^>]*type="(submit|image)"/i.test(form), 'no other submit controls');
  assert.match(read('script.js'), /sendBtn\.disabled = false/, 'script.js must enable the submit button');
});

// ---------------------------------------------------------------- Title and description lengths
// Proves: every page's title fits in a search result (Google cuts titles at about 60 characters and
// descriptions at about 160), so the brand suffix and the end of the description are not cut off.
// Covers all eight HTML pages (404.html included, for its title) and the meta, og and twitter
// descriptions alike. Lengths are counted after decoding &amp; to "&", as a visitor sees them.
// It also proves the og and twitter descriptions are the same text as the meta description (RA-fix2).
// (RA-fix replaced R1-fix1's single-page title test with this all-pages version.)
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

test('every <title> is 65 characters or less, every description 160 or less, and og/twitter descriptions equal the meta description', () => {
  for (const file of htmlFiles()) {
    const name = relative(ROOT, file);
    const html = readFileSync(file, 'utf8');
    const raw = (stripComments(html).match(/<title>([^<]+)<\/title>/i) || [])[1];
    assert.ok(raw, `${name}: no <title>`);
    const title = decodeEntities(raw.trim());
    assert.ok(title.length <= 65, `${name}: <title> is ${title.length} characters (max 65): ${title}`);
    for (const key of ['description', 'og:description', 'twitter:description']) {
      const value = meta(html, key);
      if (value === null) continue; // 404.html has no descriptions; the contract pages are checked above
      const text = decodeEntities(value);
      assert.ok(text.length <= 160, `${name}: ${key} is ${text.length} characters (max 160)`);
    }
    // Search results and share cards show the same snippet: og and twitter descriptions, where a page
    // has them, are exactly its meta description (SITE.md section 3).
    const description = meta(html, 'description');
    for (const key of ['og:description', 'twitter:description']) {
      const value = meta(html, key);
      if (value === null) continue;
      assert.equal(value, description, `${name}: ${key} differs from the meta description`);
    }
  }
  // Guard the loop itself: the seven contract pages must all have been measured.
  assert.ok(htmlFiles().length >= Object.keys(PAGES).length, 'fewer HTML files than contract pages');
});

// ---------------------------------------------------------------- No maintainer notes in served files
// Proves: nothing nginx serves from public/ tells a visitor private or internal things. Every comment
// in an HTML, CSS, JS, XML or txt file is sent to every visitor, crawler and web archive, so served
// files carry only a short neutral header pointing at SITE.md (which is in the repo, not served).
// Each word below was checked against the visible text of every page before it was added, so it can
// only match maintainer notes. Case-insensitive. Binary files (images, icons) are skipped, but any
// file type not listed in BINARY or TEXT fails, so a new text format is never silently unchecked.
const FORBIDDEN_IN_SERVED = [
  '.claude', // local records folder
  'handoff',
  'BATCH-R-CONTRACT',
  'CSP',
  'Content-Security-Policy',
  'nginx',
  'mailer/', // server source paths
];
const TEXT_EXT = /\.(html|css|js|mjs|json|webmanifest|xml|txt|svg|map)$/i;
const BINARY_EXT = /\.(png|webp|ico|jpe?g|gif|avif)$/i;

test('no served file in public/ contains maintainer notes', () => {
  const files = walk(PUBLIC);
  assert.ok(files.length > 10, 'walk(public/) found almost nothing');
  const hits = [];
  for (const file of files) {
    const name = relative(ROOT, file);
    if (BINARY_EXT.test(file)) continue;
    assert.ok(TEXT_EXT.test(file), `${name}: unknown file type in public/; add it to TEXT_EXT or BINARY_EXT`);
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const word of FORBIDDEN_IN_SERVED) {
      if (text.includes(word.toLowerCase())) hits.push(`${name}: contains "${word}"`);
    }
  }
  assert.deepEqual(hits, [], 'served files must not carry maintainer notes (move them to SITE.md):\n' + hits.join('\n'));
});

// ---------------------------------------------------------------- Served comments and the address
// Proves: served comments never discuss the business address (no-address rule).
// Only COMMENTS are scanned, so visible text (the footer, the contact page, "nothing at this address"
// on the 404 page, the "valid email address" error text) is never a false failure.
// Comment forms per file type:
//   html, xml, svg   <!-- ... -->
//   css              /* ... */
//   js, mjs          /* ... */ and // to end of line (only when // starts the line or follows
//                    whitespace, so "https://" inside a string is not taken for a comment)
//   txt              # to end of line (robots.txt)
//   json, webmanifest, map: JSON has no comments, so nothing to scan.
// Text is NFKC-normalised and curly apostrophes/quotes are folded to straight ones before matching,
// so a typographic variant of a sentence cannot slip past.
const ADDRESS_WORDS_RE = /address|street|postal|zip ?code/i;

/** Every comment body in one served text file, chosen by its extension (see the table above). */
function servedComments(file, text) {
  const all = (re) => [...text.matchAll(re)].map((m) => m[1]);
  if (/\.(html|xml|svg)$/i.test(file)) return all(/<!--([\s\S]*?)-->/g);
  if (/\.css$/i.test(file)) return all(/\/\*([\s\S]*?)\*\//g);
  if (/\.m?js$/i.test(file)) return [...all(/\/\*([\s\S]*?)\*\//g), ...all(/(?:^|\s)\/\/([^\n]*)/gm)];
  if (/\.txt$/i.test(file)) return all(/#([^\n]*)/g);
  return [];
}

/** Folds typographic apostrophes and quotes to plain ones so variants match the same words. */
const foldQuotes = (s) => s.normalize('NFKC').replace(/[‘’‚‛′]/g, "'").replace(/[“”„″]/g, '"');

test('served comments never discuss the business address', () => {
  const hits = [];
  let scanned = 0;
  for (const file of walk(PUBLIC)) {
    if (!TEXT_EXT.test(file)) continue; // binary files; unknown types already fail the test above
    for (const comment of servedComments(file, readFileSync(file, 'utf8'))) {
      scanned += 1;
      if (ADDRESS_WORDS_RE.test(foldQuotes(comment))) hits.push(`${relative(ROOT, file)}: ${comment.trim().slice(0, 80)}`);
    }
  }
  // Guard the scanner itself: the pages, styles.css and script.js all carry header comments.
  assert.ok(scanned >= 9, `only ${scanned} served comments found; the comment scanner is broken`);
  assert.deepEqual(hits, [], 'served comments must not mention an address:\n' + hits.join('\n'));
});

// ---------------------------------------------------------------- Descriptions agree with the page
// Proves: a service page's search/share snippet never claims a service area the page itself does not
// show (audit finding F2: the software descriptions said on-site while the page said remote only).
// For each service page: if any of its meta/og/twitter descriptions says "on-site", its visible
// "Where" panel says on-site or in-person; if a description says remote / anywhere in the US, the
// panel says remote(ly) or anywhere in the US. And the other way round, so neither side drifts.
test('service-page descriptions and the visible Where panel name the same service area', () => {
  for (const url of SERVICE_URLS) {
    const html = pageHtml[url];
    const where = (stripComments(html).match(/<h2>Where<\/h2>\s*<p>([\s\S]*?)<\/p>/i) || [])[1];
    assert.ok(where, `${url}: no visible "Where" panel`);
    const panel = decodeEntities(where).toLowerCase();
    const panelOnSite = /on-site|in-person/.test(panel);
    const panelRemote = /remote|anywhere in the us/.test(panel);
    for (const key of ['description', 'og:description', 'twitter:description']) {
      const text = decodeEntities(meta(html, key) || '').toLowerCase();
      assert.equal(/on-site|in-person/.test(text), panelOnSite, `${url}: ${key} and the Where panel disagree about on-site work`);
      assert.equal(/remote|anywhere in the us|across the us/.test(text), panelRemote, `${url}: ${key} and the Where panel disagree about remote work`);
    }
  }
});
