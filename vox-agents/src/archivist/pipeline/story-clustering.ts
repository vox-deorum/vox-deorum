/**
 * @module archivist/pipeline/story-clustering
 *
 * Reads saved story pitches from the episode database, groups them by embedding
 * similarity, and renders the Markdown cluster report used before backlog sorting.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { cosineSimilarity } from '../utils/similarity.js';

export const defaultClusteringThreshold = 0.8;

/** Absorbs centroid rounding so an identical vector still meets an inclusive threshold. */
const similarityTolerance = 1e-12;

/** Most examples shown for one cluster. */
const exampleLimit = 3;

/** One saved pitch, including the embedding of its headline and pitch. */
export interface StoryPitchRow {
  gameId: string;
  playerId: number;
  turn: number;
  model: string;
  pitchIndex: number;
  civilization: string;
  era: string;
  headline: string;
  pitch: string;
  embedding: number[] | null;
  createdAt: string;
}

/** One greedy cluster and its running centroid direction. */
export interface PitchCluster {
  creationIndex: number;
  members: StoryPitchRow[];
  centroid: number[];
}

/** Clustering totals and the clusters in creation order. */
export interface StoryClustering {
  rowsRead: number;
  clustered: number;
  skipped: number;
  threshold: number;
  mostRecentCreatedAt: string | null;
  clusters: PitchCluster[];
}

/**
 * Read every saved pitch in primary-key order from a DuckDB database.
 * Opens the database read-only and always releases the connection and instance.
 */
export async function readStoryPitches(dbPath: string): Promise<StoryPitchRow[]> {
  let instance: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  try {
    instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
    connection = await instance.connect();
    const result = await connection.runAndReadAll(`
      SELECT game_id, player_id, turn, model, pitch_index, civilization, era,
             headline, pitch, embedding, CAST(created_at AS VARCHAR) AS created_at
      FROM story_pitches
      ORDER BY game_id, player_id, turn, model, pitch_index
    `);
    return result.getRowObjectsJS().map(row => ({
      gameId: String(row.game_id),
      playerId: Number(row.player_id),
      turn: Number(row.turn),
      model: String(row.model),
      pitchIndex: Number(row.pitch_index),
      civilization: String(row.civilization),
      era: String(row.era),
      headline: String(row.headline),
      pitch: String(row.pitch),
      embedding: Array.isArray(row.embedding) ? row.embedding as number[] : null,
      createdAt: String(row.created_at),
    }));
  } finally {
    connection?.disconnectSync();
    instance?.closeSync();
  }
}

/**
 * Convert an embedding to a unit vector, or return null when the pitch cannot
 * be clustered. Null, empty, non-finite, and zero-magnitude vectors are skipped.
 */
function unitVector(embedding: unknown): number[] | null {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const values: number[] = [];
  let squaredMagnitude = 0;
  for (const value of embedding) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    values.push(value);
    squaredMagnitude += value * value;
  }
  const magnitude = Math.sqrt(squaredMagnitude);
  if (magnitude === 0) return null;
  return values.map(value => value / magnitude);
}

/** Describe dimension counts for the mixed-embedding error. */
function formatDimensionCounts(counts: Map<number, number>): string {
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([dimensions, count]) => `${dimensions} dimensions: ${count}`)
    .join(', ');
}

/** Return the newest saved pitch timestamp, using the database's timestamp text order. */
function newestTimestamp(rows: StoryPitchRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (row.createdAt && (newest === null || row.createdAt > newest)) {
      newest = row.createdAt;
    }
  }
  return newest;
}

/**
 * Group pitches greedily in query order. Each pitch joins the first cluster
 * whose running center is at least this similar, or starts a new cluster.
 */
export function clusterStoryPitches(rows: StoryPitchRow[], threshold: number): StoryClustering {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Clustering threshold must be a finite number between 0 and 1.');
  }

  const dimensionCounts = new Map<number, number>();
  const usable: Array<{ row: StoryPitchRow; unit: number[] }> = [];
  let skipped = 0;

  for (const row of rows) {
    const unit = unitVector(row.embedding);
    if (!unit) {
      skipped++;
      continue;
    }
    usable.push({ row, unit });
    dimensionCounts.set(unit.length, (dimensionCounts.get(unit.length) ?? 0) + 1);
  }

  if (rows.length === 0) {
    throw new Error('No story pitches found. Run story mining before clustering.');
  }
  if (usable.length === 0) {
    throw new Error('No usable story pitch embeddings. Configure an embedder and re-run story mining with embeddings enabled.');
  }
  if (dimensionCounts.size > 1) {
    throw new Error(
      `Story pitch embeddings have mixed dimensions (${formatDimensionCounts(dimensionCounts)}). ` +
      'Use one embedder for every pitch before clustering.',
    );
  }

  const clusters: PitchCluster[] = [];
  for (const { row, unit } of usable) {
    const cluster = clusters.find(candidate =>
      cosineSimilarity(unit, candidate.centroid) >= threshold - similarityTolerance
    );
    if (cluster) {
      cluster.members.push(row);
      for (let i = 0; i < unit.length; i++) {
        cluster.centroid[i] += unit[i];
      }
    } else {
      clusters.push({ creationIndex: clusters.length, members: [row], centroid: [...unit] });
    }
  }

  return {
    rowsRead: rows.length,
    clustered: usable.length,
    skipped,
    threshold,
    mostRecentCreatedAt: newestTimestamp(rows),
    clusters,
  };
}

/**
 * Pick up to three examples: the first member, then members from models not
 * yet shown, then members from games not yet shown, then the remaining keys.
 */
export function selectClusterExamples(members: StoryPitchRow[]): StoryPitchRow[] {
  if (members.length <= exampleLimit) return [...members];

  const selected: StoryPitchRow[] = [members[0]];
  const selectedRows = new Set<StoryPitchRow>([members[0]]);
  const selectedModels = new Set([members[0].model]);
  const selectedGames = new Set([members[0].gameId]);

  /** Add the first unselected member that matches the preference, if any. */
  function addPreferred(matches: (member: StoryPitchRow) => boolean): boolean {
    const member = members.find(candidate => !selectedRows.has(candidate) && matches(candidate));
    if (!member) return false;
    selected.push(member);
    selectedRows.add(member);
    selectedModels.add(member.model);
    selectedGames.add(member.gameId);
    return true;
  }

  while (selected.length < exampleLimit && addPreferred(member => !selectedModels.has(member.model))) {
    // Fill the remaining slots with new models first.
  }
  while (selected.length < exampleLimit && addPreferred(member => !selectedGames.has(member.gameId))) {
    // Then prefer new games.
  }
  while (selected.length < exampleLimit && addPreferred(() => true)) {
    // Fill any remaining slots in stable key order.
  }

  return selected;
}

/** Escape generated text so HTML and inline Markdown render literally. */
export function escapeInlineMarkdown(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]~]/g, '\\$&');
}

/** Render the clustering totals and each cluster as Markdown lists. */
export function renderStoryClusters(clustering: StoryClustering): string {
  const ordered = [...clustering.clusters].sort((left, right) =>
    right.members.length - left.members.length || left.creationIndex - right.creationIndex
  );
  const lines = [
    '# Story pitch clusters',
    '',
    `- Rows read: ${clustering.rowsRead}`,
    `- Clustered: ${clustering.clustered}`,
    `- Skipped: ${clustering.skipped}`,
    `- Threshold: ${clustering.threshold}`,
    `- Most recent saved pitch: ${clustering.mostRecentCreatedAt ?? 'none'}`,
    `- Clusters: ${clustering.clusters.length}`,
    '',
  ];

  ordered.forEach((cluster, index) => {
    const models = new Set(cluster.members.map(member => member.model)).size;
    const eras = new Set(cluster.members.map(member => member.era)).size;
    lines.push(`## Cluster ${index + 1} (${cluster.members.length} ${cluster.members.length === 1 ? 'pitch' : 'pitches'})`, '');
    lines.push(`- Distinct models: ${models}`);
    lines.push(`- Distinct eras: ${eras}`, '');
    for (const example of selectClusterExamples(cluster.members)) {
      const provenance = `${example.gameId}/${example.playerId}/${example.turn}`;
      lines.push(
        `- **${escapeInlineMarkdown(example.headline)}** ` +
        `(${escapeInlineMarkdown(example.model)}, ${escapeInlineMarkdown(example.era)}, ` +
        `${escapeInlineMarkdown(example.civilization)}; ${escapeInlineMarkdown(provenance)})`,
      );
      lines.push(`  Pitch: ${escapeInlineMarkdown(example.pitch)}`);
    }
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}
