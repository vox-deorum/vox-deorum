/**
 * @module web/loopback
 *
 * Loopback request policy shared by the dashboard server and other local hosts.
 * Keeping it here lets a local host reject cross-origin and DNS-rebinding requests without
 * importing the dashboard app.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ErrorResponse } from '../types/index.js';
import { sendError } from './http-utils.js';
import { isAllowedDashboardRequest, isAllowedLoopbackOrigin } from './origin.js';

/** Resolves the browser-origin CORS policy using the middleware callback contract. */
export function allowLoopbackCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allowed?: boolean) => void,
): void {
  callback(null, isAllowedLoopbackOrigin(origin));
}

/** Rejects browser and Host-header requests that do not identify a loopback host. */
export function requireLoopbackRequest(req: Request, res: Response<ErrorResponse>, next: NextFunction): void {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This request is not allowed to access the local service.');
    return;
  }
  next();
}
