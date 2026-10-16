import { z } from 'zod';
import type { InvoiceRequest } from './invoice-request';
import type { AirwallexSession } from './mcp';
import { TOOL } from './tool-policy';

/**
 * The model creates the invoice, but Till's own code checks the result against what the admin
 * approved, reading it straight back from Airwallex. A mismatch is voided, never left in place.
 */

const AMOUNT_TOLERANCE = 0.005;
const FINALIZED = 'FINALIZED';
const COMPANY_SUFFIXES = /\b(ltd|limited|inc|incorporated|llc|co|corp|corporation|gmbh|pte|plc)\b\.?/g;

const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().optional(),
  status: z.string(),
  currency: z.string(),
  total_amount: z.number(),
  billing_customer_id: z.string(),
  hosted_url: z.string().optional(),
});

const customerSchema = z.object({ name: z.string() });

export interface CreatedInvoice {
  status: string;
  currency: string;
  totalAmount: number;
  customerName: string;
}

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Lists every way the created invoice differs from the approved request. Empty means it matches. */
export function findMismatches(approved: InvoiceRequest, created: CreatedInvoice): string[] {
  const problems: string[] = [];
  if (created.status !== FINALIZED) problems.push(`status is ${created.status}, not finalized`);
  if (created.currency !== approved.currency) problems.push(`currency is ${created.currency}, approved ${approved.currency}`);
  if (Math.abs(created.totalAmount - approved.amount) > AMOUNT_TOLERANCE) {
    problems.push(`total is ${created.totalAmount}, approved ${approved.amount}`);
  }
  const want = normalizeName(approved.customer);
  const got = normalizeName(created.customerName);
  if (!want || !got || !(got.includes(want) || want.includes(got))) {
    problems.push(`client is ${created.customerName}, approved ${approved.customer}`);
  }
  return problems;
}

export type CheckResult = { ok: true; number: string; url: string } | { ok: false; problem: string };

/** Reads the invoice back from Airwallex, compares it with the approval, and voids it on any mismatch. */
export async function checkCreatedInvoice(airwallex: AirwallexSession, invoiceId: string, approved: InvoiceRequest): Promise<CheckResult> {
  const invoice = invoiceSchema.parse(await airwallex.call(TOOL.getInvoice, { invoice_id: invoiceId }));
  const customer = customerSchema.parse(await airwallex.call(TOOL.getCustomer, { customer_id: invoice.billing_customer_id }));
  const problems = findMismatches(approved, {
    status: invoice.status,
    currency: invoice.currency,
    totalAmount: invoice.total_amount,
    customerName: customer.name,
  });
  if (problems.length === 0) return { ok: true, number: invoice.number ?? invoice.id, url: invoice.hosted_url ?? '' };
  if (invoice.status === FINALIZED) await airwallex.call(TOOL.voidInvoice, { invoice_id: invoice.id });
  return { ok: false, problem: `The invoice didn't match what was approved (${problems.join('; ')}), so I voided it.` };
}
