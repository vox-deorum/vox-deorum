/**
 * @module utils/logger
 * @description Winston logger configuration for the MCP Server
 *
 * Provides a centralized logging infrastructure with:
 * - Colored console output for development
 * - JSON format for production logs
 * - File-based persistence with rotation
 * - Context-aware child loggers
 * - Visual separators and startup banners
 *
 * @example
 * ```typescript
 * import { createLogger } from './utils/logger.js';
 *
 * const logger = createLogger('MyComponent');
 * logger.info('Application started');
 * logger.error('Operation failed', { error: err });
 * ```
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * ANSI color codes for terminal styling
 * Used to colorize log output in development mode
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
 * Get level-specific styling for log messages
 *
 * Returns color, background color, and icon for a given log level.
 *
 * @param level - The log level (error, warn, info, debug)
 * @returns Styling object with color, background, and icon properties
 */
const getLevelStyle = (level: string) => {
  const upperLevel = level.toUpperCase();
  switch (upperLevel) {
    case 'ERROR':
      return {
        color: colors.red,
        bg: colors.bgRed,
        icon: '❌',
      };
    case 'WARN':
      return {
        color: colors.yellow,
        bg: colors.bgYellow,
        icon: '⚠️ ',
      };
    case 'INFO':
      return {
        color: colors.blue,
        bg: colors.bgBlue,
        icon: 'ℹ️ ',
      };
    case 'DEBUG':
      return {
        color: colors.gray,
        bg: colors.gray,
        icon: '🔍',
      };
    default:
      return {
        color: colors.white,
        bg: colors.white,
        icon: '📝',
      };
  }
};

/**
 * Enhanced custom log format with improved visual formatting and colors
 *
 * Provides colorized console output in development mode with:
 * - Timestamps with millisecond precision
 * - Color-coded log levels with icons
 * - Context information in brackets
 * - Pretty-printed metadata objects
 * - Simplified format for production
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
    const style = getLevelStyle(level);
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Simplified format for production
    if (isProduction) {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      const contextStr = context ? ` [${context}]` : '';
      return `[${timestamp}] ${level.toUpperCase()}:${contextStr} ${message}${metaStr}`;
    }
    
    // Enhanced format for development
    const coloredTimestamp = `${colors.dim}${timestamp}${colors.reset}`;
    const coloredLevel = `${colors.bright}${style.color}${colors.reset}`;
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
    
    return `${coloredTimestamp} ${coloredLevel}${style.icon}${contextStr} ${coloredMessage}${metaStr}`;
  })
);

/**
 * JSON format for production logs
 *
 * Structured logging format suitable for log aggregation and analysis tools.
 * Includes timestamps, error stack traces, and all metadata.
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * The root Winston logger instance
 *
 * Configured with:
 * - Console transport for immediate feedback
 * - File transport for error logs (10MB, 5 files)
 * - File transport for combined logs (10MB, 10 files)
 * - Log level from LOG_LEVEL environment variable (default: info)
 * - Format based on NODE_ENV (development uses colors, production uses JSON)
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
    })
  ],
  exitOnError: false
});

/**
 * Create a child logger with context
 *
 * Creates a Winston child logger that automatically includes a context identifier
 * in all log messages, making it easier to trace log messages to their source.
 *
 * @param context - The context identifier (e.g., component name, module name)
 * @returns A Winston logger instance with the context attached
 *
 * @example
 * ```typescript
 * const logger = createLogger('DatabaseManager');
 * logger.info('Connection established'); // [DatabaseManager] Connection established
 * ```
 */
export function createLogger(context: string): winston.Logger {
  return logger.child({ context });
}

/**
 * Log a visual separator for better readability
 *
 * Outputs a horizontal line separator, optionally with a centered title.
 * Useful for visually grouping related log messages.
 *
 * @param title - Optional title to center in the separator
 * @param level - Log level to use (info or debug), defaults to info
 *
 * @example
 * ```typescript
 * logSeparator('Initialization'); // ─────── Initialization ───────
 * logSeparator();                 // ────────────────────────────────
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
 * Log startup information with enhanced formatting
 *
 * Displays a formatted startup banner with service information including
 * name, version, port, log level, and environment.
 *
 * @param serviceName - The name of the service being started
 * @param version - The version number of the service
 * @param port - Optional port number the service will listen on
 *
 * @example
 * ```typescript
 * logStartup('MCP Server', '1.0.0', 3000);
 * // ──────── MCP Server v1.0.0 ────────
 * // 🚀 Service starting up...
 * // 🌐 Server will listen on port 3000
 * // 📊 Log level: info
 * // 🏗️  Environment: development
 * // ────────────────────────────────────
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

// Log unhandled errors here because this service's index.ts does not own crash handling
// (unlike bridge-service, whose index.ts registers its own handlers and graceful shutdown).
// Guard against duplicate registration: a normal Node import registers these
// once (modules are cached), but a test runner that isolates the module registry (vitest/vite-node)
// re-evaluates this module per test file while sharing the real `process`, which would otherwise
// stack a fresh pair of handlers each time and trip Node's MaxListenersExceededWarning. The flag
// lives on `process`, the shared object the handlers attach to, so the guard holds across
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