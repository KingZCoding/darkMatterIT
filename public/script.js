// Script for every page of darkmatterits.com. Maintainers: see SITE.md in the repository.
//
// Every feature below looks for its elements first and does nothing when they are missing, so this
// file must never throw on a page without the form, the nav menu or the toast.
//
// What it does:
//   1. Footer year.
//   2. Services menu (<details>): close on Escape or a click outside. The menu already works with no
//      JavaScript; this only adds the expected behaviour.
//   3. Copy buttons ([data-copy]) on /contact/.
//   4. The support form on /contact/: checks the fields the same way the server does, then posts JSON
//      to POST /api/support. The submit button ships disabled and is enabled here, so the form is
//      never sent without JavaScript.
//
// Security: this file never parses or writes HTML; text reaches the page through textContent only.
// Server replies are never shown as-is: only our own messages, picked by error code.

'use strict';

// ---------------------------------------------------------------- Business details
// The contact details shown in messages.
const EMAIL = 'ctraenk@darkmatterits.com';
// The pages link the same number as tel:+18562103508; only the display form is needed in messages.
const PHONE_DISPLAY = '(856) 210-3508';

const byId = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 1. Footer year
document.querySelectorAll('.js-year').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

// ---------------------------------------------------------------- 2. Services menu
/** Close every open nav <details> menu except `keep` (may be null). */
function closeMenus(keep) {
  document.querySelectorAll('details.nav-menu[open]').forEach((menu) => {
    if (menu !== keep) menu.removeAttribute('open');
  });
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  closeMenus(target ? target.closest('details.nav-menu') : null);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = document.querySelector('details.nav-menu[open]');
  if (!open) return;
  open.removeAttribute('open');
  open.querySelector('summary')?.focus(); // put keyboard users back where they were
});

// ---------------------------------------------------------------- Toast
const toast = byId('toast');
let toastTimer = null;

/**
 * Show a short status message in the #toast live region (announced by screen readers).
 * Does nothing on pages without #toast. `msg` is set with textContent, never as HTML.
 */
function showToast(msg, isError = false) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.toggle('bad', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 3500);
}

// ---------------------------------------------------------------- 3. Copy buttons
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const value = btn.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(value);
      showToast('Copied to clipboard');
    } catch {
      // Clipboard needs https and permission; tell the person instead of failing silently.
      showToast('Copy failed. Please copy it by hand.', true);
    }
  });
});

// ---------------------------------------------------------------- 4. Support form
const form = byId('contactForm');

// Same rule as the server: one plain email, no spaces, commas, quotes or angle brackets.
function isEmail(value) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}

// Length in characters, not UTF-16 units, matching the server's check.
const charCount = (s) => [...s].length;

// Our message for each error code the server can return. Nothing from the server is shown as-is.
// Every code has an entry, so a known failure never falls through to a guess.
// Codes that mean "our side failed" (send_failed, server_error, ...) show the fallback contacts.
const FALLBACK_TEXT = `Could not send. Please email ${EMAIL} or call ${PHONE_DISPLAY}.`;
const ERROR_TEXT = {
  invalid_field: 'Please check the form fields and try again.',
  invalid_name: 'Please enter your name (2–120 characters).',
  invalid_email: 'Please enter a valid email address.',
  invalid_phone: 'Please check the phone number (up to 40 characters).',
  invalid_message: 'Please write a message of 10–4000 characters.',
  too_large: 'Your message is too long. Please shorten it.',
  rate_limited: `Too many requests. Please wait a few minutes, or email ${EMAIL}.`,
  busy: `We're receiving a lot of requests. Please email ${EMAIL} or call ${PHONE_DISPLAY}.`,
  send_failed: FALLBACK_TEXT,
  server_error: FALLBACK_TEXT,
  bad_request: FALLBACK_TEXT,
  not_found: FALLBACK_TEXT,
};

/** Trimmed value of a form field by id, or '' when the field is missing. */
function fieldValue(id) {
  const el = byId(id);
  return el && 'value' in el ? String(el.value).trim() : '';
}

/**
 * Check the fields like the server does. Returns [fieldId, message] for the first
 * problem, or null when everything is fine. Input: the values about to be sent.
 */
function firstFieldError({ name, email, phone, message }) {
  if (charCount(name) < 2 || charCount(name) > 120) return ['name', ERROR_TEXT.invalid_name];
  if (!isEmail(email) || email.length > 200) return ['email', ERROR_TEXT.invalid_email];
  if (charCount(phone) > 40) return ['phone', ERROR_TEXT.invalid_phone];
  if (charCount(message) < 10 || charCount(message) > 4000) return ['message', ERROR_TEXT.invalid_message];
  return null;
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const values = {
      name: fieldValue('name'),
      email: fieldValue('email'),
      phone: fieldValue('phone'),
      service: fieldValue('service'),
      urgency: fieldValue('urgency'),
      message: fieldValue('message'),
    };
    // Hidden field that stays empty for people. Sent untrimmed; the server trims it.
    const honeypot = byId('website');
    const website = honeypot && 'value' in honeypot ? String(honeypot.value) : '';

    const problem = firstFieldError(values);
    if (problem) {
      showToast(problem[1], true);
      byId(problem[0])?.focus();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    // Nothing hangs: give up after 15 s and show the fallback contact details.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, website }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = res.status === 429 ? 'rate_limited' : res.status === 413 ? 'too_large' : data && data.error;
        // hasOwn: a reply like {"error":"constructor"} must not pick up an inherited property.
        const known = typeof code === 'string' && Object.hasOwn(ERROR_TEXT, code);
        showToast(known ? ERROR_TEXT[code] : FALLBACK_TEXT, true);
        return;
      }

      showToast('Request sent. Thank you!');
      form.reset();
    } catch {
      showToast(FALLBACK_TEXT, true);
    } finally {
      clearTimeout(timer);
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // The submit button ships `disabled` in /contact/index.html so that, with no JavaScript, the form
  // cannot do a plain browser submit. Enable it only now that the JSON handler above is attached.
  const sendBtn = form.querySelector('button[type="submit"]');
  if (sendBtn) sendBtn.disabled = false;
}
