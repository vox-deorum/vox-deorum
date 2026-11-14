/**
 * @module instrumentation
 *
 * OpenTelemetry instrumentation configuration for Vox Agents.
 * Sets up SQLite span processor for local observability and tracing of agent executions.
 * This module should be imported at the application entry point to enable telemetry.
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SQLiteSpanExporter } from "./agents/telemetry/sqlite-exporter.js";
import { VoxSpanExporter } from "./agents/telemetry/vox-exporter.js";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import dotenv from 'dotenv';
import { config } from "./agents/config/load.js";

dotenv.config();

/**
 * SQLite span exporter for collecting and exporting telemetry data to local databases.
 * Used to track agent executions, tool calls, and performance metrics.
 * Call `forceFlush()` before application shutdown to ensure all spans are exported.
 */
export const sqliteExporter = new SQLiteSpanExporter(config.telemetryDir || 'telemetry');

// Set the singleton instance for VoxSpanExporter
VoxSpanExporter.setInstance(sqliteExporter);

/**
 * Batch span processor for efficient span export
 */
export const spanProcessor = new BatchSpanProcessor(sqliteExporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
});

/**
 * OpenTelemetry tracer provider configured with SQLite processor.
 * Automatically registers itself to capture spans from instrumented code.
 */
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [spanProcessor],
});

tracerProvider.register();
