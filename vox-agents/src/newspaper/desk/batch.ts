/** Shared batch rules for the Writing Desk and its API. */
import type { DeskRef, DeskStyle } from '../../types/api.js';

/** Variants of the same style included in each model request. */
export const deskChunkSize = 8;
/** Choices requested per variant from each model. */
export const deskChoicesLimit = 30;

/** Address a variant without assuming its ID is unique across files. */
export function deskRefKey(ref: DeskRef): string {
  return JSON.stringify([ref.templateId, ref.variantId]);
}

/** Group like styles and split each group into model requests. */
export function chunkDeskVariants<T extends { style: DeskStyle }>(variants: readonly T[], size = deskChunkSize): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('The desk chunk size must be a positive integer.');
  const groups = new Map<string, T[]>();
  for (const variant of variants) {
    const { voice, stance, genre } = variant.style;
    const key = JSON.stringify([voice, stance, genre]);
    const group = groups.get(key) ?? [];
    group.push(variant);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    const chunks: T[][] = [];
    for (let index = 0; index < group.length; index += size) chunks.push(group.slice(index, index + size));
    return chunks;
  });
}
