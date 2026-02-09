import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const { verifyRequesterJwtMock } = vi.hoisted(() => ({
  verifyRequesterJwtMock: vi.fn(),
}));

vi.mock('../src/feed/jwt-verifier.js', () => ({
  verifyRequesterJwt: verifyRequesterJwtMock,
}));

import { verifyRequesterDid } from '../src/feed/auth.js';

describe('verifyRequesterDid timeout behavior', () => {
  it('returns null when JWT verification exceeds timeout', async () => {
    vi.useFakeTimers();
    verifyRequesterJwtMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({ did: 'did:plc:late' });
          }, 1000)
        )
    );

    const request = {
      headers: {
        authorization: 'Bearer slow.token.value',
      },
    } as unknown as FastifyRequest;

    const resultPromise = verifyRequesterDid(request);
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBeNull();

    vi.useRealTimers();
  });
});
