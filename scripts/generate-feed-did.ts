/**
 * generate-feed-did.ts
 *
 * Helper for deployment bootstrap.
 * Resolves a Bluesky handle into a DID and prints the exact .env values to set.
 *
 * Usage:
 *   npm run generate-feed-did -- your-handle.bsky.social
 *   npm run generate-feed-did -- did:plc:yourdid
 *
 * Notes:
 * - This script does not create a brand-new did:plc identity.
 * - For advanced dedicated service DID generation, use scripts/create-did-plc.ts.
 */

import dotenv from 'dotenv';

dotenv.config();

const RESOLVE_HANDLE_URL = 'https://bsky.social/xrpc/com.atproto.identity.resolveHandle';

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(`Error: ${message}\n`);
  }

  console.log('Usage:');
  console.log('  npm run generate-feed-did -- your-handle.bsky.social');
  console.log('  npm run generate-feed-did -- did:plc:yourdid');
  console.log('');
  console.log('Tip: If omitted, the script falls back to BSKY_IDENTIFIER from .env.');
  process.exit(1);
}

function normalizeInput(value: string): string {
  return value.trim().replace(/^@/, '');
}

async function resolveDid(value: string): Promise<string> {
  const normalized = normalizeInput(value);

  if (normalized.startsWith('did:')) {
    return normalized;
  }

  const url = `${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(normalized)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to resolve handle "${normalized}" (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { did?: string };
  if (!data.did || !data.did.startsWith('did:')) {
    throw new Error(`Handle "${normalized}" did not resolve to a valid DID.`);
  }

  return data.did;
}

async function main() {
  const arg = process.argv[2];
  const fallback = process.env.BSKY_IDENTIFIER;
  const input = arg ?? fallback;

  if (!input) {
    printUsageAndExit('missing handle or DID');
  }

  const did = await resolveDid(input);
  const normalizedInput = normalizeInput(input);
  const existingServiceDid = process.env.FEEDGEN_SERVICE_DID;

  console.log('=== Feed DID Bootstrap ===');
  console.log('');
  console.log(`Input: ${normalizedInput}`);
  console.log(`Resolved DID: ${did}`);
  console.log('');

  if (existingServiceDid && existingServiceDid !== 'did:plc:xxxxxxxxxxxxxxxxxxxxxxxx') {
    console.log(`Current FEEDGEN_SERVICE_DID in env: ${existingServiceDid}`);
    if (existingServiceDid !== did) {
      console.log('Warning: resolved DID differs from current FEEDGEN_SERVICE_DID.');
    }
    console.log('');
  }

  console.log('Set these values in your .env:');
  console.log(`FEEDGEN_SERVICE_DID="${did}"`);
  console.log(`FEEDGEN_PUBLISHER_DID="${did}"`);
  console.log('');
  console.log('Then publish your feed record:');
  console.log('npm run publish-feed');
  console.log('');
  console.log('If you need a dedicated service DID instead of a publisher DID,');
  console.log('run: npx tsx scripts/create-did-plc.ts');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
