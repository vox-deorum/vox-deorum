/**
 * Shared diplomacy fixtures for mock-tier tests: a stored transcript row with neutral defaults and an
 * empty inspect-deal side range. Tests override only the fields their scenario depends on.
 */

import type { TranscriptMessage } from '../../src/utils/diplomacy/transcript/transcript-utils.js';
import type { NormalizedSideRange } from '../../../mcp-server/dist/tools/knowledge/inspect-deal.js';

/** A stored transcript row for the ordered pair 1↔3 with neutral defaults; override any field. */
export function transcriptRow(over: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    ID: 1,
    Player1ID: 1,
    Player2ID: 3,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: 1,
    MessageType: 'text',
    Content: '',
    Payload: {},
    Turn: 1,
    CreatedAt: 0,
    ...over,
  };
}

/** An empty tradable side range for inspect-deal fixtures: nothing available, no legal items. */
export function emptySideRange(): NormalizedSideRange {
  return {
    gold: { available: false, max: 0, reasons: [] },
    goldPerTurn: { available: false, reasons: [] },
    resources: [], cities: [], techs: [], thirdPartyPeace: [], thirdPartyWar: [], voteCommitments: [],
    maps: { legal: false, reasons: [] },
    allowEmbassy: { legal: false, reasons: [] },
    openBorders: { legal: false, reasons: [] },
    declarationOfFriendship: { legal: false, reasons: [] },
    defensivePact: { legal: false, reasons: [] },
    researchAgreement: { legal: false, reasons: [] },
    peaceTreaty: { legal: false, reasons: [] },
    vassalage: { legal: false, reasons: [] },
    vassalageRevoke: { legal: false, reasons: [] },
  };
}
