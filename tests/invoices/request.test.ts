import { describe, expect, it } from 'vitest';
import { checkDecision, decodePending, encodePending, formatAmount, type PendingInvoice } from '../../lib/invoices/request';

const pending: PendingInvoice = {
  request: {
    customer: 'Northwind Trading',
    description: 'October retainer',
    amount: 4800,
    currency: 'USD',
    daysUntilDue: 14,
    requestedBy: 'Sam Rivera',
  },
  client: { id: 'cus_123', name: 'Parkside Dental Group' },
  threadId: 'slack:C0FINANCE1:1792068287.429589',
  adminId: 'UADMIN0001',
  adminName: 'Alex Admin',
};

describe('pending invoice in a button value', () => {
  it('survives the round trip unchanged', () => {
    expect(decodePending(encodePending(pending))).toEqual(pending);
  });

  it('is rejected when it is not valid base64 json', () => {
    expect(decodePending('not-a-payload')).toBeNull();
    expect(decodePending('')).toBeNull();
  });

  it('is rejected when a field breaks the schema', () => {
    const negative = { ...pending, request: { ...pending.request, amount: -1 } };
    const badCurrency = { ...pending, request: { ...pending.request, currency: 'usd' } };
    const badAdmin = { ...pending, adminId: '<script>' };
    for (const value of [negative, badCurrency, badAdmin]) {
      expect(decodePending(Buffer.from(JSON.stringify(value)).toString('base64url'))).toBeNull();
    }
  });
});

describe('who may approve an invoice', () => {
  it('lets the named admin decide in the same thread', () => {
    expect(checkDecision(pending, 'UADMIN0001', pending.threadId)).toEqual({ ok: true });
  });

  it('refuses anyone else, even in the same thread', () => {
    expect(checkDecision(pending, 'UMEMBER001', pending.threadId)).toEqual({ ok: false, reason: 'not-approver' });
  });

  it('refuses a card moved to another thread', () => {
    expect(checkDecision(pending, 'UADMIN0001', 'slack:C0FINANCE1:1')).toEqual({ ok: false, reason: 'wrong-thread' });
  });

  it('refuses a card whose value could not be read', () => {
    expect(checkDecision(null, 'UADMIN0001', pending.threadId)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('amounts', () => {
  it('show the currency code and two decimals', () => {
    expect(formatAmount({ amount: 4800, currency: 'USD' })).toBe('USD 4,800.00');
    expect(formatAmount({ amount: 6200.5, currency: 'EUR' })).toBe('EUR 6,200.50');
  });
});
