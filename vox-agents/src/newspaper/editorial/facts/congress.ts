/** Build the shared World Congress agenda into readable game facts. */
import type {
  NewspaperCongressProposal,
  NewspaperCongressResolution,
  NewspaperEvidence,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { uniqueSources } from '../shared/sources.js';
import { fact, type FactField, type FactObject } from './model.js';

/** Compare proposals by the direction they would move the resolution and their recorded name. */
function proposalKey(proposal: NewspaperCongressProposal): string {
  return `${proposal.isEnact ? 'enact' : 'repeal'}/${proposal.name}`;
}

/** Expose one proposal with the observation rows that support it. */
function proposalFields(
  proposal: NewspaperCongressProposal,
  sources: readonly NewspaperSourceReference[],
  observedTurn?: number
): FactObject {
  const fields: Record<string, FactField> = {
    name: fact(proposal.name, sources),
    isEnact: fact(proposal.isEnact, sources),
  };
  if (proposal.proposer !== undefined) fields.proposer = fact(proposal.proposer, sources);
  if (proposal.description !== undefined) fields.description = fact(proposal.description, sources);
  if (observedTurn !== undefined) fields.observedTurn = fact(observedTurn, sources);
  return fields;
}

/** Expose one active resolution with its recorded terms. */
function resolutionFields(resolution: NewspaperCongressResolution, sources: readonly NewspaperSourceReference[]): FactObject {
  const fields: Record<string, FactField> = { name: fact(resolution.name, sources) };
  if (resolution.description !== undefined) fields.description = fact(resolution.description, sources);
  if (resolution.enactedTurn !== undefined) fields.enactedTurn = fact(resolution.enactedTurn, sources);
  return fields;
}

/** Build game.congress from the newest known observation and the proposals first seen in this window. */
export function buildCongressFact(evidence: NewspaperEvidence, cutoffTurn: number): FactField | undefined {
  const congress = evidence.congress;
  if (!congress) return undefined;
  const previous = evidence.request.previousCheckTurn;
  const observations = [...congress.observations]
    .filter(observation => observation.source.turn > previous && observation.source.turn <= cutoffTurn)
    .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
  const baseline = congress.baseline && congress.baseline.source.turn <= previous ? congress.baseline : undefined;
  const latest = observations.at(-1) ?? baseline;
  if (!latest) return undefined;

  const newProposals: FactObject[] = [];
  const newSources: NewspaperSourceReference[] = [];
  // Report each new entry once per window, even if it drops off and returns.
  const seen = new Set<string>();
  let priorAgenda = new Set((baseline?.proposals ?? []).map(proposalKey));
  let priorSource = baseline?.proposals ? baseline.source : undefined;
  for (const observation of observations) {
    const proposals = observation.available ? observation.proposals : [];
    if (!proposals) continue;
    const sources = priorSource ? [priorSource, observation.source] : [observation.source];
    for (const proposal of proposals) {
      const key = proposalKey(proposal);
      if (priorAgenda.has(key) || seen.has(key)) continue;
      seen.add(key);
      newProposals.push(proposalFields(proposal, sources, observation.source.turn));
      newSources.push(...sources);
    }
    priorAgenda = new Set(proposals.map(proposalKey));
    priorSource = observation.source;
  }

  const latestSources = [latest.source];
  const fields: Record<string, FactField> = {
    available: fact(latest.available, latestSources),
    observedTurn: fact(latest.source.turn, latestSources),
    // An older observation cannot describe what the league is doing at the cutoff.
    votingNow: fact(latest.available && latest.source.turn === cutoffTurn && latest.votingNow, latestSources),
  };
  if (latest.league !== undefined) fields.league = fact(latest.league, latestSources);
  if (latest.available && latest.expectedSessionTurn !== undefined && latest.expectedSessionTurn >= cutoffTurn)
    fields.expectedSessionTurn = fact(latest.expectedSessionTurn, latestSources);
  if (latest.available && latest.diplomaticVictoryVotesNeeded !== undefined)
    fields.diplomaticVictoryVotesNeeded = fact(latest.diplomaticVictoryVotesNeeded, latestSources);
  const proposals = latest.available ? latest.proposals : [];
  const activeResolutions = latest.available ? latest.activeResolutions : [];
  if (proposals) fields.proposals = fact(proposals.map(proposal => proposalFields(proposal, latestSources)), latestSources);
  if (activeResolutions) fields.activeResolutions = fact(
    activeResolutions.map(resolution => resolutionFields(resolution, latestSources)), latestSources
  );
  fields.newProposals = fact(newProposals, uniqueSources(newSources.length ? newSources : latestSources));
  return fact(fields, latestSources);
}
