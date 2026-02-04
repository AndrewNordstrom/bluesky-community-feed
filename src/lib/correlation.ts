/**
 * Correlation ID Module
 *
 * Generates short, unique IDs for request tracing.
 * These IDs are attached to every request and included in logs and error responses.
 */

import { randomUUID } from 'crypto';

/**
 * Generate a short correlation ID for request tracing.
 * Uses first 8 characters of a UUID for readability.
 */
export function generateCorrelationId(): string {
  return randomUUID().slice(0, 8);
}
