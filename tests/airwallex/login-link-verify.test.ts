import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOGIN_LINK_AUDIENCE, verifyLoginLink } from '../../lib/airwallex/login-link';
import type { PendingInvoice } from '../../lib/invoices/request';

// Stands in for Vercel KMS: a local key pair, verified the same way as the real JWKS.
const pending: PendingInvoice = {
  request: {
    customer: 'Parkside Dental Group',
    description: 'Website redesign',
    amount: 3950,
    currency: 'USD',
    daysUntilDue: 30,
    requestedBy: 'Sam Rivera',
  },
  client: { id: 'cus_123', name: 'Parkside Dental Group' },
  threadId: 'slack:C0FINANCE1:1792068287.429589',
  adminId: 'UADMIN0001',
  adminName: 'Alex Admin',
};

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let kms: KeyPair;
let attacker: KeyPair;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  kms = await generateKeyPair('ES256');
  attacker = await generateKeyPair('ES256');
  keys = async () => kms.publicKey;
});

const sign = (privateKey: CryptoKey, claims: Record<string, unknown>, expiresIn = '15m') =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey);

describe('Airwallex login links', () => {
  it('carry the pending invoice when signed by the issuer', async () => {
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, pending });
    expect(await verifyLoginLink(token, keys)).toEqual(pending);
  });

  it('are rejected when signed by anyone else', async () => {
    const token = await sign(attacker.privateKey, { aud: LOGIN_LINK_AUDIENCE, pending });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected once expired', async () => {
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, pending }, '-1m');
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when minted for another purpose', async () => {
    const token = await sign(kms.privateKey, { aud: 'something-else', pending });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when the invoice inside breaks the schema', async () => {
    const tampered = { ...pending, request: { ...pending.request, amount: -5 } };
    const token = await sign(kms.privateKey, { aud: LOGIN_LINK_AUDIENCE, pending: tampered });
    expect(await verifyLoginLink(token, keys)).toBeNull();
  });

  it('are rejected when empty or garbage', async () => {
    expect(await verifyLoginLink('', keys)).toBeNull();
    expect(await verifyLoginLink('not.a.jwt', keys)).toBeNull();
  });
});
