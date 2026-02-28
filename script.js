// --------- Edit these values ----------
const BUSINESS_NAME = 'Dark Matter IT Solutions';
const YOUR_NAME = 'YOUR NAME';
const EMAIL = 'you@domain.com';
const PHONE_TEL = '+10000000000'; // tel: format (+1...)
const PHONE_DISPLAY = '+1 (000) 000-0000';
// --------------------------------------

function $(id) {
  return document.getElementById(id);
}

// Year
$('year').textContent = new Date().getFullYear();

// Name in hero card
$('yourName').textContent = YOUR_NAME;

// Update contact links
const emailLink = $('emailLink');
emailLink.textContent = EMAIL;
emailLink.href = `mailto:${EMAIL}`;

const phoneLink = $('phoneLink');
phoneLink.textContent = PHONE_DISPLAY;
phoneLink.href = `tel:${PHONE_TEL}`;

// Logo fallback if image missing
const logoImg = $('logoImg');
logoImg.addEventListener('error', () => {
  logoImg.style.display = 'none';
});

// Toast
const toast = $('toast');
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// Copy buttons
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const val = btn.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(val);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed — copy manually');
    }
  });
});

// Contact form -> mailto (no backend required)
const form = $('contactForm');
const mailtoLink = $('mailtoLink');

function buildMailto() {
  const name = $('name').value.trim();
  const contactInfo = $('contactInfo').value.trim();
  const service = $('service').value;
  const urgency = $('urgency').value;
  const message = $('message').value.trim();

  const subject = encodeURIComponent(
    `[${BUSINESS_NAME}] Support Request — ${service} (${urgency})`,
  );
  const bodyLines = [
    `Name: ${name}`,
    `Preferred contact: ${contactInfo}`,
    `Service: ${service}`,
    `Urgency: ${urgency}`,
    ``,
    `Details:`,
    message || '(no additional details provided)',
    ``,
    `— Sent from ${BUSINESS_NAME} landing page`,
  ];

  const body = encodeURIComponent(bodyLines.join('\n'));
  return `mailto:${EMAIL}?subject=${subject}&body=${body}`;
}

mailtoLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = buildMailto();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const name = $('name').value.trim();
  const contactInfo = $('contactInfo').value.trim();
  if (!name || !contactInfo) {
    showToast('Please add your name and contact info.');
    return;
  }

  window.location.href = buildMailto();
  showToast('Opening your email app…');
  form.reset();
});
