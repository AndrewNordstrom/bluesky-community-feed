import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyJwtMock, MockAuthRequiredError } = vi.hoisted(() => {
  class MockAuthRequiredErrorImpl extends Error {
    error: string;

    constructor(message: string, error: string) {
      super(message);
      this.error = error;
    }
  }

  return {
    verifyJwtMock: vi.fn(),
    MockAuthRequiredError: MockAuthRequiredErrorImpl,
  };
});

vi.mock('@atproto/xrpc-server', () => ({
  verifyJwt: verifyJwtMock,
  AuthRequiredError: MockAuthRequiredError,
}));

import { config } from '../src/config.js';
import { verifyRequesterJwt } from '../src/feed/jwt-verifier.js';

const audience = config.FEED_JWT_AUDIENCE.trim() || config.FEEDGEN_SERVICE_DID;

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256K', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('verifyRequesterJwt', () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
  });

  it('returns DID for a valid JWT payload', async () => {
    const token = makeJwt({
      iss: 'did:plc:validissuer123',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    verifyJwtMock.mockResolvedValue({
      iss: 'did:plc:validissuer123',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyRequesterJwt(token);
    expect(result).toEqual({ did: 'did:plc:validissuer123' });
  });

  it('maps bad signature errors to an explicit reason', async () => {
    const token = makeJwt({
      iss: 'did:plc:validissuer123',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    verifyJwtMock.mockRejectedValue(
      new MockAuthRequiredError('could not verify jwt signature', 'BadJwtSignature')
    );

    const result = await verifyRequesterJwt(token);
    expect(result).toEqual({
      did: null,
      reason: 'BadJwtSignature',
    });
  });

  it('rejects issuers outside the configured allowlist', async () => {
    const token = makeJwt({
      iss: 'did:example:unsupported',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    verifyJwtMock.mockResolvedValue({
      iss: 'did:example:unsupported',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyRequesterJwt(token);
    expect(result).toEqual({
      did: null,
      reason: 'issuer_not_allowed',
    });
  });

  it('maps expired JWT errors correctly', async () => {
    const token = makeJwt({
      iss: 'did:plc:validissuer123',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    verifyJwtMock.mockRejectedValue(new MockAuthRequiredError('jwt expired', 'JwtExpired'));

    const result = await verifyRequesterJwt(token);
    expect(result).toEqual({
      did: null,
      reason: 'JwtExpired',
    });
  });

  it('maps malformed JWT errors correctly', async () => {
    verifyJwtMock.mockRejectedValue(new MockAuthRequiredError('poorly formatted jwt', 'BadJwt'));

    const result = await verifyRequesterJwt('malformed');
    expect(result).toEqual({
      did: null,
      reason: 'BadJwt',
    });
  });
});
