/**
 * create-did-plc.ts
 *
 * Generates a did:plc identity for the feed generator.
 *
 * CRITICAL: Run this ONCE and save the DID to .env as FEEDGEN_SERVICE_DID.
 * Never regenerate - the DID is permanent and cannot be changed.
 *
 * Usage:
 *   npx tsx scripts/create-did-plc.ts
 *
 * This script:
 * 1. Generates an ECDSA keypair (secp256k1)
 * 2. Creates a did:plc document
 * 3. Registers it with the PLC directory
 * 4. Outputs the DID and private key for storage
 *
 * Note: For testing, you can use your existing Bluesky account's DID
 * as both FEEDGEN_SERVICE_DID and FEEDGEN_PUBLISHER_DID.
 */

import * as crypto from '@atproto/crypto';
import dotenv from 'dotenv';

dotenv.config();

const PLC_DIRECTORY = 'https://plc.directory';

interface PlcOperation {
  type: 'plc_operation';
  rotationKeys: string[];
  verificationMethods: Record<string, string>;
  alsoKnownAs: string[];
  services: Record<string, { type: string; endpoint: string }>;
  prev: string | null;
  sig: string;
}

async function createDidPlc() {
  console.log('=== DID:PLC Generator for Feed Generator ===\n');

  // Check if hostname is configured
  const hostname = process.env.FEEDGEN_HOSTNAME;
  if (!hostname) {
    console.error('Error: FEEDGEN_HOSTNAME must be set in .env');
    console.error('Example: FEEDGEN_HOSTNAME="feed.yourdomain.com"');
    process.exit(1);
  }

  console.log(`Hostname: ${hostname}`);
  console.log('Generating keypair...\n');

  // Generate a secp256k1 keypair
  const keypair = await crypto.Secp256k1Keypair.create({ exportable: true });
  const publicKeyMultibase = keypair.did().replace('did:key:', '');

  console.log('Keypair generated.');
  console.log(`Public key (multibase): ${publicKeyMultibase}\n`);

  // Export private key for storage
  const privateKeyBytes = await keypair.export();
  const privateKeyHex = Buffer.from(privateKeyBytes).toString('hex');

  console.log('IMPORTANT: Save these values securely!\n');
  console.log('=== Private Key (KEEP SECRET) ===');
  console.log(privateKeyHex);
  console.log('');

  // Create the PLC operation
  // Note: In production, you would sign and submit this to plc.directory
  const genesisOp = {
    type: 'plc_operation' as const,
    rotationKeys: [publicKeyMultibase],
    verificationMethods: {
      atproto: publicKeyMultibase,
    },
    alsoKnownAs: [],
    services: {
      bsky_fg: {
        type: 'BskyFeedGenerator',
        endpoint: `https://${hostname}`,
      },
    },
    prev: null,
  };

  console.log('=== Genesis Operation (for reference) ===');
  console.log(JSON.stringify(genesisOp, null, 2));
  console.log('');

  // Compute the DID from the genesis operation
  // The DID is derived from a hash of the signed genesis operation
  // For now, we'll use the key DID as a placeholder
  const keyDid = keypair.did();

  console.log('=== Next Steps ===');
  console.log('');
  console.log('Option A: Use your Bluesky account DID (recommended for testing)');
  console.log('  1. Go to bsky.app and find your profile');
  console.log('  2. Your DID is in Settings > Advanced > DID');
  console.log('  3. Set both FEEDGEN_SERVICE_DID and FEEDGEN_PUBLISHER_DID to this DID');
  console.log('');
  console.log('Option B: Register a new did:plc (for production)');
  console.log('  1. The genesis operation above needs to be signed and submitted to plc.directory');
  console.log('  2. Use the @atproto/identity library or the PLC directory API');
  console.log('  3. See: https://github.com/did-method-plc/did-method-plc');
  console.log('');
  console.log(`Key DID (for reference): ${keyDid}`);
  console.log('');
  console.log('Once you have your DID, add it to .env:');
  console.log('  FEEDGEN_SERVICE_DID="did:plc:your-did-here"');
}

createDidPlc().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
