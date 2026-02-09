import { DidResolver } from '@atproto/identity';
import { AuthRequiredError, verifyJwt } from '@atproto/xrpc-server';
import { config } from '../config.js';

const didResolver = new DidResolver({});
const issuerPrefixes = config.FEED_JWT_ALLOWED_ISSUER_PREFIXES
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

type JwtPayload = {
  iss: string;
  exp: number;
  aud: string | string[];
  nbf?: number;
  iat?: number;
};

export type VerifiedRequester = {
  did: string;
};

export type VerificationFailure = {
  did: null;
  reason: string;
};

function base64UrlDecode(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const decoded = base64UrlDecode(parts[1]);
  if (!decoded) {
    return null;
  }

  try {
    const payload = JSON.parse(decoded) as Partial<JwtPayload>;
    if (
      typeof payload.iss !== 'string' ||
      typeof payload.exp !== 'number' ||
      (!Array.isArray(payload.aud) && typeof payload.aud !== 'string')
    ) {
      return null;
    }
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

function audienceIncludes(payloadAudience: string | string[], expectedAudience: string): boolean {
  if (Array.isArray(payloadAudience)) {
    return payloadAudience.includes(expectedAudience);
  }

  return payloadAudience === expectedAudience;
}

function validateTemporalClaims(payload: JwtPayload): VerificationFailure | null {
  const now = Math.floor(Date.now() / 1000);
  const skew = config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS;

  if (payload.exp <= now) {
    return { did: null, reason: 'JwtExpired' };
  }

  if (typeof payload.nbf === 'number' && payload.nbf > now + skew) {
    return { did: null, reason: 'jwt_not_yet_valid' };
  }

  if (typeof payload.iat === 'number' && payload.iat > now + skew) {
    return { did: null, reason: 'jwt_issued_in_future' };
  }

  return null;
}

export async function verifyRequesterJwt(jwt: string): Promise<VerifiedRequester | VerificationFailure> {
  const audience = config.FEED_JWT_AUDIENCE.trim() || config.FEEDGEN_SERVICE_DID;
  const decodedPayload = decodeJwtPayload(jwt);

  if (!decodedPayload) {
    return { did: null, reason: 'BadJwt' };
  }

  if (!isIssuerAllowed(decodedPayload.iss)) {
    return { did: null, reason: 'issuer_not_allowed' };
  }

  if (!audienceIncludes(decodedPayload.aud, audience)) {
    return { did: null, reason: 'aud_mismatch' };
  }

  const temporalFailure = validateTemporalClaims(decodedPayload);
  if (temporalFailure) {
    return temporalFailure;
  }

  try {
    const payload = (await verifyJwt(
      jwt,
      audience,
      null,
      async (did: string, forceRefresh: boolean) =>
        didResolver.resolveAtprotoKey(did, forceRefresh)
    )) as JwtPayload;

    if (!isIssuerAllowed(payload.iss)) {
      return { did: null, reason: 'issuer_not_allowed' };
    }

    if (!audienceIncludes(payload.aud, audience)) {
      return { did: null, reason: 'aud_mismatch' };
    }

    const verifiedTemporalFailure = validateTemporalClaims(payload);
    if (verifiedTemporalFailure) {
      return verifiedTemporalFailure;
    }

    return { did: payload.iss };
  } catch (err) {
    return {
      did: null,
      reason: mapJwtErrorReason(err),
    };
  }
}

function isIssuerAllowed(issuer: string): boolean {
  if (issuerPrefixes.length === 0) {
    return issuer.startsWith('did:');
  }

  return issuerPrefixes.some((prefix) => issuer.startsWith(prefix));
}

function mapJwtErrorReason(err: unknown): string {
  if (err instanceof AuthRequiredError) {
    const code = (err as unknown as { error?: string }).error;
    return code ?? 'AuthRequiredError';
  }

  if (err instanceof Error && err.name) {
    return err.name;
  }

  return 'jwt_verification_failed';
}
