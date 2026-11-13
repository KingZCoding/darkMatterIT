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
  `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`); `/styles.css?v=...`;
  `<script src="/script.js?v=..." defer>`; then the JSON-LD blocks. The `?v=` versions are written by
  `site-tests/bump-asset-versions.mjs` (section 12a); never edit them by hand.
- The site header (one row at every width): skip link to `#main`, the brand link (logo plus "Dark Matter"
  over "IT Solutions"), then two navigations that hold the same links:
  - `.site-nav` (960px and wider): the Services `<details class="nav-menu">` dropdown with an icon per
    service, Contact, and the Call button.
  - `.header-actions` (below 960px): a Call icon button (`tel:` link) and a labelled Menu button. The Menu
    is `<details class="nav-menu nav-mobile">`; its panel lists the five services (icon, name, short
    line), Contact and Call. Tapping the dimmed page behind it closes it.
  Both menus are `<details>`, so they open and close with no JavaScript; `script.js` only adds
  close-on-Escape and close-on-outside-click. The menu's short lines must stay true (section 4).
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
| `/img/icons.svg` | icon sprite drawn for this site: one `<symbol id="i-...">` per icon (services, phone, mail, pin, globe, user, tag, send, arrow). Pages use `<svg class="icon" aria-hidden="true" focusable="false"><use href="/img/icons.svg?v=...#i-name"></use></svg>`; strokes use `currentColor`. Versioned like the stylesheet (section 12a) |
| `/icons/icon-512.png` (also) | the large logo in the home hero on wide screens: a CSS background on the empty `.hero-logo` span, set only in the 960px block of `styles.css`, so phones never download it |
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
- Mobile first: the base rules are for phones; `min-width` media queries add 560px, 768px and 960px
  layouts. Check every page at 320px, 360px, 375px, 414px, 768px and 1280px after a change, with the
  phone menu closed and open.
- Narrow phones: three `max-width` steps keep the phone layout tidy down to 320px. Under 480px the
  menu's Contact and Call buttons stack, so the full phone number fits in its button. Under 400px the
  header tightens its tracking and gaps. Under 375px the Menu button shows only its three bars; the word
  "Menu" is in `<span class="menu-label">` and is clipped, not removed, so screen readers still read it.
  The brand words never wrap, so keep at least 8px between them and the header buttons at every width
  above (checked by eye; `site-tests/narrow-header.test.mjs` checks that the steps are still there).
- Look: dark "deep space" theme taken from the logo (violet-to-blue glow on near-black). Tokens are at the
  top of the file; `--grad` is the brand gradient used by primary buttons, gradient text and prices.
- The header is one row and sticky at every width. Its frosted background is on `.site-header::before`,
  not the header itself, because a `backdrop-filter` on the header would trap the fixed-position phone
  menu panel inside the header box.
- Home service cards: two columns on phones (icon, name, price and an arrow; the description and tag
  show from 560px), the fifth card a full-width row; 3 + 2 on desktop. The whole card is the link
  (`.card-link::after` is stretched over it).
- Motion: slow nebula drift and star field on `html::before`/`html::after`, orbit rings in the home
  hero, the logo floating in turning rings on wide screens, hero text sliding up on load, hover and
  press states, and scroll reveal: `script.js` adds `.js-reveal` to `<html>` (only when
  IntersectionObserver exists and reduced motion is not requested) and `.is-in` to each `.reveal`
  as it comes into view. With no JavaScript nothing is hidden.
- Everything that moves is switched off under `prefers-reduced-motion` (bottom of the file).
- Entrance animations (hero text, service icon, phone menu, menu items, Services dropdown) move things
  only and never fade them: no keyframe starts hidden, so text and menus are fully visible even when an
  animation is paused, throttled or skipped. `site-tests/motion.test.mjs` checks this.
- The hero logo and its rings are fully visible at rest: nothing in `.hero-visual` fades in, so a paused
  or throttled animation never leaves the right half of the hero empty. Under reduced motion they stand
  still.
- Readability floor, checked by `site-tests/readability.test.mjs`: no `font-size` below 0.875rem (14px)
  (`font-size: 0` only for a visually hidden label); body and description text 1rem or more with
  line-height 1.5 or more; button labels 1rem and bold; buttons and other tap targets 44px or taller;
  the key text colours at WCAG AA 4.5:1 on every surface they sit on (translucent surfaces composited
  over `--bg`, gradients checked at every stop, including the dark label on the primary button).
- Fonts: the system font stack (no font files; section 8).

## 12. Tests and CI
- Run from the repo root: `node --test site-tests/*.test.mjs` (Node built-ins only, no package.json).
- `site-tests/pages.test.mjs`: the pages (sections 1-6, 9). `site-tests/seo.test.mjs`: sitemap, robots,
  manifest, icons, 404 (sections 7, 10). `site-tests/links.test.mjs`: every internal link resolves.
- `.github/workflows/check.yml` runs the site tests and a smoke test that starts the pinned nginx image
  with `public/` and `nginx/conf.d/` and checks status codes, headers and the 404 page.
- `site-tests/readability.test.mjs`: contrast, text sizes and tap targets read from `styles.css` (section 11).
- `site-tests/motion.test.mjs`: no `@keyframes` starts hidden, and the animated text and menu parts are
  visible at rest (section 11).
- `site-tests/narrow-header.test.mjs`: the narrow-phone steps and the `.menu-label` span (section 11).
- `site-tests/assets.test.mjs`: every page loads the current `?v=` version of the stylesheet, the
  script and the icon sprite (section 12a).

### 12a. Cache-busting asset versions
Browsers (phones especially) keep `/styles.css` and `/script.js` for an hour and `/img/icons.svg` for 7
days. New HTML with an old cached stylesheet looks broken, so every reference carries
`?v=<first 10 hex of the SHA-256 of the file with LF line endings>`.
- After changing `public/styles.css`, `public/script.js` or `public/img/icons.svg`, run from the repo
  root: `node site-tests/bump-asset-versions.mjs`. It rewrites every reference in `public/**/*.html`.
  `--check` changes nothing and exits 1 when a page is stale.
- `site-tests/assets.test.mjs` fails when any version is missing or stale.
- The link checker ignores query strings, so `/styles.css?v=...` still resolves to the file.
