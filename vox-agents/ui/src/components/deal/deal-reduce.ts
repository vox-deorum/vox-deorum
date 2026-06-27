/**
 * Client-side deal-state reduction (interactive-diplomacy stage 4, work item 4).
 *
 * The reduction logic lives once in the backend reducer (`@vox/utils/diplomacy/deal-reduce`); here we
 * re-export its generic `deriveActiveProposal` directly (it infers the message type from the caller's
 * `DealTranscriptMessage[]`) and pin the `DealReduction` type to the UI's typed transcript message so
 * `.active.Payload.Deal` stays typed for consumers. The backend reducer's only imports are type-only,
 * so nothing server-side leaks into the browser bundle.
 */

import type { DealTranscriptMessage } from '@/utils/types';
import type { DealReduction as DealReductionOf } from '@vox/utils/diplomacy/deal-reduce';

export { deriveActiveProposal } from '@vox/utils/diplomacy/deal-reduce';
export type { DealStatus } from '@vox/utils/diplomacy/deal-reduce';

/** Deal reduction specialized to the UI's typed transcript message. */
export type DealReduction = DealReductionOf<DealTranscriptMessage>;
