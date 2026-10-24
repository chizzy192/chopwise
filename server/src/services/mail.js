// Outgoing email (password reset links, CLAUDE.md item 18). SMTP settings come from .env. Without
// SMTP_HOST (development) nothing is sent: the link is printed to the server console instead.
import nodemailer from 'nodemailer';

let transport = null;

export const smtpConfigured = () => Boolean(process.env.SMTP_HOST?.trim());

function smtp() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port,
      secure: port === 465, // 465 is TLS from the start; 587 upgrades with STARTTLS
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

export async function sendPasswordResetEmail(to, link, minutes) {
  if (!smtpConfigured()) {
    console.log(`[mail] SMTP is not configured. Password reset link for ${to}: ${link}`);
    return;
  }
  await smtp().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your ChopWise password',
    text: [
      'Someone asked to reset the password for your ChopWise account.',
      '',
      `To choose a new password, open this link within ${minutes} minutes:`,
      link,
      '',
      'The link works once. If you didn\'t ask for this, you can ignore this email; your password stays the same.',
    ].join('\n'),
  });
}
