/**
 * Utility functions for stripping database metadata from knowledge objects
 */

import { Selectable } from 'kysely';
import { MutableKnowledge, TimedKnowledge, MaxMajorCivs, PublicKnowledge } from '../schema/base.js';

/**
 * Strip database metadata fields from a PublicKnowledge object
 * @param obj PublicKnowledge object with metadata
 * @returns PublicKnowledge object without metadata
 */
export function stripPublicKnowledgeMetadata<T extends PublicKnowledge>(obj: Partial<Selectable<T>>): Omit<Selectable<T>, 'ID' | keyof PublicKnowledge> {
  const result: any = {};

  for (const key in obj) {
    // Skip ID field
    if (key === 'ID') continue;
    result[key] = obj[key];
  }

  return result;
}

/**
 * Strip database metadata fields from a TimedKnowledge object
 * Removes auto-generated fields like ID, CreatedAt, and Player visibility fields
 * @param obj TimedKnowledge object with metadata
 * @returns TimedKnowledge object without metadata
 */
export function stripTimedKnowledgeMetadata<T extends TimedKnowledge>(obj: Partial<Selectable<T>>): Omit<Selectable<T>, 'ID' | 'CreatedAt' | keyof TimedKnowledge> {
  const result: any = {};
  
  for (const key in obj) {
    // Skip ID and CreatedAt
    if (key === 'ID' || key === 'CreatedAt') continue;
    
    // Skip Player visibility fields
    if (key.startsWith('Player') && /^Player\d+$/.test(key)) {
      const playerNum = parseInt(key.substring(6));
      if (!isNaN(playerNum) && playerNum >= 0 && playerNum < MaxMajorCivs) continue;
    }
    
    // Skip base TimedKnowledge fields
    if (key === 'Turn' || key === 'Payload') continue;
    
    result[key] = obj[key];
  }
  
  return result;
}

/**
 * Strip database metadata fields from a MutableKnowledge object
 * Reuses TimedKnowledge stripping and removes additional MutableKnowledge fields
 * @param obj MutableKnowledge object with metadata
 * @param keyFieldName Optional name to rename the Key field (e.g., 'PlayerID')
 * @returns Clean object without database metadata
 */
export function stripMutableKnowledgeMetadata<T extends MutableKnowledge>(
  obj: Partial<Selectable<T>>, 
  keyFieldName?: string
): Omit<Selectable<T>, keyof MutableKnowledge | 'ID' | 'CreatedAt' | 'Key'> {
  // First strip TimedKnowledge metadata
  const stripped = stripTimedKnowledgeMetadata(obj);
  
  // Remove MutableKnowledge-specific fields except Key
  const { Key, Version: _Version, IsLatest: _IsLatest, Changes: _Changes, ...rest } = stripped as any;
  
  // Add Key back with optional rename
  if (keyFieldName)
    rest[keyFieldName] = Key;
  
  return rest;
}