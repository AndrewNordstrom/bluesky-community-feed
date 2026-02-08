import { redis } from '../db/redis.js';
import { SessionInfo } from './governance.types.js';

const SESSION_PREFIX = 'gov:session:';

type StoredSession = {
  did: string;
  handle: string;
  expiresAt: string;
};

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

export async function saveSession(token: string, session: SessionInfo): Promise<void> {
  const ttlSeconds = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  const payload: StoredSession = {
    did: session.did,
    handle: session.handle,
    expiresAt: session.expiresAt.toISOString(),
  };

  await redis.set(sessionKey(token), JSON.stringify(payload), 'EX', ttlSeconds);
}

export async function getSessionByToken(token: string): Promise<SessionInfo | null> {
  const raw = await redis.get(sessionKey(token));
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as StoredSession;
  const expiresAt = new Date(parsed.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    await deleteSession(token);
    return null;
  }

  return {
    did: parsed.did,
    handle: parsed.handle,
    accessJwt: token,
    expiresAt,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await redis.del(sessionKey(token));
}
