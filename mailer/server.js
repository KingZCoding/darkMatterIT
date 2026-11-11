// Entry point: read settings from the environment (mailer/.env on the Pi), connect SMTP, listen.
// Required: SUPPORT_TO, FROM_EMAIL, SMTP_USER, SMTP_PASS
// Optional: PORT (3000), SMTP_HOST (smtp.gmail.com), SMTP_PORT (587),
//           SUPPORT_DAILY_CAP (100), CONFIRM_DAILY_CAP (50)
import nodemailer from 'nodemailer';
import { createApp } from './app.js';

const env = process.env;

function required(name) {
  const v = String(env[name] ?? '').trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid env var: ${name}`);
  return n;
}

const smtpPort = int('SMTP_PORT', 587);
const transporter = nodemailer.createTransport({
  host: String(env.SMTP_HOST || 'smtp.gmail.com').trim(),
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort !== 465, // refuse to send the password if STARTTLS is stripped
  auth: { user: required('SMTP_USER'), pass: required('SMTP_PASS') },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

const app = createApp({
  transporter,
  supportTo: required('SUPPORT_TO'),
  fromEmail: required('FROM_EMAIL'),
  supportDailyCap: int('SUPPORT_DAILY_CAP', 100),
  confirmDailyCap: int('CONFIRM_DAILY_CAP', 50),
});

const port = int('PORT', 3000);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`darkmatter-mailer listening on :${port}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
