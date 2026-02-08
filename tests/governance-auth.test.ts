import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const { loginMock, saveSessionMock, getSessionByTokenMock, deleteSessionMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  saveSessionMock: vi.fn(),
  getSessionByTokenMock: vi.fn(),
  deleteSessionMock: vi.fn(),
}));

vi.mock('@atproto/api', () => ({
  AtpAgent: class MockAtpAgent {
    login = loginMock;
  },
}));

vi.mock('../src/governance/session-store.js', () => ({
  saveSession: saveSessionMock,
  getSessionByToken: getSessionByTokenMock,
  deleteSession: deleteSessionMock,
}));

import {
  authenticateWithBluesky,
  getAuthenticatedDid,
  invalidateSession,
  SessionStoreUnavailableError,
} from '../src/governance/auth.js';

describe('governance auth session handling', () => {
  beforeEach(() => {
    loginMock.mockReset();
    saveSessionMock.mockReset();
    getSessionByTokenMock.mockReset();
    deleteSessionMock.mockReset();
  });

  it('creates an opaque session token and stores it in Redis', async () => {
    loginMock.mockResolvedValue({
      success: true,
      data: {
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
        accessJwt: 'upstream.jwt.value',
      },
    });
    saveSessionMock.mockResolvedValue(undefined);

    const session = await authenticateWithBluesky('alice.bsky.social', 'app-password');

    expect(session).not.toBeNull();
    expect(session?.did).toBe('did:plc:alice');
    expect(session?.handle).toBe('alice.bsky.social');
    expect(session?.accessJwt).not.toBe('upstream.jwt.value');
    expect(session?.accessJwt.length).toBeGreaterThan(20);
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    expect(saveSessionMock.mock.calls[0]?.[0]).toBe(session?.accessJwt);
  });

  it('resolves authenticated DID from stored session token', async () => {
    getSessionByTokenMock.mockResolvedValue({
      did: 'did:plc:alice',
      handle: 'alice.bsky.social',
      accessJwt: 'opaque-session-token',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const request = {
      headers: {
        authorization: 'Bearer opaque-session-token',
      },
    } as FastifyRequest;

    const did = await getAuthenticatedDid(request);
    expect(did).toBe('did:plc:alice');
  });

  it('throws SessionStoreUnavailableError when Redis lookup fails', async () => {
    getSessionByTokenMock.mockRejectedValue(new Error('redis unavailable'));

    const request = {
      headers: {
        authorization: 'Bearer opaque-session-token',
      },
    } as FastifyRequest;

    await expect(getAuthenticatedDid(request)).rejects.toBeInstanceOf(SessionStoreUnavailableError);
  });

  it('invalidates session tokens through Redis', async () => {
    deleteSessionMock.mockResolvedValue(undefined);
    await invalidateSession('opaque-session-token');
    expect(deleteSessionMock).toHaveBeenCalledWith('opaque-session-token');
  });
});
