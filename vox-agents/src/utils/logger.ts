/**
 * @module utils/logger
 *
 * Winston logger configuration for Vox Agents.
 * Provides structured logging with color-coded console output for development
 * and JSON output for production. Includes file-based logging for errors and all logs.
 */

import winston from 'winston';
import Transport from 'winston-transport';
import path from 'path';
import fs from 'fs';
import { sseManager } from '../web/sse-manager.js';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Color codes for different log levels
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m'
};

/**
 * Get level-specific styling for log messages.
 *
 * @param level - The log level (ERROR, WARN, INFO, DEBUG)
 * @returns Object containing color and icon for the level
 */
const getLevelStyle = (level: string) => {
  const upperLevel = level.toUpperCase();
  switch (upperLevel) {
    case 'ERROR':
      return {
        color: colors.red,
        icon: '❌',
      };
    case 'WARN':
      return {
        color: colors.yellow,
        icon: '⚠️ ',
      };
    case 'INFO':
      return {
        color: colors.blue,
        icon: 'ℹ️ ',
      };
    case 'DEBUG':
      return {
        color: colors.gray,
        icon: '🔍',
      };
    default:
      return {
        color: colors.white,
        icon: '📝',
      };
  }
};

/**
 * Sanitize AI SDK errors to prevent full prompts from being logged.
 * APICallError includes requestBodyValues with the entire messages array;
 * this replaces the messages with a redacted placeholder.
 */
function sanitizeAIError(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj;

  // Handle requestBodyValues directly on the object (APICallError)
  if (obj.requestBodyValues && typeof obj.requestBodyValues === 'object') {
    const { messages, prompt, ...rest } = obj.requestBodyValues;
    const sanitized = { ...obj, requestBodyValues: { ...rest } };
    if (messages) {
      sanitized.requestBodyValues.messages = `[redacted: ${Array.isArray(messages) ? messages.length : '?'} messages]`;
    }
    if (prompt) {
      sanitized.requestBodyValues.prompt = `[redacted: ${Array.isArray(prompt) ? prompt.length : '?'} prompt parts]`;
    }
    return sanitized;
  }

  // Handle InvalidPromptError which stores the full prompt
  if (obj.prompt && obj.name === 'AI_InvalidPromptError') {
    return { ...obj, prompt: '[redacted]' };
  }

  return obj;
}

/**
 * Winston format that strips large prompt data from AI SDK errors in metadata.
 */
const sanitizeErrors = winston.format((info) => {
  // Sanitize error objects passed as metadata arguments
  for (const key of Object.keys(info)) {
    const val = info[key];
    if (val && typeof val === 'object' && 'requestBodyValues' in val) {
      info[key] = sanitizeAIError(val);
    }
  }
  // Also sanitize if the info itself has requestBodyValues (error as top-level)
  if (info.requestBodyValues) {
    return sanitizeAIError(info);
  }
  return info;
});

/**
 * Enhanced custom log format with improved visual formatting and colors
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  sanitizeErrors(),
  winston.format.printf(({ timestamp, level, message, context, source, ...meta }) => {
    const style = getLevelStyle(level);
    const isProduction = process.env.NODE_ENV === 'production';

    // Filter out source field from metadata (it's only used for SSE streaming)
    // source is destructured above and not included in meta

    // Simplified format for production
    if (isProduction) {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      const contextStr = context ? ` [${context}]` : '';
      return `[${timestamp}] ${level.toUpperCase()}:${contextStr} ${message}${metaStr}`;
    }

    // Enhanced format for development
    const coloredTimestamp = `${colors.dim}${timestamp}${colors.reset}`;
    const contextStr = context ? ` ${colors.cyan}[${context}]${colors.reset}` : '';
    const coloredMessage = `${style.color}${message}${colors.reset}`;

    // Format metadata nicely
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      const formattedMeta = JSON.stringify(meta, null, 2)
        .split('\n')
        .map((line, index) => index === 0 ? line : `    ${line}`)
        .join('\n');
      metaStr = `\n  ${colors.gray}${formattedMeta}${colors.reset}`;
    }

    return `${coloredTimestamp} ${style.icon}${contextStr} ${coloredMessage}${metaStr}`;
  })
);

/**
 * JSON format for production logs
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  sanitizeErrors(),
  winston.format.json()
);

/**
 * Streaming Transport - broadcast all incoming logs to the API stream.
 */
class StreamingTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  /**
   * Log method required by Transport interface.
   * Simply calls the callback to acknowledge receipt without doing anything.
   *
   * @param _info - The log information object (unused)
   * @param callback - Callback to signal completion
   */
  log(msg: any, callback: () => void): void {
    sseManager.broadcast("log", msg);
    if (callback) callback();
  }
}

/**
 * Create and configure the logger instance
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? jsonFormat : customFormat,
  transports: [
    // Console transport with enhanced formatting
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? jsonFormat : customFormat
    }),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: jsonFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level: 'debug',
      format: jsonFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10
    }),
    // Stream to the API
    new StreamingTransport()
  ],
  exitOnError: false
});

/**
 * Create a child logger with context and optional source designation.
 * The context is automatically included in all log messages from the returned logger.
 * The source field is used for filtering logs in the web UI.
 *
 * @param context - The context identifier for this logger (e.g., component name)
 * @param source - Optional source identifier ('webui' or 'agents', defaults to 'agents')
 * @returns A Winston logger instance with the context attached
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyComponent'); // Vox agents logger (default source: 'agents')
 * const webLogger = createLogger('WebServer', 'webui'); // Web UI logger with source: 'webui'
 * logger.info('Component started'); // Logs with [MyComponent] prefix
 * ```
 */
export function createLogger(context: string, source: string = 'agents'): winston.Logger {
  return logger.child({ context, source });
}

/**
 * Log a visual separator for better readability.
 * Useful for clearly dividing sections in log output.
 *
 * @param title - Optional title to display in the separator
 * @param level - Log level to use (default: 'info')
 *
 * @example
 * ```typescript
 * logSeparator('Startup Phase');
 * // Logs: ─────── Startup Phase ───────
 * ```
 */
export function logSeparator(title?: string, level: 'info' | 'debug' = 'info'): void {
  const separator = '─'.repeat(60);
  if (title) {
    const paddedTitle = ` ${title} `;
    const totalLength = 60;
    const sideLength = Math.max(0, Math.floor((totalLength - paddedTitle.length) / 2));
    const leftSide = '─'.repeat(sideLength);
    const rightSide = '─'.repeat(totalLength - sideLength - paddedTitle.length);
    logger[level](`${leftSide}${paddedTitle}${rightSide}`);
  } else {
    logger[level](separator);
  }
}

/**
 * Log startup information with enhanced formatting.
 * Displays service name, version, environment, and optional port information.
 *
 * @param serviceName - Name of the service being started
 * @param version - Version string of the service
 * @param port - Optional port number the service will listen on
 *
 * @example
 * ```typescript
 * logStartup('Vox Agents', '1.0.0', 3000);
 * ```
 */
export function logStartup(serviceName: string, version: string, port?: number): void {
  logSeparator(`${serviceName} v${version}`, 'info');
  logger.info('🚀 Vox Deorum: LLM-Enhanced AI for Civilization V');
  if (port) {
    logger.info(`🌐 Server will listen on port ${port}`);
  }
  logger.info(`📊 Log level: ${logger.level}`);
  logger.info(`🏗️  Environment: ${process.env.NODE_ENV || 'development'}`);
  logSeparator();
}

// Log unhandled errors. Guard against duplicate registration: a normal Node import registers these
// once (modules are cached), but a test runner that isolates the module registry (vitest/vite-node)
// re-evaluates this module per test file while sharing the real `process`, which would otherwise
// stack a fresh pair of handlers each time and trip Node's MaxListenersExceededWarning. The flag
// lives on `process` — the shared object the handlers attach to — so the guard holds across
// re-evaluations. Behaviour in production (single import) is unchanged.
const GLOBAL_HANDLERS_FLAG = Symbol.for('vox.logger.globalErrorHandlersRegistered');
if (!(process as unknown as Record<symbol, boolean>)[GLOBAL_HANDLERS_FLAG]) {
  (process as unknown as Record<symbol, boolean>)[GLOBAL_HANDLERS_FLAG] = true;

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at: ' + promise?.toString() + ', reason:', reason);
  });
}

export default logger;