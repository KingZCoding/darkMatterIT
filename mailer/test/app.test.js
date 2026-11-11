// Run with: npm test   (node's built-in test runner, no network, no SMTP)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validate, recipientKey } from '../app.js';

function fakeTransport({ failConfirm = false, failSupport = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(msg) {
      const isConfirm = typeof msg.to === 'object';
      if ((isConfirm && failConfirm) || (!isConfirm && failSupport)) throw Object.assign(new Error('x'), { code: 'EAUTH' });
      sent.push(msg);
      return {};
    },
  };
}

async function start(opts = {}) {
  const transporter = opts.transporter || fakeTransport();
  const logs = [];
  const app = createApp({
    transporter,
    supportTo: 'support@example.test',
    fromEmail: 'noreply@example.test',
    log: (m) => logs.push(m),
    ...opts,
  });
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(`${base}/support`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { base, post, transporter, logs, close: () => new Promise((r) => server.close(r)) };
}

const good = (over = {}) => ({
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'My laptop will not boot after an update.',
  service: 'Hardware Support',
  urgency: 'Today',
  ...over,
});

test('valid request sends the support email and a fixed confirmation', async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await s.post(good({ name: 'Click https://evil.example now', message: 'Verify your account at https://evil.example/login now' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(s.transporter.sent.length, 2);
  const [support, confirm] = s.transporter.sent;
  assert.equal(support.to, 'support@example.test');
  assert.match(support.text, /Verify your account/);
  assert.deepEqual(confirm.to, { address: 'jane@example.com' });
  // Nothing the visitor typed may appear in the confirmation.
  assert.doesNotMatch(confirm.text + confirm.subject, /evil|Click|Verify/);
});

test('rate limit applies to /support per client', async (t) => {
  const s = await start({ perIpLimit: 3 });
  t.after(s.close);
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await s.post(good({ email: `a${i}@example.com` }))).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

test('clients are keyed on X-Forwarded-For set by the site nginx', async (t) => {
  const s = await start({ perIpLimit: 1 });
  t.after(s.close);
  assert.equal((await s.post(good(), { 'x-forwarded-for': '198.51.100.1' })).status, 200);
  assert.equal((await s.post(good(), { 'x-forwarded-for': '198.51.100.1' })).status, 429);
  assert.equal((await s.post(good(), { 'x-forwarded-for': '198.51.100.2' })).status, 200);
});

test('one confirmation per recipient per day', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.post(good());
  await s.post(good({ email: 'JANE@example.com' }));
  const confirms = s.transporter.sent.filter((m) => typeof m.to === 'object');
  assert.equal(confirms.length, 1);
  assert.equal(s.transporter.sent.length, 3);
});

test('confirmation daily cap and support daily cap', async (t) => {
  const s = await start({ confirmDailyCap: 1, supportDailyCap: 2, perIpLimit: 100 });
  t.after(s.close);
  assert.equal((await s.post(good({ email: 'a@example.com' }))).status, 200);
  assert.equal((await s.post(good({ email: 'b@example.com' }))).status, 200);
  const r3 = await s.post(good({ email: 'c@example.com' }));
  assert.equal(r3.status, 503);
  const confirms = s.transporter.sent.filter((m) => typeof m.to === 'object');
  assert.equal(confirms.length, 1);
});

test('honeypot gets a fake success and sends nothing', async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await s.post(good({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.equal(s.transporter.sent.length, 0);
});

test('confirmation failure still returns 200 and logs no address', async (t) => {
  const s = await start({ transporter: fakeTransport({ failConfirm: true }) });
  t.after(s.close);
  const res = await s.post(good());
  assert.equal(res.status, 200);
  assert.equal(s.transporter.sent.length, 1);
  assert.deepEqual(s.logs, ['confirm_send_error EAUTH']);
});

test('support send failure returns 502 JSON', async (t) => {
  const s = await start({ transporter: fakeTransport({ failSupport: true }) });
  t.after(s.close);
  const res = await s.post(good());
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'send_failed' });
});

test('malformed JSON and unknown routes return JSON without a stack trace', async (t) => {
  const s = await start();
  t.after(s.close);
  const bad = await s.post('{');
  assert.equal(bad.status, 400);
  const text = await bad.text();
  assert.doesNotMatch(text, /node_modules|at .*\.js/);
  assert.deepEqual(JSON.parse(text), { error: 'bad_request' });
  const nf = await fetch(`${s.base}/nope`);
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { error: 'not_found' });
});

test('validation rejects injection and type tricks', () => {
  const bad = [
    { email: 'a@b.c,postmaster' },
    { email: 'a@b.c;x@y.z' },
    { email: 'Support<victim@x.com>' },
    { email: '"Billing"<a@evil.com>' },
    { email: 'a@b' },
    { name: 'Jane\r\nBcc: x@y.z' },
    { name: 'J' },
    { name: {} },
    { message: ['a', 'b'] },
    { message: 'short' },
    { message: 'x'.repeat(4001) },
    { phone: 'x'.repeat(41) },
  ];
  for (const over of bad) assert.ok(validate(good(over)).error, JSON.stringify(over));
});

test('validation counts characters, not UTF-16 units, and normalises choices', () => {
  assert.ok(validate(good({ name: '李明' })).value);
  const v = validate(good({ service: 'Hack', urgency: 'NOW' })).value;
  assert.equal(v.service, 'Other');
  assert.equal(v.urgency, 'Normal');
});

test('invalid requests do not use up the per-client limit', async (t) => {
  const s = await start({ perIpLimit: 2 });
  t.after(s.close);
  for (let i = 0; i < 5; i++) assert.equal((await s.post(good({ email: 'not-an-email' }))).status, 400);
  assert.equal((await s.post(good({ email: 'a@example.com' }))).status, 200);
  assert.equal((await s.post(good({ email: 'b@example.com' }))).status, 200);
  assert.equal((await s.post(good({ email: 'c@example.com' }))).status, 429);
});

test('Gmail dot and plus variants share one confirmation', async (t) => {
  assert.equal(recipientKey('J.a.n.e+promo@GoogleMail.com'), 'jane@gmail.com');
  assert.equal(recipientKey('j.ane+x@example.com'), 'j.ane@example.com');
  const s = await start({ perIpLimit: 100 });
  t.after(s.close);
  await s.post(good({ email: 'jane@gmail.com' }));
  await s.post(good({ email: 'j.a.n.e+1@gmail.com' }));
  await s.post(good({ email: 'jane+2@googlemail.com' }));
  assert.equal(s.transporter.sent.filter((m) => typeof m.to === 'object').length, 1);
});
