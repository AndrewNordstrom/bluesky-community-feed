import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver, MemoryCache } from '@atproto/identity';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const didResolver = new DidResolver({
  timeout: 3000,
  didCache: new MemoryCache(),
});

const allowedIssuerPrefixes = config.FEED_JWT_ALLOWED_ISSUER_PREFIXES
  .split(',')
  .map((prefix) => prefix.trim())
  .filter((prefix) => prefix.length > 0);

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isDid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('did:');
}

function isAllowedIssuerDid(issuerDid: string): boolean {
  if (allowedIssuerPrefixes.length === 0) {
    return true;
  }

  return allowedIssuerPrefixes.some((prefix) => issuerDid.startsWith(prefix));
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function validateIat(payload: Record<string, unknown>): boolean {
  const iat = payload.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return true;
  }

  const maxAllowedIat = Math.floor(Date.now() / 1000) + config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS;
  return iat <= maxAllowedIat;
}

async function resolveIssuerSigningKey(issuerDid: string, forceRefresh: boolean): Promise<string> {
  if (!isDid(issuerDid) || !isAllowedIssuerDid(issuerDid)) {
    throw new Error('Issuer DID is not allowed');
  }

  return didResolver.resolveAtprotoKey(issuerDid, forceRefresh);
}

export async function verifyFeedRequesterDid(authHeader: string | undefined): Promise<string | null> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }

  try {
    const verified = await verifyJwt(
      token,
      config.FEED_JWT_AUDIENCE.length > 0 ? config.FEED_JWT_AUDIENCE : null,
      null,
      resolveIssuerSigningKey
    );

    if (!isDid(verified.iss) || !isAllowedIssuerDid(verified.iss)) {
      return null;
    }

    const payload = decodeJwtPayload(token);
    if (!payload || !validateIat(payload)) {
      return null;
    }

    // Prefer explicit subject DID when present; otherwise use verified issuer DID.
    const subjectDid = payload.sub;
    if (isDid(subjectDid)) {
      return subjectDid;
    }

    return verified.iss;
  } catch (err) {
    logger.debug({ err }, 'Feed requester JWT verification failed');
    return null;
  }
}
