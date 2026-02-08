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
  aud: string;
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

export async function verifyRequesterJwt(jwt: string): Promise<VerifiedRequester | VerificationFailure> {
  const audience = config.FEED_JWT_AUDIENCE.trim() || config.FEEDGEN_SERVICE_DID;

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

    const now = Math.floor(Date.now() / 1000);
    const skew = config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS;

    if (typeof payload.nbf === 'number' && payload.nbf > now + skew) {
      return { did: null, reason: 'jwt_not_yet_valid' };
    }

    if (typeof payload.iat === 'number' && payload.iat > now + skew) {
      return { did: null, reason: 'jwt_issued_in_future' };
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
