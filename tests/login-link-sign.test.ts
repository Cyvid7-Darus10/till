import { describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/kms', () => ({ signJWT: vi.fn(async () => ({ token: 'signed.jwt.token' })) }));

const { signJWT } = await import('@vercel/kms');
const { LOGIN_LINK_AUDIENCE, signLoginLink } = await import('../lib/login-link');
const { config } = await import('../lib/config');

describe('signing a login link', () => {
  it('asks Vercel KMS for a short-lived token for this purpose only', async () => {
    const pending = {
      request: { customer: 'A', description: 'B', amount: 1, currency: 'USD', daysUntilDue: 0, requestedBy: 'Sam' },
      threadId: 'slack:C0FINANCE1:1',
      adminId: 'UADMIN0001',
      adminName: 'Alex',
    };
    await expect(signLoginLink(pending)).resolves.toBe('signed.jwt.token');
    expect(signJWT).toHaveBeenCalledWith({
      issuerId: config.kmsIssuerId,
      claims: { aud: LOGIN_LINK_AUDIENCE, pending },
      ttl: config.loginLinkTtlSeconds,
    });
  });
});
