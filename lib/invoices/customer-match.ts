import { z } from 'zod';
import type { AirwallexSession } from '../airwallex/session';
import { TOOL } from '../airwallex/tool-policy';

/**
 * Picks the one Airwallex billing customer an approved invoice is for, in code, before the model runs.
 * The invoice is then checked against this customer's id, so a similar name can never slip through.
 */

const CUSTOMERS_PER_PAGE = 100;
const COMPANY_SUFFIXES = /\b(ltd|limited|inc|incorporated|llc|co|corp|corporation|gmbh|pte|plc)\b\.?/g;

// Airwallex allows clients without a name; those can never match a request, so they are skipped.
const customerListSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string().optional() })),
});

export interface Customer {
  id: string;
  name: string;
}

export type CustomerMatch = { ok: true; customer: Customer } | { ok: false; problem: string };

/** Lowercase, without punctuation or a trailing company type, so "Northwind Trading Ltd." equals "northwind trading". */
export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * An exact name match wins. Otherwise the name may be the start of exactly one customer's name
 * ("Parkside Dental" for "Parkside Dental Group"). Anything else is refused rather than guessed.
 */
export function pickCustomer(customers: readonly Customer[], requested: string): CustomerMatch {
  const wanted = normalizeName(requested);
  if (!wanted) return { ok: false, problem: 'The request has no client name.' };
  const exact = customers.filter((customer) => normalizeName(customer.name) === wanted);
  const candidates = exact.length > 0 ? exact : customers.filter((customer) => normalizeName(customer.name).startsWith(`${wanted} `));
  if (candidates.length === 1) return { ok: true, customer: candidates[0] };
  if (candidates.length === 0) return { ok: false, problem: `There is no client named ${requested} in Airwallex.` };
  const names = candidates.map((customer) => customer.name).join(', ');
  return { ok: false, problem: `More than one client matches ${requested} (${names}). Ask again with the full name.` };
}

/** Looks the requested client up in Airwallex. */
export async function findCustomer(airwallex: AirwallexSession, requested: string): Promise<CustomerMatch> {
  const { items } = customerListSchema.parse(await airwallex.call(TOOL.listCustomers, { page_size: CUSTOMERS_PER_PAGE }));
  const named = items.flatMap(({ id, name }) => (name ? [{ id, name }] : []));
  return pickCustomer(named, requested);
}
