/**
 * What Till may do in Airwallex: the permissions (scopes) each login asks for, and the tools
 * the model may see. Airwallex grants nothing unless scopes are requested, and only offers tools
 * that the granted scopes allow; this file narrows that further.
 */

const VIEW_SCOPES = [
  'r:awx_action:balances_view',
  'r:awx_action:conversions_view',
  'r:org_action:billing.customer_view',
  'r:org_action:billing.invoice_view',
  'r:org_action:billing.price_view',
  'r:org_action:billing.product_view',
] as const;

const EDIT_SCOPES = [
  'w:org_action:billing.customer_edit',
  'w:org_action:billing.invoice_edit',
  'w:org_action:billing.price_edit',
  'w:org_action:billing.product_edit',
] as const;

/** Request exactly these lists every time: Vercel Connect matches a saved login by its scopes. */
export const SCOPES = {
  questions: [...VIEW_SCOPES],
  creating: [...VIEW_SCOPES, ...EDIT_SCOPES],
} as const;

/** Airwallex MCP tool names Till uses by name. */
export const TOOL = {
  listCustomers: 'list_billing_customers',
  getCustomer: 'retrieve_billing_customer',
  createProduct: 'create_billing_product',
  createInvoice: 'create_billing_invoice',
  addLineItems: 'add_billing_invoice_line_items',
  finalizeInvoice: 'finalize_billing_invoice',
  getInvoice: 'retrieve_billing_invoice',
  voidInvoice: 'void_billing_invoice',
} as const;

/** The only tools the model sees when creating an invoice. Anything new Airwallex adds stays out. */
export const CREATE_TOOLS_FOR_MODEL: readonly string[] = [
  TOOL.listCustomers,
  TOOL.getCustomer,
  TOOL.createProduct,
  TOOL.createInvoice,
  TOOL.addLineItems,
  TOOL.finalizeInvoice,
  TOOL.getInvoice,
];

/** Tools only Till's own code calls, to check the result and undo a mismatch. */
export const CREATE_TOOLS_FOR_CODE: readonly string[] = [TOOL.getInvoice, TOOL.getCustomer, TOOL.voidInvoice];

/** Safety net: never expose anything that moves money or simulates, whatever a login allows. */
const MONEY_MOVEMENT = /transfer|payout|conversion_create|create_conversion|simulate/i;

export type Access = 'view' | 'create';

interface ToolInfo {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * Which tools to load for a login.
 * view: only tools Airwallex marks read-only. create: only the invoicing allow-list.
 */
export function allowedTools<T extends ToolInfo>(tools: readonly T[], access: Access): T[] {
  const allowList = new Set([...CREATE_TOOLS_FOR_MODEL, ...CREATE_TOOLS_FOR_CODE]);
  return tools.filter((tool) => {
    if (MONEY_MOVEMENT.test(tool.name)) return false;
    return access === 'view' ? tool.annotations?.readOnlyHint === true : allowList.has(tool.name);
  });
}
