import { Router } from 'express';
import { readSettings } from '../services/fileStore';
import { authenticate, requireAdmin, requireTrainerOrAdmin, type AuthRequest } from '../middleware/auth';
import { MailError, isSmtpConfigured, sendMail } from '../services/mail';

const router = Router();

/** Validate, dedupe and lightly sanity-check a recipient list. */
function recipients(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((e) => String(e).trim()).filter((e) => /.+@.+/.test(e)))];
  return out.length ? out : null;
}

// POST /api/mail/send  — trainer/admin: send a message to a list of recipients (e.g. training reminders).
router.post('/send', authenticate, requireTrainerOrAdmin, async (req: AuthRequest, res) => {
  const body = req.body ?? {};
  const to = recipients(body.to);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!to) return res.status(400).json({ error: 'At least one valid recipient is required' });
  if (!subject || !text) return res.status(400).json({ error: 'subject and text are required' });

  const settings = await readSettings();
  if (!isSmtpConfigured(settings)) {
    return res.status(503).json({ error: 'Email is not configured. Set up the SMTP server in Settings.' });
  }
  try {
    await sendMail(settings, { to, subject, text });
    return res.json({ sent: to.length });
  } catch (err) {
    if (err instanceof MailError) return res.status(503).json({ error: err.message });
    console.error('Mail send error:', err);
    return res.status(502).json({ error: 'The email could not be sent. Check the SMTP settings.' });
  }
});

// POST /api/mail/test  — admin: send a test message to the caller to verify the SMTP configuration.
router.post('/test', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const settings = await readSettings();
  if (!isSmtpConfigured(settings)) {
    return res.status(503).json({ error: 'Email is not configured. Set up the SMTP server in Settings.' });
  }
  const me = req.user?.email;
  if (!me) return res.status(400).json({ error: 'Your account has no email address' });
  try {
    await sendMail(settings, {
      to: [me],
      subject: 'BrainGain SMTP test',
      text: 'This is a test email from BrainGain. If you received it, outbound email is configured correctly.',
    });
    return res.json({ sent: 1, to: me });
  } catch (err) {
    if (err instanceof MailError) return res.status(503).json({ error: err.message });
    console.error('Mail test error:', err);
    return res.status(502).json({ error: 'The test email could not be sent. Check the SMTP settings.' });
  }
});

export default router;
