import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transport =
  env.gmailUser && env.gmailAppPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: env.gmailUser, pass: env.gmailAppPassword },
      })
    : null;

interface SendMailInput {
  to: string;
  subject: string;
  text: string;
}

// Gmail credentials are optional (see config/env.ts) so login/sessions/invites can be built and
// tested before they're configured; until then this just logs the email to the server console.
export async function sendMail({ to, subject, text }: SendMailInput): Promise<void> {
  if (!transport) {
    console.warn(
      `[mailer] GMAIL_USER/GMAIL_APP_PASSWORD not set - not sending email. Would have sent:\nTo: ${to}\nSubject: ${subject}\n${text}`
    );
    return;
  }
  await transport.sendMail({ from: env.gmailUser, to, subject, text });
}
