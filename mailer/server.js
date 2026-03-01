import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const {
  PORT = "3000",
  SUPPORT_TO,
  FROM_EMAIL,
  SMTP_USER,
  SMTP_PASS
} = process.env;

function required(name, val) {
  if (!val || String(val).trim() === "") throw new Error(`Missing env var: ${name}`);
  return String(val).trim();
}

required("SUPPORT_TO", SUPPORT_TO);
required("FROM_EMAIL", FROM_EMAIL);
required("SMTP_USER", SMTP_USER);
required("SMTP_PASS", SMTP_PASS);

const app = express();

// Basic hardening
app.disable("x-powered-by");
app.use(helmet());

// JSON only
app.use(express.json({ limit: "50kb" }));

// Basic rate limit (tune later)
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

// Support request endpoint
app.post("/api/support", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim();
    const phone = String(req.body?.phone ?? "").trim();
    const message = String(req.body?.message ?? "").trim();

    // Minimal validation
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Invalid name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return res.status(400).json({ error: "Invalid email" });
    if (phone.length > 40) return res.status(400).json({ error: "Invalid phone" });
    if (message.length < 10 || message.length > 4000) return res.status(400).json({ error: "Invalid message" });

    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()) ||
      req.socket.remoteAddress ||
      "unknown";

    // Nodemailer via Google Workspace SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // STARTTLS
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    const subject = `[Support Request] ${name}`;

    const text =
`New support request

Name: ${name}
Email: ${email}
Phone: ${phone || "(not provided)"}

Message:
${message}

Meta:
IP: ${ip}
Time: ${new Date().toISOString()}
`;

    // Important deliverability notes:
    // - FROM should be your domain mailbox (FROM_EMAIL)
    // - REPLY-TO should be the customer email
    await transporter.sendMail({
      from: `"Dark Matter IT Solutions" <${FROM_EMAIL}>`,
      to: SUPPORT_TO,
      replyTo: email,
      subject,
      text
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("support_send_error:", err);
    return res.status(500).json({ error: "Send failed" });
  }
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`darkmatter-mailer listening on :${PORT}`);
});
