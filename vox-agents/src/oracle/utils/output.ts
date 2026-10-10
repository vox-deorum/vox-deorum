/**
 * @module oracle/utils/output
 *
 * Output helpers for Oracle experiments: CSV writing, trail writing, path resolution.
 */

import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { jsonToMarkdown } from '../../utils/tools/json-to-markdown.js';
import { isRecord } from '../../utils/guards.js';
import type { OracleRow, ReplayResult } from '../types.js';

/** Resolve a path that may be relative or absolute */
export function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/**
 * Write the output CSV from replay results.
 * Extracts replayRationale from strategist decision tool args.
 */
export function writeCsv(outputPath: string, results: ReplayResult[]): void {
  const decisionTools = ['set-flavors', 'set-strategy', 'keep-status-quo'];
  const csvRows = results.map(r => {
    const { rationale, ...rest } = r.row;
    const replayRationale = r.decisions.find(d => decisionTools.includes(d.toolName))?.rationale ?? '';
    return {
      ...rest,
      originalRationale: rationale,
      model: r.model,
      replayRationale,
      input_tokens: r.tokens.inputTokens,
      reasoning_tokens: r.tokens.reasoningTokens,
      output_tokens: r.tokens.outputTokens,
      ...(r.error ? { error: r.error } : {}),
      ...(r.repetition !== undefined ? { repetition: r.repetition } : {}),
      ...(r.extractedColumns ?? {}),
    };
  });

  // Papa.unparse infers columns from the first row only; collect all keys so
  // columns introduced by later rows (e.g. extractedColumns after a cache miss)
  // are not silently dropped.
  const fields = [...new Set(csvRows.flatMap(r => Object.keys(r)))];
  fs.writeFileSync(outputPath, Papa.unparse({ fields, data: csvRows }), 'utf-8');
}

/** Build the stable base filename used for replay trails and cache lookups. */
export function getTrailBase(
  row: Pick<OracleRow, 'game_id' | 'player_id' | 'turn'>,
  trailSuffix: string
): string {
  const turn = parseInt(row.turn, 10);
  return `${row.game_id}-p${row.player_id}-t${turn}${trailSuffix}`;
}

/** Resolve the JSON and markdown trail paths for a replay trail. */
export function getTrailPaths(experimentDir: string, trailBase: string): { jsonPath: string; mdPath: string } {
  return {
    jsonPath: path.join(experimentDir, `${trailBase}.json`),
    mdPath: path.join(experimentDir, `${trailBase}.md`),
  };
}

/**
 * Read a cached ReplayResult from an existing oracle trail JSON.
 *
 * The trail is the source of truth for cache hits; optional fields are defaulted
 * so older trails can still be reused when they contain the core replay payload.
 */
export function readReplayCache(jsonPath: string): ReplayResult {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as unknown;
  const trail = requireRecord(data, 'Oracle replay cache must be a JSON object');
  const replay = requireRecord(trail.replay, 'Oracle replay cache is missing replay data');

  if (!isRecord(trail.row)) {
    throw new Error('Oracle replay cache is missing row data');
  }
  if (typeof trail.model !== 'string') {
    throw new Error('Oracle replay cache is missing model data');
  }

  const modifications = isRecord(trail.modifications) ? trail.modifications : undefined;
  const result: ReplayResult = {
    row: trail.row as OracleRow,
    model: trail.model,
    decisions: Array.isArray(replay.decisions) ? replay.decisions : [],
    tokens: normalizeTokens(replay.tokens),
    messages: Array.isArray(replay.messages) ? replay.messages : [],
  };

  if (modifications && modifications.metadata !== undefined) {
    result.metadata = modifications.metadata as Record<string, any>;
  }
  if (isRecord(trail.extractedColumns)) {
    result.extractedColumns = trail.extractedColumns;
  }
  if (typeof trail.error === 'string') {
    result.error = trail.error;
  }

  return result;
}

function normalizeTokens(tokens: unknown): ReplayResult['tokens'] {
  const raw = isRecord(tokens) ? tokens : {};
  return {
    inputTokens: numberOrZero(raw.inputTokens),
    reasoningTokens: numberOrZero(raw.reasoningTokens),
    outputTokens: numberOrZero(raw.outputTokens),
  };
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Return the value as a record, or throw with the given message when it is not one. */
function requireRecord(value: unknown, message: string): Record<string, any> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

/**
 * Write JSON and markdown trail files for a single replayed row.
 *
 * @param experimentDir - Directory where trails are written
 * @param trailBase - File base name without extension (e.g. "game123-p1-t30" or "game123-p1-t30-ModelName")
 * @param data - Trail payload object
 */
export function writeTrail(experimentDir: string, trailBase: string, data: object): void {
  const { jsonPath, mdPath } = getTrailPaths(experimentDir, trailBase);

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(mdPath, jsonToMarkdown(data, { startingLevel: 1 }));
}
