import { z } from 'zod';
import { SLACK_USER_ID } from '../slack/user-id';

/**
 * An invoice request and its pending approval. Till keeps no database: a pending invoice travels
 * inside the Slack approval buttons and the signed Airwallex login link. It is always re-validated
 * when it comes back.
 */

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_INVOICE_AMOUNT = 1_000_000;
const MAX_DAYS_UNTIL_DUE = 120;
const CURRENCY_CODE = /^[A-Z]{3}$/;

export const invoiceRequestSchema = z.object({
  customer: z.string().min(1).max(MAX_NAME_LENGTH).describe('Client name as the person wrote it'),
  description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH).describe('Line item description'),
  amount: z.number().positive().max(MAX_INVOICE_AMOUNT).describe('Amount in major units, e.g. 4800'),
  currency: z.string().regex(CURRENCY_CODE).describe('ISO 4217 code, e.g. USD'),
  daysUntilDue: z.number().int().min(0).max(MAX_DAYS_UNTIL_DUE).describe('Payment terms in days, e.g. 14 for net 14'),
  requestedBy: z.string().min(1).max(MAX_NAME_LENGTH).describe('Name of the person who first asked for this invoice in the thread'),
});

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

const MAX_ID_LENGTH = 80;

export const pendingInvoiceSchema = z.object({
  request: invoiceRequestSchema,
  /** The Airwallex client Till resolved before asking the admin. The card shows this name. */
  client: z.object({ id: z.string().min(1).max(MAX_ID_LENGTH), name: z.string().min(1).max(MAX_NAME_LENGTH) }),
  threadId: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),
  adminId: z.string().regex(SLACK_USER_ID),
  adminName: z.string().min(1).max(MAX_NAME_LENGTH),
});

/** An invoice waiting for its admin: what to create, where, and who may approve it. */
export type PendingInvoice = z.infer<typeof pendingInvoiceSchema>;

/** Validates untrusted data as a pending invoice. Returns null when anything is off. */
export function parsePending(value: unknown): PendingInvoice | null {
  const parsed = pendingInvoiceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** For Slack button values. Slack returns them exactly as Till posted them. */
export function encodePending(pending: PendingInvoice): string {
  return Buffer.from(JSON.stringify(pending)).toString('base64url');
}

export function decodePending(encoded: string): PendingInvoice | null {
  try {
    return parsePending(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

export function formatAmount({ amount, currency }: Pick<InvoiceRequest, 'amount' | 'currency'>): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type Decision = { ok: true } | { ok: false; reason: 'invalid' | 'wrong-thread' | 'not-approver' };

/** Only the admin named on the card, in the card's own thread, may approve or cancel it. */
export function checkDecision(pending: PendingInvoice | null, clicker: string, threadId: string): Decision {
  if (!pending) return { ok: false, reason: 'invalid' };
  if (pending.threadId !== threadId) return { ok: false, reason: 'wrong-thread' };
  if (pending.adminId !== clicker) return { ok: false, reason: 'not-approver' };
  return { ok: true };
}
