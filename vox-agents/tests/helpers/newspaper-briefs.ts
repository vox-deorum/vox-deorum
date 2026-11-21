import type { NewspaperEvidence, NewspaperEvent } from '../../../mcp-server/dist/newspaper/evidence.js';
import { editorialConfigSchema, type EditorialConfig } from '../../src/newspaper/editorial/config/schema.js';

export const editionBriefRule = {
  id: 'fixture-edition-brief', subject: 'event', event: 'PlayerAdoptPolicyBranch',
  when: 'event.branch?.startsWith("Fixture brief ")', importance: 1,
};

export const editionBriefTemplate = {
  id: editionBriefRule.id, triggers: [editionBriefRule.id], tags: [], weight: { base: 1 },
  variants: [{ id: 'fixture-brief', headline: 'Council brief', body: ['The council reviewed its agenda.'], weight: { base: 1 } }],
};

/** Add low-priority, unrelated reports for a test that needs to print the story under test. */
export function withEditionBriefs(evidence: NewspaperEvidence, config: EditorialConfig, count = 4) {
  const turn = evidence.request.cutoffTurn;
  const briefs: NewspaperEvent[] = Array.from({ length: count }, (_, index) => {
    const id = 90_000 + 10 * turn + index;
    return { type: editionBriefRule.event, values: { PlayerID: evidence.request.receiverPlayerID, Branch: `Fixture brief ${id}` },
      source: { table: 'GameEvents', id, turn, createdAt: id } };
  });
  return {
    evidence: { ...evidence, events: [...evidence.events, ...briefs] },
    config: editorialConfigSchema.parse({
      ...config, triggers: [...config.triggers, editionBriefRule], templates: [...config.templates, editionBriefTemplate],
    }),
  };
}
