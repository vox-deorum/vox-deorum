/**
 * @module archivist/pipeline/embeddings
 *
 * Generates abstract embeddings for episodes using the configured embedding model.
 * Handles batching, dimension trimming, and graceful degradation on failure.
 */

import { embedMany } from 'ai';
import { createLogger } from '../../utils/logger.js';
import { getModelConfig } from '../../agents/models/models.js';
import { getEmbeddingModel } from '../../agents/models/models.js';

const logger = createLogger('Archivist:Embeddings');

/**
 * Generate embeddings for an array of abstract texts.
 * Null entries in the input are preserved as null in the output.
 * On failure, returns all nulls (graceful degradation).
 *
 * @param abstracts - Array of abstract texts (null entries are skipped)
 * @returns Array of embedding vectors (or null) matching input positions
 */
export async function generateEmbeddings(
  abstracts: (string | null)[]
): Promise<(number[] | null)[]> {
  // Resolve embedding model config
  const modelConfig = getModelConfig('embedder');
  const embeddingSize = modelConfig.options?.embeddingSize;

  // Collect non-null texts with their original indices
  const texts: string[] = [];
  const indices: number[] = [];
  for (let i = 0; i < abstracts.length; i++) {
    if (abstracts[i] != null) {
      texts.push(abstracts[i]!);
      indices.push(i);
    }
  }

  if (texts.length === 0) {
    return abstracts.map(() => null);
  }

  logger.info(`Generating embeddings for ${texts.length} abstracts using ${modelConfig.provider}/${modelConfig.name}`);

  try {
    const model = getEmbeddingModel(modelConfig);
    const { embeddings } = await embedMany({
      model,
      values: texts,
      maxRetries: 3,
    });

    // Build result array, mapping embeddings back to original positions
    const result: (number[] | null)[] = new Array(abstracts.length).fill(null);
    for (let i = 0; i < indices.length; i++) {
      let embedding = embeddings[i];

      // Trim to target dimension if actual is larger
      if (embeddingSize && embedding.length > embeddingSize) {
        embedding = embedding.slice(0, embeddingSize);
      }

      result[indices[i]] = embedding;
    }

    logger.info(`Generated ${embeddings.length} embeddings (dim=${embeddings[0]?.length ?? 0}${embeddingSize ? `, trimmed to ${embeddingSize}` : ''})`);
    return result;
  } catch (err) {
    logger.error('Failed to generate embeddings, returning nulls', {
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return abstracts.map(() => null);
  }
}
