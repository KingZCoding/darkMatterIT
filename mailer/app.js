// darkmatter-mailer: the contact form backend for darkmatterits.com.
//
// Request path: VPS nginx (TLS) -> Pi site nginx (location = /api/support) -> here as POST /support.
// The site nginx overwrites X-Forwarded-For with the real client address (realip from the VPS),
// so exactly one proxy hop is trusted here.
//
// Abuse controls (the form can mail any address, so it must not be a relay):
//   - per-client rate limit here, plus limit_req in the site nginx
//   - honeypot field: bots that fill `website` get a fake success and nothing is sent
//   - the confirmation email to the visitor is fixed text: none of their input is echoed
//   - at most one confirmation per recipient per 24 h, and daily caps on both emails
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

export const BUSINESS_NAME = 'Dark Matter IT Solutions';

const DAY_MS = 24 * 60 * 60 * 1000;
// Plain addr-spec only: no display names, quotes, commas, semicolons, angle brackets or spaces,
// so one field can never become several recipients.
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Control characters (and Unicode line separators) are never allowed in single-line fields.
const LINE_CTRL = new RegExp('[\u0000-\u001f\u007f\u2028\u2029]');
// Multi-line text may contain tab, CR and LF but no other control characters.
const TEXT_CTRL = new RegExp('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]');

export const SERVICES = [
  'Software Development',
  'Hosting Services',
  'Remote Technical Support',
  'Hardware Support',
  'Networking',
  'Other',
];
export const URGENCIES = ['Normal', 'Today', 'Urgent'];

// Length in characters, not UTF-16 units (so emoji and CJK count as one).
const len = (s) => [...s].length;

function field(body, key) {
  const v = body?.[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null; // objects/arrays/numbers are rejected, not coerced
  return v.trim();
}

class DailyCounter {
  constructor(limit, now) {
    this.limit = limit;
    this.now = now;
    this.day = null;
    this.count = 0;
  }
  take() {
    const day = Math.floor(this.now() / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}

// One mailbox, one key: lowercased, +tags dropped, and dots ignored for Gmail, so
// jane+1@gmail.com and j.a.n.e@gmail.com don't each get their own confirmation.
export function recipientKey(email) {
  let [local, domain] = email.toLowerCase().split('@');
  local = local.split('+')[0] || local; // "+x@..." keeps its whole local part
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}

export function validate(body) {
  const name = field(body, 'name');
  const email = field(body, 'email');
  const phone = field(body, 'phone');
  const message = field(body, 'message');
  const service = field(body, 'service');
  const urgency = field(body, 'urgency');
  const website = field(body, 'website');

  if ([name, email, phone, message, service, urgency, website].includes(null))
    return { error: 'invalid_field' };
  if (len(name) < 2 || len(name) > 120 || LINE_CTRL.test(name)) return { error: 'invalid_name' };
  if (email.length > 200 || !EMAIL_RE.test(email)) return { error: 'invalid_email' };
  if (len(phone) > 40 || LINE_CTRL.test(phone)) return { error: 'invalid_phone' };
  if (len(message) < 10 || len(message) > 4000 || TEXT_CTRL.test(message))
    return { error: 'invalid_message' };

  return {
    value: {
      name,
      email,
      phone,
      message,
      service: SERVICES.includes(service) ? service : 'Other',
      urgency: URGENCIES.includes(urgency) ? urgency : 'Normal',
      honeypot: website !== '',
    },
  };
}

/**
 * @param {object} opts
 * @param {{sendMail: (msg: object) => Promise<unknown>}} opts.transporter
 * @param {string} opts.supportTo   inbox that receives requests
 * @param {string} opts.fromEmail   sender address (must be the SMTP user or a verified alias)
 * @param {number} [opts.supportDailyCap]  max support emails per day
 * @param {number} [opts.confirmDailyCap]  max confirmation emails per day
 * @param {number} [opts.perIpLimit]       max requests per client per window
 * @param {number} [opts.perIpWindowMs]
 * @param {() => number} [opts.now]
 * @param {(msg: string) => void} [opts.log]
 */
export function createApp({
  transporter,
  supportTo,
  fromEmail,
  supportDailyCap = 100,
  confirmDailyCap = 50,
  perIpLimit = 5,
  perIpWindowMs = 15 * 60 * 1000,
  now = Date.now,
  log = (msg) => console.error(msg),
}) {
  const supportCap = new DailyCounter(supportDailyCap, now);
  const confirmCap = new DailyCounter(confirmDailyCap, now);
  const lastConfirm = new Map(); // lowercased recipient -> time of last confirmation

  function mayConfirm(email) {
    const key = recipientKey(email);
    const t = now();
    if (lastConfirm.size > 5000) {
      for (const [k, at] of lastConfirm) if (t - at >= DAY_MS) lastConfirm.delete(k);
    }
    const prev = lastConfirm.get(key);
    if (prev !== undefined && t - prev < DAY_MS) return false;
    if (!confirmCap.take()) return false;
    lastConfirm.set(key, t);
    return true;
  }

  const app = express();
  app.disable('x-powered-by');
  // One trusted hop: the site nginx, which sets X-Forwarded-For to the real client only.
  app.set('trust proxy', 1);
  app.use(helmet());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const limiter = rateLimit({
    windowMs: perIpWindowMs,
    limit: perIpLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Only requests that got as far as sending count, so a few typos don't lock a visitor out.
    // Rejected requests send nothing and are still capped by nginx's limit_req.
    skipFailedRequests: true,
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited' }),
  });

  app.post('/support', limiter, express.json({ limit: '32kb' }), async (req, res) => {
    const { value, error } = validate(req.body);
    if (error) return res.status(400).json({ error });
    if (value.honeypot) return res.json({ ok: true }); // pretend success, send nothing

    if (!supportCap.take()) {
      log('support_daily_cap_reached');
      return res.status(503).json({ error: 'busy' });
    }

    const { name, email, phone, message, service, urgency } = value;
    try {
      await transporter.sendMail({
        from: { name: BUSINESS_NAME, address: fromEmail },
        to: supportTo,
        replyTo: { name, address: email },
        subject: `[Support Request] ${service} (${urgency}) - ${name}`,
        text: [
          'New support request',
          '',
          `Name: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone || '(not provided)'}`,
          `Service: ${service}`,
          `Urgency: ${urgency}`,
          '',
          'Message:',
          message,
          '',
          'Meta:',
          `IP: ${req.ip || 'unknown'}`,
          `Time: ${new Date(now()).toISOString()}`,
          '',
        ].join('\n'),
      });
    } catch (err) {
      log(`support_send_error ${err?.code || err?.name || 'unknown'}`);
      return res.status(502).json({ error: 'send_failed' });
    }

    // The request reached the inbox. The confirmation is best effort and never echoes input.
    if (mayConfirm(email)) {
      try {
        await transporter.sendMail({
          from: { name: BUSINESS_NAME, address: fromEmail },
          to: { address: email },
          replyTo: supportTo,
          subject: `We received your request - ${BUSINESS_NAME}`,
          text:
            `Hello,\n\n` +
            `Thanks for contacting ${BUSINESS_NAME}. We received your support request ` +
            `and will get back to you as soon as possible.\n\n` +
            `If you did not send this request, you can ignore this email.\n\n` +
            `- ${BUSINESS_NAME}\n`,
        });
      } catch (err) {
        log(`confirm_send_error ${err?.code || err?.name || 'unknown'}`);
      }
    }

    return res.json({ ok: true });
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // JSON errors only: never Express's HTML page or a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log(`unhandled_error ${err?.name || 'unknown'}`);
    res.status(status).json({ error: status === 413 ? 'too_large' : status === 500 ? 'server_error' : 'bad_request' });
  });

  return app;
}
