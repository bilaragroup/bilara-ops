// Sending email for the site pages (replaces Gmail's MailApp).
// Uses the Resend HTTP API when RESEND_API_KEY and SITE_MAIL_FROM are set for the app.
// Without them nothing is sent; each attempt is logged in Notification_Log as FAILED with the
// reason, and every report is still available on its page in the app.
import {env} from 'cloudflare:workers';

export type MailResult = {ok: boolean; error?: string; id?: string};

/** Test hook: collects messages instead of sending them. */
export const mailOutbox: Array<{to: string[]; cc: string[]; subject: string; html: string}> = [];

export async function deliverEmail(message: {to: string[]; cc?: string[]; subject: string; html: string}): Promise<MailResult> {
  const e: any = env || {};
  if (e.SITE_MAIL_TEST === '1' || (globalThis as any).__SITE_MAIL_TEST__) {
    mailOutbox.push({to: message.to, cc: message.cc || [], subject: message.subject, html: message.html});
    return {ok: true, id: 'test-' + mailOutbox.length};
  }
  if (!e.RESEND_API_KEY || !e.SITE_MAIL_FROM) return {ok: false, error: 'Email sending is not set up (RESEND_API_KEY and SITE_MAIL_FROM).'};
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + e.RESEND_API_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({from: e.SITE_MAIL_FROM, to: message.to, cc: message.cc && message.cc.length ? message.cc : undefined, subject: message.subject,
        html: message.html, text: String(message.html).replace(/<[^>]+>/g, ' ')}),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return {ok: false, error: 'Email service ' + res.status + ': ' + String(body?.message || body?.name || '').slice(0, 300)};
    return {ok: true, id: String(body?.id || '')};
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
}

export function htmlEscape(value: any): string {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'} as any)[c]);
}
