// public/script.js
// --------- Edit these values ----------
const BUSINESS_NAME = 'Dark Matter IT Solutions';
const YOUR_NAME = 'Cody Traenkner';
const EMAIL = 'ctraenk@darkmatterits.com';
const PHONE_TEL = '+18562090353'; // tel: format (+1...)
const PHONE_DISPLAY = '+1 (856) 209-0353';
// --------------------------------------

function $(id) {
  return document.getElementById(id);
}

// Year
const yearEl = $('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Name in hero card (optional element)
const yourNameEl = $('yourName');
if (yourNameEl) yourNameEl.textContent = YOUR_NAME;

// Update contact links (top card)
const emailLink = $('emailLink');
if (emailLink) {
  emailLink.textContent = EMAIL;
  emailLink.href = `mailto:${EMAIL}`;
}

const phoneLink = $('phoneLink');
if (phoneLink) {
  phoneLink.textContent = PHONE_DISPLAY;
  phoneLink.href = `tel:${PHONE_TEL}`;
}

// Update contact links (contact section)
const emailLink2 = $('emailLink2');
if (emailLink2) {
  emailLink2.textContent = EMAIL;
  emailLink2.href = `mailto:${EMAIL}`;
}

const phoneLink2 = $('phoneLink2');
if (phoneLink2) {
  phoneLink2.textContent = PHONE_DISPLAY;
  phoneLink2.href = `tel:${PHONE_TEL}`;
}

// Logo fallback if image missing (optional element)
const logoImg = $('logoImg');
if (logoImg) {
  logoImg.addEventListener('error', () => {
    logoImg.style.display = 'none';
  });
}

// Toast
const toast = $('toast');
let toastTimer = null;

/**
 * Show a toast message.
 * Requires: <div class="toast" id="toast"></div>
 * Optional: add CSS for `.toast.bad` for error styling.
 */
function showToast(msg, isError = false) {
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.toggle('bad', isError);
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// Copy buttons
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const val = btn.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(val);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed — copy manually', true);
    }
  });
});

// Support form (email only) -> backend API
const form = $('contactForm');

// Same rule as the server: a plain address, no spaces, commas, quotes or angle brackets.
function isEmail(v) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v);
}

const charCount = (s) => [...s].length;

// Messages for each server error code. Nothing from the server is shown as-is.
const ERROR_TEXT = {
  invalid_name: 'Please enter your name (2–120 characters).',
  invalid_email: 'Please enter a valid email address.',
  invalid_message: 'Please write a message of 10–4000 characters.',
  rate_limited: `Too many requests. Please wait a few minutes, or email ${EMAIL}.`,
  busy: `We're receiving a lot of requests. Please email ${EMAIL} or call ${PHONE_DISPLAY}.`,
};

form?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = ($('name')?.value || '').trim();
  const email = ($('contactEmail')?.value || '').trim();
  const service = ($('service')?.value || '').trim();
  const urgency = ($('urgency')?.value || '').trim();
  const message = ($('message')?.value || '').trim();
  const website = $('website')?.value || ''; // honeypot, stays empty for people

  const fieldError =
    charCount(name) < 2 || charCount(name) > 120 ? ['name', ERROR_TEXT.invalid_name]
    : !isEmail(email) || email.length > 200 ? ['contactEmail', ERROR_TEXT.invalid_email]
    : charCount(message) < 10 || charCount(message) > 4000 ? ['message', ERROR_TEXT.invalid_message]
    : null;
  if (fieldError) {
    showToast(fieldError[1], true);
    $(fieldError[0])?.focus();
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone: '', service, urgency, message, website }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 429 ? 'rate_limited' : data.error;
      showToast(ERROR_TEXT[code] || `Could not send. Please email ${EMAIL} or call ${PHONE_DISPLAY}.`, true);
      return;
    }

    showToast('Request sent! We’ll respond ASAP.');
    form.reset();
  } catch {
    showToast(`Could not send. Please email ${EMAIL} or call ${PHONE_DISPLAY}.`, true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
