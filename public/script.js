// public/script.js
// --------- Edit these values ----------
const BUSINESS_NAME = 'Dark Matter IT Solutions';
const YOUR_NAME = 'Cody Traenkner';
const EMAIL = 'ctraenk@darkmatterits.com';
const PHONE_TEL = '+10000000000'; // tel: format (+1...)
const PHONE_DISPLAY = '+1 (000) 000-0000';
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

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = ($('name')?.value || '').trim();
  const email = ($('contactEmail')?.value || '').trim();
  const service = ($('service')?.value || '').trim();
  const urgency = ($('urgency')?.value || '').trim();
  const details = ($('message')?.value || '').trim();

  if (name.length < 2) {
    showToast('Please enter your name.', true);
    return;
  }
  if (!isEmail(email)) {
    showToast('Please enter a valid email address.', true);
    return;
  }
  if (details.length < 5) {
    showToast('Please include a short message.', true);
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const payload = {
      name,
      email,
      phone: '',
      message:
        `Business: ${BUSINESS_NAME}\n` +
        `Service: ${service || 'N/A'}\n` +
        `Urgency: ${urgency || 'Normal'}\n\n` +
        `Details:\n${details}`,
    };

    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(data.error || `Request failed (${res.status})`);

    showToast('Request sent! We’ll respond ASAP.');
    form.reset();
  } catch (err) {
    console.error(err);
    showToast('Could not send. Please try again.', true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
