#!/usr/bin/env npx tsx
/**
 * post-announcement.ts
 *
 * CLI tool to manually post an announcement.
 *
 * Usage:
 *   npx tsx scripts/post-announcement.ts "Your announcement message"
 *   npx tsx scripts/post-announcement.ts --help
 *
 * Examples:
 *   npx tsx scripts/post-announcement.ts "Welcome to Community Governed Feed!"
 *   npx tsx scripts/post-announcement.ts "Voting is now open - cast your preferences!"
 */

import dotenv from 'dotenv';
dotenv.config();

import { postAnnouncement } from '../src/bot/poster.js';
import { isBotEnabled } from '../src/bot/agent.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx tsx scripts/post-announcement.ts "<message>"

Post a manual announcement to Bluesky and pin it to the feed.

Arguments:
  message    The announcement text (max 300 characters)

Environment variables required:
  BOT_ENABLED=true
  BOT_HANDLE=your-bot.bsky.social
  BOT_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

Examples:
  npx tsx scripts/post-announcement.ts "Welcome to Community Governed Feed!"
  npx tsx scripts/post-announcement.ts "New epoch is live - algorithm updated!"
`);
    process.exit(0);
  }

  const message = args.join(' ');

  if (message.length > 300) {
    console.error('Error: Message exceeds 300 characters');
    process.exit(1);
  }

  if (!isBotEnabled()) {
    console.error('Error: Bot is not enabled.');
    console.error('Set BOT_ENABLED=true, BOT_HANDLE, and BOT_APP_PASSWORD in your .env file.');
    process.exit(1);
  }

  console.log('Posting announcement...');
  console.log(`Message: "${message}"`);
  console.log();

  try {
    const announcement = await postAnnouncement({
      type: 'manual',
      message,
    });

    if (!announcement) {
      console.error('Failed: Bot returned null (may be disabled)');
      process.exit(1);
    }

    console.log('Success!');
    console.log();
    console.log('Announcement details:');
    console.log(`  ID:   ${announcement.id}`);
    console.log(`  URI:  ${announcement.uri}`);
    console.log(`  Type: ${announcement.type}`);
    console.log(`  Time: ${announcement.createdAt.toISOString()}`);
    console.log();
    console.log('The announcement is now pinned to the top of the feed.');
  } catch (err) {
    console.error('Failed to post announcement:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
