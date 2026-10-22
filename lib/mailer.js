const nodemailer = require('nodemailer');

let tp;
const configured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
const transport = () => tp || (tp = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}));

// Never throws: a failed email must not break the action that triggered it.
async function sendMail({ to, subject, html, text }) {
  if (!configured()) { console.log('[mail] SMTP not set, skipped:', subject); return false; }
  try {
    await transport().sendMail({
      from: process.env.MAIL_FROM || `Strata PMS <${process.env.SMTP_USER}>`,
      to, subject, html, text,
    });
    return true;
  } catch (e) { console.error('[mail] failed:', e.message); return false; }
}

module.exports = { sendMail, configured };