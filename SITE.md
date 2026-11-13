# SITE.md: maintainer notes for the darkmatterits.com static site

Read this before changing anything in `public/`. It holds the notes that used to sit in comments inside
the served files. Those comments go to every visitor (View Source), every crawler and every web archive,
so served files now carry only a short neutral header that points here. This file is in the repository
only; nginx serves `public/` and nothing else, so it is never served.

This file is public in the GitHub repository, so it too must never hold private details: no IPs, hosts
or secrets.

## 1. Rules for every served file
- Keep comments in `public/` short and neutral: what the file is, plus "Maintainers: see SITE.md in the
  repository". Put the why and the how here instead.
- Never write in a served file: records paths (`.claude/`, handoffs, contract file names), server
  internals (nginx, the reverse proxy, the Content-Security-Policy, the mail service's source paths),
  rule numbers, task ids or decision dates.
  `site-tests/pages.test.mjs` ("no served file in public/ contains maintainer notes") fails on the
  worst of these words, case-insensitive, in every text file under `public/`. A new file type in
  `public/` must be added to that test's TEXT_EXT or BINARY_EXT list, or the test fails.
- Served comments never mention an address (street, postal code or the word "address" itself, even
  an email one). `site-tests/pages.test.mjs` ("served comments never discuss the business address")
  scans only comments, so visible page text is not affected.

## 2. Page structure and URL contract
Every page is a folder with an `index.html` (nginx: `try_files $uri $uri/ =404`, `index index.html`).

| URL | File |
|---|---|
| `/` | `public/index.html` |
| `/software-development/` | `public/software-development/index.html` |
| `/managed-hosting/` | `public/managed-hosting/index.html` |
| `/networking-wifi/` | `public/networking-wifi/index.html` |
| `/tech-support/` | `public/tech-support/index.html` |
| `/hardware-pc-builds/` | `public/hardware-pc-builds/index.html` |
| `/contact/` | `public/contact/index.html` |
| (404) | `public/404.html`: noindex, never in the sitemap |

- Canonical URLs are `https://darkmatterits.com` + the URL above, with the trailing slash.
- All internal links and asset references are root-absolute (`/styles.css`, `/contact/`), never
  relative, because pages live in sub-folders and the 404 page is served at any path. A folder link
  without its slash (`/contact`) is a test failure: nginx would answer it with a 301.
- Adding or removing a page means changing, together: the page folder, `public/sitemap.xml`,
  `PAGES` in `site-tests/pages.test.mjs`, `CONTRACT_PATHS` in `site-tests/seo.test.mjs`, the header nav,
  the footer links, and the "Other services" lists on the service pages.

### What each page holds
- Home: what the business does, where it works, one card per service page, the two true prices and the
  call to action to `/contact/`.
- Each service page: breadcrumb (Home -> page), what the service covers, a "Where" panel, a "Price"
  panel (a price only where a true one exists), a call-to-action band and "Other services" links.
- `/contact/`: direct phone and email (with copy buttons) and the support request form.
- `404.html`: "Page not found" with links back to `/` and `/contact/`. No address, phone or other claims.

## 3. Blocks shared by all seven pages (keep them in step)
When you change one of these on one page, change it on all seven:
- The `<head>` layout, in this order: charset, viewport, `<title>`, meta description, robots, canonical,
  `theme-color`; the icon and manifest links (section 7); Open Graph and Twitter tags (`og:site_name`,
  `og:type`, `og:locale`, `og:title`, `og:description`, `og:url`, `og:image` + width/height/alt,
  `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`); `/styles.css`;
  `<script src="/script.js" defer>`; then the JSON-LD blocks.
- The site header: skip link to `#main`, the brand link, the main nav with the Services `<details>` menu
  (works with no JavaScript; `script.js` only adds close-on-Escape and close-on-outside-click).
- The site footer: the service-area line, the five service links, phone, email, the contact form link
  and the year (`.js-year`, filled in by `script.js`).
- Titles are 65 characters or less and descriptions 160 or less (Google cuts longer ones). Every
  title and description is unique. Meta, og and twitter descriptions on one page are the same text.
  A service page's descriptions must name the same service area as its visible "Where" panel.
  `site-tests/pages.test.mjs` checks all of this (lengths, uniqueness, og/twitter descriptions equal
  to the meta description, and descriptions vs. the "Where" panel).

## 4. Facts allowed in public text
Nothing else may be stated as fact in page text, titles, descriptions, JSON-LD, alt text or images.
- Business name: Dark Matter IT Solutions. Owner: Cody Traenkner.
- Service area: Gloucester County & Camden County, NJ (on-site); remote support across the US.
  Software development: remote anywhere in the US, and on-site in Gloucester & Camden County, NJ.
- Remote support from $79.
- Managed hosting $35/mo flat: covers hosting, SSL and backups.
- Email: ctraenk@darkmatterits.com
- Phone: display `(856) 210-3508`, link `tel:+18562103508`, JSON-LD `"+1-856-210-3508"`.
  The old number must not appear anywhere in `public/` (the tests check every way of writing it).
- No testimonials, years in business, client counts, ratings, stats, response-time promises or
  guarantees. Any new claim needs Cody's yes first.
- The only prices anywhere are $79 and $35 (tests check page text and JSON-LD price fields).

## 5. No street address
Never add a street address, postal code or geo data anywhere: page text, footer, JSON-LD (`address`,
`streetAddress`, `postalCode`, `addressLocality`, `geo`, `latitude`, `longitude`, `hasMap`), `geo.*` meta
tags or `<address>` markup. The business is listed as a service-area business only (Cody's decision
2026-11-13).

## 6. Structured data (JSON-LD)
- Home: one `ProfessionalService` with name, url, logo, image, telephone, email and `areaServed`
  (Gloucester County NJ, Camden County NJ, United States). No address or geo keys.
- Each service page: one `Service` (provider = the business, areaServed, `offers` only where a true price
  exists: $79 minPrice for tech support, $35 per month for hosting) and one `BreadcrumbList` (Home -> page).
- `/contact/`: `ContactPage` and a `BreadcrumbList`.
- No `FAQPage` unless the same questions and answers are visible on that page.

## 7. Icons and images (exact filenames; pages and the manifest reference these)
| Path | What |
|---|---|
| `/img/logo-mark.webp` | logo, 128x128 WebP (header/footer logo inside `<picture>`) |
| `/img/logo-mark.png` | same, 128x128 PNG fallback; JSON-LD `logo` |
| `/img/og-image.png` | 1200x630 social card; `og:image`, `twitter:image` (absolute https), JSON-LD `image` |
| `/favicon.ico` | 16/32/48 multi-size; `<link rel="icon" href="/favicon.ico" sizes="any">` |
| `/icons/icon-32.png` | `<link rel="icon" type="image/png" sizes="32x32">` |
| `/icons/apple-touch-icon.png` | 180x180, opaque; `<link rel="apple-touch-icon">` |
| `/icons/icon-192.png`, `/icons/icon-512.png` | manifest icons only |
| `/site.webmanifest` | name, short_name, icons, theme/background colour |

The dark background colour (`--bg` in `styles.css`) is also every page's `<meta name="theme-color">` and
the manifest's theme and background colour: change all three together. Images carry no EXIF, GPS or
text metadata.

## 8. Content-Security-Policy limits
The public proxy sends `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'
'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'`. The site is built stricter than that:
- Everything self-hosted: no external fonts, scripts, CSS, images, analytics, iframes or embeds. The font
  stack is system fonts; every `url()` in `styles.css` is a `data:` URI or root-absolute; no `@import`
  or `@font-face`.
- No inline JavaScript, no `on*=` handlers, no `style="..."` attributes and no `<style>` blocks.
  JSON-LD `<script type="application/ld+json">` blocks are fine.
- `script.js` never writes HTML (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`);
  text reaches the page through `textContent` only.

## 9. The contact form contract
- Lives on `/contact/` only. `script.js` posts JSON to `POST /api/support`, which nginx proxies to the
  mailer (`mailer/app.js`). Fields: `name`, `email`, `phone`, `service`, `urgency`, `message`, plus the
  hidden honeypot `website`.
- `service` option values must equal `SERVICES` in `mailer/app.js`, and `urgency` values must equal
  `URGENCIES`. The tests read both lists from `app.js` as text and fail if the form drifts.
- `ERROR_TEXT` in `script.js` has a message for every `error:` code `mailer/app.js` can return; the
  tests fail if a code is missing. Server text is never shown; codes that mean "our side failed" show
  the fallback contact details. The 15 s request timeout shows the same fallback.
- `script.js` checks fields the same way the mailer's `validate()` does (lengths in characters, the
  same email rule) before sending.
- The honeypot `website` stays empty, sits in the off-screen `.hp` wrapper (never `display:none`, which
  some bots skip), `aria-hidden="true"`, `tabindex="-1"`, `autocomplete="off"`. The mailer answers a
  filled honeypot with a fake success.
- No-JavaScript safety: the form has no `action` and the mailer only takes JSON, so a plain browser
  submit has nowhere valid to go. The submit button ships `disabled` and `script.js` enables it only after
  attaching the JSON handler. The `<noscript>` text gives the email and phone instead. `method="post"` is
  kept so that, if a plain submit ever happened, the visitor's details stay out of the URL and the
  access log.
- `script.js` is loaded on every page, including `404.html`, and must never throw on a page that lacks
  the form, the nav menu or the toast.

## 10. The 404 page, sitemap and robots
- nginx serves `404.html` for every 404 (`error_page 404 /404.html`), at whatever path was asked for,
  with the status still 404; a direct GET of `/404.html` is also a 404 (`internal`). It uses only
  `/styles.css`, `/script.js` and the classes `container`, `btn`, `btn-primary`, `site-header`,
  `site-footer` (plus bare `body`, `main`, `h1`, `h2`, `p`, `a`). Never rename or drop those classes in
  `styles.css`. The id `dmits-404-page` on its `<main>` is what the CI smoke test looks for.
- `sitemap.xml` lists exactly the seven contract URLs, absolute https with a trailing slash. No
  `<lastmod>`: nothing keeps it true, and a wrong date is worse than none.
- `robots.txt` allows everything and names the sitemap. The 404 page carries its own noindex.
- nginx sends these three files with a one-hour cache (`expires 1h`) and explicit content types.

## 11. Stylesheet notes (`public/styles.css`)
- Dark theme: dark navy background with a violet-to-cyan accent and clear focus rings.
- The header is sticky above 680px and static at 680px and below (a two-row header would cover too much
  of a phone screen). Neither needs JavaScript.
- Everything that moves is switched off under `prefers-reduced-motion` (bottom of the file).

## 12. Tests and CI
- Run from the repo root: `node --test site-tests/*.test.mjs` (Node built-ins only, no package.json).
- `site-tests/pages.test.mjs`: the pages (sections 1-6, 9). `site-tests/seo.test.mjs`: sitemap, robots,
  manifest, icons, 404 (sections 7, 10). `site-tests/links.test.mjs`: every internal link resolves.
- `.github/workflows/check.yml` runs the site tests and a smoke test that starts the pinned nginx image
  with `public/` and `nginx/conf.d/` and checks status codes, headers and the 404 page.
