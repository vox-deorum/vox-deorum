/**
 * Type definitions for the Vox Agents UI
 * Re-exports shared types from the backend and adds UI-specific types
 */

// Re-export all shared types from the backend source tree
export * from '../../../src/types/index';

import type { DealTranscriptMessage } from '../../../src/types/index';
import type {
  DealReduction as DealReductionOf,
  ProposalOutcome as ProposalOutcomeOf,
} from '@vox/diplomacy/deal/deal-reduce';

/** UI-specialized reduction for the typed deal transcript. */
export type DealReduction = DealReductionOf<DealTranscriptMessage>;

/** UI-specialized per-proposal outcome for the typed deal transcript. */
export type ProposalOutcome = ProposalOutcomeOf<DealTranscriptMessage>;

// UI-specific type extensions can be added here if needed in the future

/** Shared label and value shape for select controls. */
export type SelectOption<T = string> = { label: string; value: T; description?: string };

/** Mode used when opening the session configuration dialog. */
export type ConfigDialogMode = 'add' | 'edit' | 'duplicate';
