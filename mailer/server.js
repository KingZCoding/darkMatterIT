import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const {
  PORT = '3000',
  SUPPORT_TO,
  FROM_EMAIL,
  SMTP_USER,
  SMTP_PASS,
} = process.env;

function required(name, val) {
  if (!val || String(val).trim() === '')
    throw new Error(`Missing env var: ${name}`);
  return String(val).trim();
}

required('SUPPORT_TO', SUPPORT_TO);
required('FROM_EMAIL', FROM_EMAIL);
required('SMTP_USER', SMTP_USER);
required('SMTP_PASS', SMTP_PASS);

const app = express();

// Basic hardening
app.disable('x-powered-by');
app.use(helmet());

// JSON only
app.use(express.json({ limit: '50kb' }));

// Basic rate limit (tune later)
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/support', async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim(); // kept for compatibility
    const message = String(req.body?.message ?? '').trim();

    // Validation
    if (name.length < 2 || name.length > 120)
      return res.status(400).json({ error: 'Invalid name' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
      return res.status(400).json({ error: 'Invalid email' });
    if (phone.length > 40)
      return res.status(400).json({ error: 'Invalid phone' });
    if (message.length < 10 || message.length > 4000)
      return res.status(400).json({ error: 'Invalid message' });

    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    // 1) Email to YOU (support inbox)
    const supportSubject = `[Support Request] ${name}`;
    const supportText = `New support request

Name: ${name}
Email: ${email}
Phone: ${phone || '(not provided)'}

Message:
${message}

Meta:
IP: ${ip}
Time: ${new Date().toISOString()}
`;

    await transporter.sendMail({
      from: `"Dark Matter IT Solutions" <${FROM_EMAIL}>`,
      to: SUPPORT_TO,
      replyTo: email,
      subject: supportSubject,
      text: supportText,
    });

    // 2) Confirmation email to CUSTOMER
    const customerSubject = `We received your request — ${BUSINESS_NAME}`;
    const customerText = `Hi ${name},

Thanks for contacting ${BUSINESS_NAME}. We received your support request and will get back to you as soon as possible.

Summary of your request:
${message}

If you need to add more details, reply to this email.

— ${BUSINESS_NAME}
`;

    await transporter.sendMail({
      from: `"${BUSINESS_NAME}" <${FROM_EMAIL}>`,
      to: email,
      replyTo: SUPPORT_TO,
      subject: customerSubject,
      text: customerText,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('support_send_error:', err);
    return res.status(500).json({ error: 'Send failed' });
  }
});

// Business name used in customer confirmations
const BUSINESS_NAME = "Dark Matter IT Solutions";

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`darkmatter-mailer listening on :${PORT}`);
});
