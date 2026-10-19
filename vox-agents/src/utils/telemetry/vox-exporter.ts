/**
 * @module utils/telemetry/vox-exporter
 *
 * Abstract base class for Vox-specific span exporters.
 * Provides a singleton interface for managing context-specific telemetry data
 * with support for graceful shutdown and resource cleanup.
 */

import { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResult } from '@opentelemetry/core';

/**
 * Abstract base class for Vox span exporters.
 * Manages context-specific telemetry data with singleton pattern.
 * Subclasses must implement the core export functionality and context management.
 */
export abstract class VoxSpanExporter implements SpanExporter {
  private static instance: VoxSpanExporter | null = null;

  /**
   * Get the singleton instance of the VoxSpanExporter.
   * Must be initialized before use.
   */
  public static getInstance(): VoxSpanExporter {
    if (!VoxSpanExporter.instance) {
      throw new Error('VoxSpanExporter not initialized. Call setInstance() first.');
    }
    return VoxSpanExporter.instance;
  }

  /**
   * Set the singleton instance of the VoxSpanExporter.
   * Should be called during instrumentation setup.
   */
  public static setInstance(exporter: VoxSpanExporter): void {
    VoxSpanExporter.instance = exporter;
  }

  /**
   * Export spans to the underlying storage.
   * Must be implemented by subclasses.
   */
  abstract export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): Promise<void>;

  /**
   * Force flush all pending spans.
   * Must be implemented by subclasses.
   */
  abstract forceFlush(): Promise<void>;

  /**
   * Shutdown the exporter completely.
   * Closes all resources and cleans up.
   * Must be implemented by subclasses.
   */
  abstract shutdown(): Promise<void>;

  /**
   * Create a context with a specific folder for its telemetry data.
   * Allows overriding the default folder structure for a context's database.
   * Must be implemented by subclasses.
   *
   * @param contextId - The ID of the context to create
   * @param folder - The folder path where the telemetry database should be created
   */
  abstract createContext(contextId: string, folder: string): Promise<void>;

  /**
   * Close resources for a specific context.
   * Called when a VoxContext is shut down.
   * Must be implemented by subclasses.
   *
   * @param contextId - The ID of the context to close
   */
  abstract closeContext(contextId: string): Promise<void>;

  /**
   * Get database or storage handle for a specific context.
   * Optional method for exporters that expose their storage.
   *
   * @param contextId - The ID of the context
   * @returns The storage handle, or undefined if not applicable
   */
  abstract getDatabase?(contextId: string): unknown;

  /**
   * The file that holds a context's telemetry, for exporters that write one file per context.
   * Seat stores share this file so a game's records travel with its spans.
   *
   * @param contextId - The ID of the context
   * @returns The file path, or undefined if not applicable
   */
  abstract getDatabasePath?(contextId: string): string | undefined;
}
