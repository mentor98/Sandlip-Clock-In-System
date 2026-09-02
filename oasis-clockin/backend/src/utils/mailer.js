const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

/**
 * Send an email alert to the configured admin or recipient.
 */
async function sendAlertEmail({ subject, html, text }) {
  const mailer = getTransporter();
  const recipient = process.env.ALERT_EMAIL_TO || process.env.SMTP_USER;

  if (!mailer || !recipient) {
    console.log('ℹ️ [Mailer] SMTP not fully configured or ALERT_EMAIL_TO missing. Skipping email dispatch.');
    return false;
  }

  try {
    const info = await mailer.sendMail({
      from: `"Sandlip ClockIn Alert" <${process.env.SMTP_USER}>`,
      to: recipient,
      subject: `[Oasis ClockIn] ${subject}`,
      text: text || '',
      html: html || `<p>${text || subject}</p>`,
    });
    console.log(`📧 [Mailer] Alert sent to ${recipient}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ [Mailer] Failed to send email alert:', error.message);
    return false;
  }
}

module.exports = {
  getTransporter,
  sendAlertEmail,
};
