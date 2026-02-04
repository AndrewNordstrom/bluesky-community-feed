/**
 * Load Test Script
 *
 * Tests the getFeedSkeleton endpoint under load.
 * Target: p95 latency < 50ms with 100 concurrent connections.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts
 *   npx tsx scripts/load-test.ts --url http://localhost:3000 --connections 100 --duration 30
 */

import autocannon from 'autocannon';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string, defaultValue: string): string => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const BASE_URL = getArg('url', 'http://localhost:3000');
const CONNECTIONS = parseInt(getArg('connections', '100'), 10);
const DURATION = parseInt(getArg('duration', '30'), 10);
const P95_TARGET_MS = parseInt(getArg('target', '50'), 10);

// You'll need to update this with your actual feed URI
// Format: at://{publisher_did}/app.bsky.feed.generator/{rkey}
const FEED_URI = process.env.FEED_URI || 'at://did:plc:example/app.bsky.feed.generator/community-gov';

async function runLoadTest() {
  console.log('='.repeat(60));
  console.log('Feed Generator Load Test');
  console.log('='.repeat(60));
  console.log(`Target URL: ${BASE_URL}/xrpc/app.bsky.feed.getFeedSkeleton`);
  console.log(`Feed URI: ${FEED_URI}`);
  console.log(`Connections: ${CONNECTIONS}`);
  console.log(`Duration: ${DURATION}s`);
  console.log(`P95 Target: <${P95_TARGET_MS}ms`);
  console.log('='.repeat(60));
  console.log('');

  const testUrl = `${BASE_URL}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(FEED_URI)}&limit=50`;

  console.log('Starting load test...\n');

  const result = await autocannon({
    url: testUrl,
    connections: CONNECTIONS,
    duration: DURATION,
    headers: {
      'Accept': 'application/json',
    },
  });

  console.log('\n' + '='.repeat(60));
  console.log('Results');
  console.log('='.repeat(60));
  console.log('');
  console.log('Throughput:');
  console.log(`  Requests/sec (avg): ${result.requests.average.toFixed(2)}`);
  console.log(`  Requests/sec (min): ${result.requests.min}`);
  console.log(`  Requests/sec (max): ${result.requests.max}`);
  console.log('');
  console.log('Latency:');
  console.log(`  p50:  ${result.latency.p50}ms`);
  console.log(`  p75:  ${result.latency.p75}ms`);
  console.log(`  p90:  ${result.latency.p90}ms`);
  console.log(`  p95:  ${result.latency.p95}ms`);
  console.log(`  p99:  ${result.latency.p99}ms`);
  console.log(`  p999: ${result.latency.p999}ms`);
  console.log(`  avg:  ${result.latency.average.toFixed(2)}ms`);
  console.log(`  max:  ${result.latency.max}ms`);
  console.log('');
  console.log('Data Transfer:');
  console.log(`  Bytes/sec (avg): ${formatBytes(result.throughput.average)}`);
  console.log(`  Total bytes: ${formatBytes(result.throughput.total)}`);
  console.log('');
  console.log('Errors:');
  console.log(`  Total errors: ${result.errors}`);
  console.log(`  Timeouts: ${result.timeouts}`);
  console.log(`  Non-2xx responses: ${result.non2xx}`);
  console.log('');
  console.log('='.repeat(60));

  // Evaluate pass/fail
  const passed = result.latency.p95 <= P95_TARGET_MS;
  if (passed) {
    console.log(`\n✅ PASS: p95 latency (${result.latency.p95}ms) is within target (<${P95_TARGET_MS}ms)`);
    process.exit(0);
  } else {
    console.log(`\n❌ FAIL: p95 latency (${result.latency.p95}ms) exceeds target (<${P95_TARGET_MS}ms)`);
    process.exit(1);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
