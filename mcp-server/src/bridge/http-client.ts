/**
 * HTTP client wrapper for Bridge Service communication
 * Provides consistent error handling, timing, and connection management
 */

import { fetch, Pool } from 'undici';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('HttpClient');

/**
 * HTTP request options
 */
export interface HttpRequestOptions {
  /**
   * Use fast pool for low-latency requests
   */
  fast?: boolean;
  /**
   * Custom headers to include
   */
  headers?: Record<string, string>;
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
}

/**
 * HTTP error with additional context
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code: string = 'HTTP_ERROR',
    public details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * HTTP client with connection pooling
 */
export class HttpClient {
  private standardPool: Pool;
  private fastPool: Pool;
  private baseUrl: string;

  /**
   * Initialize HTTP client with connection pools
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.standardPool = new Pool(baseUrl, { connections: 50 });
    this.fastPool = new Pool(baseUrl, { connections: 5 });
  }

  /**
   * Make a GET request
   */
  async get<T = unknown>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * Make a POST request
   */
  async post<T = unknown>(path: string, body?: unknown, options: HttpRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * Make a DELETE request
   */
  async delete<T = unknown>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /**
   * Make an HTTP request with consolidated error handling
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const dispatcher = options.fast ? this.fastPool : this.standardPool;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        body: body ? JSON.stringify(body) : undefined,
        dispatcher,
        signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
      });

      const duration = Date.now() - startTime;
      if (duration >= 1000) {
        logger.warn(`${method} ${path} completed in ${duration}ms`, { status: response.status });
      } else {
        logger.debug(`${method} ${path} completed in ${duration}ms`, { status: response.status });
      }

      // Handle non-OK responses
      if (!response.ok) {
        const errorText = await response.text();
        let errorDetails;
        try {
          errorDetails = JSON.parse(errorText);
        } catch {
          errorDetails = errorText;
        }

        throw new HttpError(
          `${method} ${path} failed with status ${response.status}`,
          response.status,
          'HTTP_REQUEST_FAILED',
          errorDetails
        );
      }

      // Parse JSON response
      const data = await response.json() as T;
      return data;

    } catch (error: unknown) {
      const duration = Date.now() - startTime;

      // Re-throw HttpError as-is
      if (error instanceof HttpError) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && (error.name === 'AbortError' || ('code' in error && (error as NodeJS.ErrnoException).code === 'UND_ERR_ABORTED'))) {
        logger.error(`${method} ${path} timed out after ${duration}ms`);
        throw new HttpError(
          `Request to ${path} timed out`,
          undefined,
          'TIMEOUT',
          { duration, timeout: options.timeout }
        );
      }

      // Handle network errors
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
          logger.error(`${method} ${path} connection failed after ${duration}ms`, error);
          throw new HttpError(
            'Failed to connect to Bridge Service',
            undefined,
            'CONNECTION_FAILED',
            { originalError: error.message }
          );
        }
      }

      // Wrap unknown errors
      logger.error(`${method} ${path} failed after ${duration}ms`, error);
      throw new HttpError(
        error instanceof Error ? error.message : 'Unknown error occurred',
        undefined,
        'UNKNOWN_ERROR',
        { originalError: error }
      );
    }
  }

  /**
   * Shutdown the client and close connections
   */
  async shutdown(): Promise<void> {
    await Promise.all([
      this.standardPool.close(),
      this.fastPool.close()
    ]);
  }
}