/**
 * @module web/http-utils
 *
 * Shared helpers for Express route replies.
 */

import type { Response } from 'express';

/** Send a JSON error reply `{ error: message }`; `extra` adds fields such as `kind` or `details`. */
export function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ ...extra, error: message });
}
