// Outbound email via the admin-configured SMTP server (nodemailer). Messages to several people are
// sent with the recipients in BCC so they don't see each other's addresses.
import nodemailer from 'nodemailer';
import type { Settings } from '../types';

export class MailError extends Error {}

/** True when SMTP is enabled and has the minimum it needs to send (host + From address). */
export function isSmtpConfigured(settings: Settings): boolean {
  const m = settings.smtp;
  return Boolean(m && m.enabled && m.host.trim() && m.fromAddress.trim());
}

function transportFor(settings: Settings): nodemailer.Transporter {
  const m = settings.smtp;
  return nodemailer.createTransport({
    host: m.host,
    port: m.port,
    secure: m.secure,
    auth: m.username ? { user: m.username, pass: m.password } : undefined,
    connectionTimeout: 10_000, // fail fast rather than hang the request on an unreachable server
    greetingTimeout: 10_000,
  });
}

export interface MailMessage {
  to: string[]; // recipients (placed in BCC)
  subject: string;
  text: string;
}

/** Send one message to all recipients (BCC). Throws MailError if SMTP isn't configured. */
export async function sendMail(settings: Settings, msg: MailMessage): Promise<void> {
  if (!isSmtpConfigured(settings)) throw new MailError('SMTP is not configured');
  const m = settings.smtp;
  const from = m.fromName ? `"${m.fromName}" <${m.fromAddress}>` : m.fromAddress;
  await transportFor(settings).sendMail({
    from,
    to: from, // visible To is the sender; actual recipients are bcc'd for privacy
    bcc: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
}
