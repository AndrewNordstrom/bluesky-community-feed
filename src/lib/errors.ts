/**
 * Standardized Error Types
 *
 * Provides consistent error handling across the application.
 * All API errors return the same format for easier client handling.
 */

/**
 * Standard API error response format.
 */
export interface ApiErrorResponse {
  error: string;         // Machine-readable error code
  message: string;       // Human-readable message
  correlationId?: string; // Request correlation ID for debugging
  details?: unknown;     // Optional additional details (e.g., validation errors)
}

/**
 * Application error class with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert to API response format.
   */
  toResponse(correlationId?: string): ApiErrorResponse {
    return {
      error: this.errorCode,
      message: this.message,
      correlationId,
      details: this.details,
    };
  }
}

/**
 * Pre-defined error factories for common error types.
 */
export const Errors = {
  // 400 Bad Request
  VALIDATION_ERROR: (message: string, details?: unknown) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),

  BAD_REQUEST: (message: string) =>
    new AppError(400, 'BAD_REQUEST', message),

  // 401 Unauthorized
  UNAUTHORIZED: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),

  INVALID_TOKEN: (message = 'Invalid or expired token') =>
    new AppError(401, 'INVALID_TOKEN', message),

  // 403 Forbidden
  FORBIDDEN: (message = 'Access denied') =>
    new AppError(403, 'FORBIDDEN', message),

  NOT_SUBSCRIBER: (message = 'Must be a feed subscriber to perform this action') =>
    new AppError(403, 'NOT_SUBSCRIBER', message),

  // 404 Not Found
  NOT_FOUND: (resource: string) =>
    new AppError(404, 'NOT_FOUND', `${resource} not found`),

  // 409 Conflict
  CONFLICT: (message: string) =>
    new AppError(409, 'CONFLICT', message),

  ALREADY_VOTED: (message = 'Already voted in this epoch') =>
    new AppError(409, 'ALREADY_VOTED', message),

  // 429 Too Many Requests
  RATE_LIMITED: (message = 'Too many requests, please try again later') =>
    new AppError(429, 'RATE_LIMITED', message),

  // 500 Internal Server Error
  DATABASE_ERROR: (message = 'Database operation failed') =>
    new AppError(500, 'DATABASE_ERROR', message),

  REDIS_ERROR: (message = 'Cache operation failed') =>
    new AppError(500, 'REDIS_ERROR', message),

  INTERNAL_ERROR: (message = 'An unexpected error occurred') =>
    new AppError(500, 'INTERNAL_ERROR', message),

  // 503 Service Unavailable
  SERVICE_UNAVAILABLE: (message = 'Service temporarily unavailable') =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};

/**
 * Check if an error is an AppError.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
