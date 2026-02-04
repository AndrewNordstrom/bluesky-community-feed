/**
 * Feed Cursor Module
 *
 * Handles encoding and decoding of pagination cursors.
 * Uses snapshot-based cursors for stable pagination.
 *
 * Cursor format (base64url-encoded JSON):
 * {
 *   s: snapshotId,  // ID of the feed snapshot
 *   o: offset       // Current offset in the snapshot
 * }
 *
 * This ensures:
 * - Stable pagination even if scores change between page loads
 * - No duplicate posts across pages
 * - Simple implementation without complex timestamp-based ordering
 */

/**
 * Parsed cursor data.
 */
export interface ParsedCursor {
  /** The snapshot ID */
  snapshotId: string;
  /** The current offset in the snapshot */
  offset: number;
}

/**
 * Encode a cursor for the response.
 *
 * @param snapshotId - The ID of the feed snapshot
 * @param offset - The current offset
 * @returns Base64url-encoded cursor string
 */
export function encodeCursor(snapshotId: string, offset: number): string {
  const payload = JSON.stringify({ s: snapshotId, o: offset });
  return Buffer.from(payload).toString('base64url');
}

/**
 * Decode a cursor from the request.
 *
 * @param cursor - The base64url-encoded cursor string
 * @returns Parsed cursor data, or null if invalid
 */
export function decodeCursor(cursor: string): ParsedCursor | null {
  try {
    const payload = Buffer.from(cursor, 'base64url').toString();
    const parsed = JSON.parse(payload);

    // Validate required fields
    if (typeof parsed.s !== 'string' || typeof parsed.o !== 'number') {
      return null;
    }

    return {
      snapshotId: parsed.s,
      offset: parsed.o,
    };
  } catch {
    // Invalid cursor format
    return null;
  }
}
