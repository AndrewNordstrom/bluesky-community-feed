import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { parseTrustProxyConfig } from '../src/feed/server.js';

vi.mock('../src/db/redis.js', () => ({
  redis: {},
}));

describe('security-oriented config defaults', () => {
  it.each(['production', 'development'])('loads working-directory dotenv only outside production (%s)', (mode) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'corgi-config-integrity-'));
    const source = new URL('../src/config.ts', import.meta.url).href;
    writeFileSync(path.join(directory, '.env'), 'PROJ2268_DOTENV_PROBE=from-writable-checkout\n');
    try {
      const result = spawnSync(process.execPath, [
        '--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
        'await import(process.argv[1]); console.log(JSON.stringify({ probe: process.env.PROJ2268_DOTENV_PROBE ?? null }));',
        source,
      ], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          NODE_ENV: mode,
          FEEDGEN_SERVICE_DID: 'did:web:fixture.example',
          FEEDGEN_PUBLISHER_DID: 'did:plc:fixture',
          FEEDGEN_HOSTNAME: 'fixture.example',
          JETSTREAM_URL: 'wss://fixture.example/subscribe',
          JETSTREAM_FALLBACK_URL: 'wss://fallback.example/subscribe',
          JETSTREAM_COLLECTIONS: 'app.bsky.feed.post',
          DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture',
          REDIS_URL: 'redis://127.0.0.1:6379',
          DEMO_REDIS_URL: 'redis://127.0.0.1:6381',
          BSKY_IDENTIFIER: 'fixture.example',
          BSKY_APP_PASSWORD: 'dummy-password',
          EXPORT_ANONYMIZATION_SALT: 'fixture-export-salt-at-least-32-characters',
          DEMO_RATE_LIMIT_HASH_SECRET: 'fixture-demo-secret-at-least-32-characters',
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(JSON.parse(lines[lines.length - 1])).toEqual({
        probe: mode === 'production' ? null : 'from-writable-checkout',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses did:plc-only default issuer prefixes in config schema', () => {
    const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    expect(source).toContain("FEED_JWT_ALLOWED_ISSUER_PREFIXES: z.string().default('did:plc:')");
  });

  it('enforces a non-default export anonymization salt in production', () => {
    const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    expect(source).toContain('EXPORT_ANONYMIZATION_SALT must be explicitly set in production.');
    expect(source).toContain('EXPORT_ANONYMIZATION_SALT should be at least 32 characters in production.');
  });

  it('parses trustProxy configuration safely', () => {
    expect(parseTrustProxyConfig('false')).toBe(false);
    expect(parseTrustProxyConfig('true')).toBe(true);
    expect(parseTrustProxyConfig(' OFF ')).toBe(false);
    expect(parseTrustProxyConfig(' On ')).toBe(true);
    expect(parseTrustProxyConfig('   ')).toBe(false);
    expect(parseTrustProxyConfig('loopback')).toBe('loopback');
    expect(parseTrustProxyConfig(' 127.1 ')).toBe('127.1');
    expect(parseTrustProxyConfig('127.0.0.1,10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(parseTrustProxyConfig(' loopback, , 10.0.0.0/8 ')).toEqual(['loopback', '10.0.0.0/8']);
  });

  it.each(['0', '1', '2', '01', ' 2 ', '999999999999999999999999999999999999'])(
    'rejects numeric TRUST_PROXY hop count %j with migration guidance',
    (value) => {
      expect(() => parseTrustProxyConfig(value)).toThrow(TypeError);
      expect(() => parseTrustProxyConfig(value)).toThrow(
        'TRUST_PROXY numeric hop counts are unsupported because they cannot validate the connecting proxy. ' +
        'Use an explicit trusted proxy IP/CIDR or "loopback" instead.',
      );
    },
  );

  it.each([
    ['loopback', '127.0.0.1'],
    ['127.0.0.1,10.0.0.0/8', '127.0.0.1'],
    ['127.0.0.1,10.0.0.0/8', '10.0.0.7'],
  ])(
    'honors forwarded headers with %j from trusted peer %j',
    async (value, trustedPeer) => {
      const app = Fastify({ trustProxy: parseTrustProxyConfig(value) });
      app.get('/', async (request) => ({
        ip: request.ip,
        host: request.host,
        protocol: request.protocol,
      }));
      const headers = {
        host: 'origin.example',
        'x-forwarded-for': '198.51.100.9',
        'x-forwarded-host': 'proxy.example',
        'x-forwarded-proto': 'https',
      };

      try {
        const untrusted = await app.inject({ url: '/', remoteAddress: '203.0.113.7', headers });
        expect(untrusted.statusCode).toBe(200);
        expect(untrusted.json()).toEqual({
          ip: '203.0.113.7', host: 'origin.example', protocol: 'http',
        });

        const trusted = await app.inject({ url: '/', remoteAddress: trustedPeer, headers });
        expect(trusted.statusCode).toBe(200);
        expect(trusted.json()).toEqual({
          ip: '198.51.100.9', host: 'proxy.example', protocol: 'https',
        });
      } finally {
        await app.close();
      }
    },
  );
});
