import { describe, expect, it, vi } from 'vitest';
import { checkCreatedInvoice, findMismatches } from '../lib/invoice-check';
import type { InvoiceRequest } from '../lib/invoice-request';
import type { AirwallexSession } from '../lib/mcp';
import { TOOL } from '../lib/tool-policy';

const approved: InvoiceRequest = {
  customer: 'Parkside Dental',
  description: 'Website redesign',
  amount: 3950,
  currency: 'USD',
  daysUntilDue: 30,
  requestedBy: 'Sam Rivera',
};

const matching = { status: 'FINALIZED', currency: 'USD', totalAmount: 3950, customerName: 'Parkside Dental Group' };

describe('checking a created invoice against the approval', () => {
  it('passes when everything matches, allowing a longer legal name', () => {
    expect(findMismatches(approved, matching)).toEqual([]);
    expect(findMismatches({ ...approved, customer: 'Northwind Trading' }, { ...matching, customerName: 'Northwind Trading Ltd.' })).toEqual(
      [],
    );
  });

  it('flags a draft, a different currency, amount or client', () => {
    const problems = findMismatches(approved, { status: 'DRAFT', currency: 'EUR', totalAmount: 39500, customerName: 'Ashby & Rowe' });
    expect(problems).toHaveLength(4);
  });

  it('ignores rounding below half a cent', () => {
    expect(findMismatches(approved, { ...matching, totalAmount: 3950.004 })).toEqual([]);
    expect(findMismatches(approved, { ...matching, totalAmount: 3950.01 })).toHaveLength(1);
  });

  it('never matches a client name that is only a company suffix', () => {
    expect(findMismatches({ ...approved, customer: 'Ltd.' }, matching)).toHaveLength(1);
  });
});

function fakeAirwallex(invoice: Record<string, unknown>, customer = { name: 'Parkside Dental Group' }) {
  const call = vi.fn(async (toolName: string) => {
    if (toolName === TOOL.getInvoice) return invoice;
    if (toolName === TOOL.getCustomer) return customer;
    if (toolName === TOOL.voidInvoice) return { ...invoice, status: 'VOIDED' };
    throw new Error(`unexpected tool ${toolName}`);
  });
  const session: AirwallexSession = { tools: {}, call, close: async () => {} };
  return { session, call };
}

const invoice = {
  id: 'inv_123',
  number: 'INV-0042',
  status: 'FINALIZED',
  currency: 'USD',
  total_amount: 3950,
  billing_customer_id: 'cus_123',
  hosted_url: 'https://example.com/inv_123',
};

describe('reading the invoice back from Airwallex', () => {
  it('returns the number and link when it matches', async () => {
    const { session, call } = fakeAirwallex(invoice);
    await expect(checkCreatedInvoice(session, 'inv_123', approved)).resolves.toEqual({
      ok: true,
      number: 'INV-0042',
      url: 'https://example.com/inv_123',
    });
    expect(call).not.toHaveBeenCalledWith(TOOL.voidInvoice, expect.anything());
  });

  it('asks Airwallex with the argument names its tools expect', async () => {
    const { session, call } = fakeAirwallex(invoice);
    await checkCreatedInvoice(session, 'inv_123', approved);
    expect(call).toHaveBeenCalledWith(TOOL.getInvoice, { invoice_id: 'inv_123' });
    expect(call).toHaveBeenCalledWith(TOOL.getCustomer, { customer_id: 'cus_123' });
  });

  it('voids a finalized invoice that does not match', async () => {
    const { session, call } = fakeAirwallex({ ...invoice, total_amount: 9999 });
    const result = await checkCreatedInvoice(session, 'inv_123', approved);
    expect(result.ok).toBe(false);
    expect(call).toHaveBeenCalledWith(TOOL.voidInvoice, { invoice_id: 'inv_123' });
  });

  it('reports a draft without trying to void it', async () => {
    const { session, call } = fakeAirwallex({ ...invoice, status: 'DRAFT' });
    expect((await checkCreatedInvoice(session, 'inv_123', approved)).ok).toBe(false);
    expect(call).not.toHaveBeenCalledWith(TOOL.voidInvoice, expect.anything());
  });

  it('falls back to the id when the invoice has no number', async () => {
    const { number: _number, hosted_url: _url, ...bare } = invoice;
    const { session } = fakeAirwallex(bare);
    await expect(checkCreatedInvoice(session, 'inv_123', approved)).resolves.toEqual({ ok: true, number: 'inv_123', url: '' });
  });
});
