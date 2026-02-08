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

import { verifyRequesterJwt } from '../src/feed/jwt-verifier.js';

describe('verifyRequesterJwt', () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
  });

  it('returns DID for a valid JWT payload', async () => {
    verifyJwtMock.mockResolvedValue({
      iss: 'did:plc:validissuer123',
      aud: 'did:plc:service',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyRequesterJwt('valid.jwt.token');
    expect(result).toEqual({ did: 'did:plc:validissuer123' });
  });

  it('maps bad signature errors to an explicit reason', async () => {
    verifyJwtMock.mockRejectedValue(
      new MockAuthRequiredError('could not verify jwt signature', 'BadJwtSignature')
    );

    const result = await verifyRequesterJwt('invalid.signature.token');
    expect(result).toEqual({
      did: null,
      reason: 'BadJwtSignature',
    });
  });

  it('rejects issuers outside the configured allowlist', async () => {
    verifyJwtMock.mockResolvedValue({
      iss: 'did:example:unsupported',
      aud: 'did:plc:service',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyRequesterJwt('disallowed.issuer.token');
    expect(result).toEqual({
      did: null,
      reason: 'issuer_not_allowed',
    });
  });

  it('maps expired JWT errors correctly', async () => {
    verifyJwtMock.mockRejectedValue(new MockAuthRequiredError('jwt expired', 'JwtExpired'));

    const result = await verifyRequesterJwt('expired.jwt.token');
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
