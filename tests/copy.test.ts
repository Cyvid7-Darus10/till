import { describe, expect, it } from 'vitest';
import { COPY } from '../lib/copy';

describe("Till's messages", () => {
  it('name the admins it asked, or the team when there are none to mention', () => {
    expect(COPY.handOff('<@UADMIN0001>')).toContain("I've asked <@UADMIN0001>.");
    expect(COPY.handOff('')).toContain("I've asked the finance team.");
  });

  it('link the invoice only when Airwallex returned a link', () => {
    expect(COPY.created('INV-1', 'Parkside', 'https://example.com/i')).toContain('<https://example.com/i|Open invoice>');
    expect(COPY.created('INV-1', 'Parkside', '')).toBe('Created invoice INV-1 for Parkside.');
  });

  it('say who asked and whose login creates the invoice', () => {
    expect(COPY.card.requestedBy('Sam', 'Alex')).toBe("Requested by Sam. This will be created with Alex's Airwallex login.");
  });

  it('fill in names, terms and the footer', () => {
    expect(COPY.onlyApprover('Alex')).toBe('Only Alex can approve this.');
    expect(COPY.approved('Alex')).toBe('Approved by Alex.');
    expect(COPY.notCreated('No such client.')).toBe("I didn't create the invoice. No such client.");
    expect(COPY.card.title('Parkside')).toBe('Invoice Parkside');
    expect(COPY.card.termsValue(14)).toBe('Net 14');
    expect(COPY.footer('team login')).toBe('Airwallex: team login');
  });
});
