import { signJWT } from '@vercel/kms';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { config } from '../config';
import { type PendingInvoice, parsePending } from '../invoices/request';

/**
 * After an admin signs in to Airwallex, the browser comes back to Till with the pending invoice.
 * That link is signed by Vercel KMS (the key never leaves Vercel, no secret in the project) and
 * expires, so nobody can forge or replay an old one to post approval cards.
 */

/** Marks a token as a Till login link, so a token Vercel KMS signed for anything else is refused. */
export const LOGIN_LINK_AUDIENCE = 'till:airwallex-login';

const jwksUrl = (issuerId: string): URL => new URL(`https://kms.vercel.com/${issuerId}/jwks.json`);

let keySet: JWTVerifyGetKey | undefined;
const defaultKeySet = (): JWTVerifyGetKey => {
  keySet ??= createRemoteJWKSet(jwksUrl(config.kmsIssuerId));
  return keySet;
};

/** Signs a pending invoice into a short-lived token for the Airwallex login callback. */
export async function signLoginLink(pending: PendingInvoice): Promise<string> {
  const { token } = await signJWT({
    issuerId: config.kmsIssuerId,
    claims: { aud: LOGIN_LINK_AUDIENCE, pending },
    ttl: config.loginLinkTtlSeconds,
  });
  return token;
}

/** Verifies a login-link token. Returns the pending invoice, or null if forged, expired or malformed. */
export async function verifyLoginLink(token: string, keys: JWTVerifyGetKey = defaultKeySet()): Promise<PendingInvoice | null> {
  try {
    const { payload } = await jwtVerify(token, keys, { audience: LOGIN_LINK_AUDIENCE });
    return parsePending(payload.pending);
  } catch {
    return null;
  }
}
