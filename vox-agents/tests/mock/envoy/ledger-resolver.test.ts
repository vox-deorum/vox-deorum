/**
 * Unit tests for the Give/Receive ledger resolver (src/envoy/utils/ledger-resolver.ts): parsing each
 * authored plain string into a directed, ID-bearing trade item / promise off the inspect-deal tradable
 * range. Covers the string grammar (fixed labels, aliases, entity names, targeted phrases, trailing
 * amounts, parenthetical menu notes), direction (Give = agent→counterpart, Receive = counterpart→agent),
 * the menu-legality gate, and the correctable error branches (unknown entry with suggestions, category
 * word without a name, targeted phrase without a target, one-vote-per-side). Pure — no game/LLM.
 */

import { describe, it, expect } from 'vitest';
import { resolveLedger, formatResolutionErrors, LEDGER_TERMS } from '../../../src/envoy/utils/ledger-resolver.js';
import { PROMISE_TYPES, PROMISE_METADATA, AGREEMENT_METADATA } from '../../../../mcp-server/dist/utils/deal-schema.js';

const AGENT = 3;
const COUNTERPART = 1;

/** A minimal side range; only the categories a test touches need rows. */
function sideRange(partial: any = {}): any {
  return {
    gold: { available: true, max: 500, reasons: [] },
    goldPerTurn: { available: true, reasons: [] },
    maps: { legal: true, reasons: [] },
    openBorders: { legal: true, reasons: [] },
    defensivePact: { legal: true, reasons: [] },
    peaceTreaty: { legal: true, reasons: [] },
    allowEmbassy: { legal: true, reasons: [] },
    declarationOfFriendship: { legal: true, reasons: [] },
    resources: [],
    cities: [],
    techs: [],
    thirdPartyPeace: [],
    thirdPartyWar: [],
    voteCommitments: [],
    ...partial,
  };
}

function resolve(give: string[], receive: string[] = [], opts: any = {}) {
  return resolveLedger({
    give,
    receive,
    agentID: AGENT,
    counterpartID: COUNTERPART,
    giveRange: opts.giveRange ?? sideRange(),
    receiveRange: opts.receiveRange ?? sideRange(),
    promiseTargets: opts.promiseTargets ?? [],
  });
}

describe('resolveLedger directions', () => {
  it('directs a Give from the agent to the counterpart', () => {
    const { items, errors } = resolve(['Gold 50']);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'GOLD', amount: 50 }]);
  });

  it('directs a Receive from the counterpart to the agent', () => {
    const { items } = resolve([], ['Open Borders']);
    expect(items).toEqual([{ fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'OPEN_BORDERS' }]);
  });

  it('normalizes label casing during resolution', () => {
    const { items, errors } = resolve(['open borders']);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'OPEN_BORDERS' }]);
  });
});

describe('resolveLedger string grammar', () => {
  it('peels a trailing amount off gold and gold per turn', () => {
    const gold = resolve(['Gold 200']);
    expect(gold.items[0]).toMatchObject({ itemType: 'GOLD', amount: 200 });
    const gpt = resolve(['Gold Per Turn 40']);
    expect(gpt.items[0]).toMatchObject({ itemType: 'GOLD_PER_TURN', amount: 40 });
  });

  it('ignores a trailing amount on a term that has no quantity', () => {
    const { items, errors } = resolve(['Open Borders 30']);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'OPEN_BORDERS' }]);
  });

  it('strips a trailing parenthetical menu note before matching a name', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items, errors } = resolve(['Iron (4 available, lasts 30 turns)'], [], { giveRange });
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ itemType: 'RESOURCES', resourceID: 7, quantity: 1 });
  });

  it('accepts a full menu-style row with an amount and a note', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items } = resolve(['Iron 2 (4 available)'], [], { giveRange });
    expect(items[0]).toMatchObject({ resourceID: 7, quantity: 2 });
  });

  it('accepts common aliases for fixed labels', () => {
    expect(resolve(['Friendship']).items[0]).toMatchObject({ itemType: 'DECLARATION_OF_FRIENDSHIP' });
    expect(resolve(['DoF']).items[0]).toMatchObject({ itemType: 'DECLARATION_OF_FRIENDSHIP' });
    expect(resolve(['Embassy']).items[0]).toMatchObject({ itemType: 'ALLOW_EMBASSY' });
  });

  it('accepts a category-word prefix in front of a name', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items, errors } = resolve(['Resource Iron 2'], [], { giveRange });
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ itemType: 'RESOURCES', resourceID: 7, quantity: 2 });
  });

  it('accepts the City / Technology / Vote Commitment category prefixes', () => {
    const giveRange = sideRange({
      cities: [{ cityID: 4, name: 'Berlin', legal: true, reasons: [] }],
      techs: [{ techID: 1, name: 'Banking', legal: true, reasons: [] }],
      voteCommitments: [{ resolutionID: 5, voteChoice: 1, numVotes: 3, repeal: false, name: 'Embargo Carthage, Yes', legal: true, reasons: [] }],
    });
    expect(resolve(['City Berlin'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'CITIES', cityID: 4 });
    expect(resolve(['Technology Banking'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'TECHS', techID: 1 });
    expect(resolve(['Vote Commitment Embargo Carthage, Yes'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'VOTE_COMMITMENT', resolutionID: 5 });
  });

  it('guides with category-scoped suggestions when a category-prefixed name is misspelled', () => {
    const giveRange = sideRange({ techs: [{ techID: 1, name: 'Banking', legal: true, reasons: [] }, { techID: 2, name: 'Sanitation', legal: true, reasons: [] }] });
    const { items, errors } = resolve(['Technology Bankng'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0].Entry).toBe('Technology Bankng');
    expect(errors[0].Problem).toContain('technology named "Bankng"');
    expect(errors[0].Suggestions).toContain('Banking');
  });

  it('forgives en-dash and curly-apostrophe slips', () => {
    const giveRange = sideRange({ thirdPartyPeace: [{ teamID: 9, name: 'Rome', legal: true, reasons: [] }] });
    // en-dash + lowercase in a targeted phrase
    expect(resolve(['third–party peace with rome'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'THIRD_PARTY_PEACE', thirdPartyTeamID: 9 });
    // curly apostrophe in a promise label
    expect(resolve(["won’t settle near you"]).promises[0]).toMatchObject({ promiseType: 'EXPANSION' });
  });
});

describe('resolveLedger by name', () => {
  it('resolves a resource by name (case-insensitive) and defaults quantity to 1', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items, errors } = resolve(['iron'], [], { giveRange });
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ itemType: 'RESOURCES', resourceID: 7, quantity: 1 });
  });

  it('uses a trailing amount as the resource quantity', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items } = resolve(['Iron 3'], [], { giveRange });
    expect(items[0]).toMatchObject({ resourceID: 7, quantity: 3 });
  });

  it('rejects a non-positive resource quantity, writing nothing', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items, errors } = resolve(['Iron 0'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0].Problem).toContain('positive');
  });

  it('caps the resource quantity to what the side holds', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items } = resolve(['Iron 99'], [], { giveRange });
    expect(items[0]).toMatchObject({ resourceID: 7, quantity: 4 });
  });

  it('resolves a city by name', () => {
    const giveRange = sideRange({ cities: [{ cityID: 4, name: 'Berlin', x: 1, y: 2, legal: true, reasons: [] }] });
    const { items } = resolve(['Berlin'], [], { giveRange });
    expect(items[0]).toMatchObject({ itemType: 'CITIES', cityID: 4 });
  });

  it('resolves a vote commitment by name and copies its counts', () => {
    const giveRange = sideRange({ voteCommitments: [{ resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo Carthage, Yes', legal: true, reasons: [] }] });
    const { items } = resolve(['Embargo Carthage, Yes'], [], { giveRange });
    expect(items[0]).toMatchObject({ itemType: 'VOTE_COMMITMENT', resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false });
  });
});

describe('resolveLedger ambiguity precedence', () => {
  it('prefers a resource over a same-named city', () => {
    const giveRange = sideRange({
      resources: [{ resourceID: 7, name: 'Amber', category: 'luxury', quantityAvailable: 2, legal: true, reasons: [] }],
      cities: [{ cityID: 4, name: 'Amber', legal: true, reasons: [] }],
    });
    expect(resolve(['Amber'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'RESOURCES', resourceID: 7 });
  });

  it('prefers a fixed label over a same-named city', () => {
    const giveRange = sideRange({ cities: [{ cityID: 9, name: 'Maps', legal: true, reasons: [] }] });
    expect(resolve(['Maps'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'MAPS' });
  });
});

describe('resolveLedger errors', () => {
  it('flags gold written without an amount', () => {
    const { items, errors } = resolve(['Gold']);
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ Side: 'Give', Entry: 'Gold' });
    expect(errors[0].Problem).toContain('amount');
  });

  it('rejects an empty entry', () => {
    const { errors } = resolve(['']);
    expect(errors[0].Problem).toContain('empty entry');
  });

  it('tells the model to name the item for a bare category word', () => {
    const { items, errors } = resolve(['Resource']);
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ Side: 'Give', Entry: 'Resource' });
    expect(errors[0].Problem).toContain('name the specific item');
  });

  it('tells the model to name a target for a bare targeted label', () => {
    const giveRange = sideRange({ thirdPartyPeace: [{ teamID: 9, name: 'Rome', legal: true, reasons: [] }] });
    const { errors } = resolve(['Third-Party Peace'], [], { giveRange });
    expect(errors[0].Problem).toContain('needs a target');
    expect(errors[0].Suggestions).toContain('Rome');
  });

  it('reports no third-party targets when the category is empty', () => {
    const { errors } = resolve(['Third-Party Peace with Rome']);
    expect(errors[0].Problem).toContain('third-party peace targets');
  });

  it('suggests the closest available name for an unrecognized entry', () => {
    const giveRange = sideRange({ techs: [{ techID: 1, name: 'Banking', legal: true, reasons: [] }, { techID: 2, name: 'Sanitation', legal: true, reasons: [] }] });
    const { items, errors } = resolve(['Bankng'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0].Entry).toBe('Bankng');
    expect(errors[0].Suggestions).toContain('Banking');
  });

  it('rejects promises the tactical AI does not honor (not in the contract)', () => {
    for (const label of [
      "Won't spread my religion to you",
      "Won't spy on you",
      "Won't bully your protected city-state",
    ]) {
      const { promises, errors } = resolve([label]);
      expect(promises).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });

  it('rejects an entry that matches no term at all', () => {
    const { items, errors } = resolve(['Free Stuff']);
    expect(items).toEqual([]);
    expect(errors[0].Entry).toBe('Free Stuff');
  });

  it('allows only one vote commitment per side', () => {
    const giveRange = sideRange({ voteCommitments: [
      { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'A', legal: true, reasons: [] },
      { resolutionID: 6, voteChoice: 1, numVotes: 12, repeal: false, name: 'B', legal: true, reasons: [] },
    ] });
    const { items, errors } = resolve(['A', 'B'], [], { giveRange });
    expect(items).toHaveLength(1);
    expect(errors[0].Problem).toContain('only one vote commitment');
  });

  it('quotes the offending entry in the corrective block', () => {
    const rendered = formatResolutionErrors([
      { Side: 'Give', Entry: 'Irn 2', Problem: 'no tradable term matches this entry.', Suggestions: ['Iron'] },
    ]);
    expect(rendered).toContain('[Give] "Irn 2"');
    expect(rendered).toContain('Did you mean: Iron?');
  });
});

describe('LEDGER_TERMS drift guards', () => {
  it('keeps the ledger promise labels in sync with the canonical PROMISE_METADATA', () => {
    // Every contract promise is authorable, so its canonical label must appear in LEDGER_TERMS.
    const ledger = new Set<string>(LEDGER_TERMS);
    for (const t of PROMISE_TYPES) {
      expect(ledger.has(PROMISE_METADATA[t].label)).toBe(true);
    }
  });

  it('keeps the ledger agreement labels in sync with the canonical AGREEMENT_METADATA', () => {
    const ledger = new Set<string>(LEDGER_TERMS);
    for (const a of AGREEMENT_METADATA) expect(ledger.has(a.label)).toBe(true);
  });
});

describe('resolveLedger mutual agreements', () => {
  it('resolves a mutual pact on one side to a single directed item (symmetrized at storage)', () => {
    const { items, errors } = resolve(['Declaration Of Friendship']);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'DECLARATION_OF_FRIENDSHIP' }]);
  });

  it('resolves a mutual pact listed on both sides to the opposite-directed pair', () => {
    const { items, errors } = resolve(['Defensive Pact'], ['Defensive Pact']);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'DEFENSIVE_PACT' },
      { fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'DEFENSIVE_PACT' },
    ]);
  });
});

describe('resolveLedger menu-legality gate', () => {
  it('rejects an off-menu term and attributes the error to it, not to a legal sibling (reported bug)', () => {
    // Un-met civs: embassy is legal (on the menu), a Declaration of Friendship is not. The model authored
    // the off-menu DoF alongside two legal embassies. The DoF must be the (only) rejected term; the
    // embassies must resolve. Previously the DoF slipped through and the game misattributed the failure.
    const giveRange = sideRange({
      declarationOfFriendship: { legal: false, reasons: ['Not tradeable under current game state'] },
    });
    const { items, errors } = resolve(
      ['Allow Embassy', 'Declaration of Friendship'],
      ['Allow Embassy'],
      { giveRange }
    );
    expect(items).toEqual([
      { fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'ALLOW_EMBASSY' },
      { fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'ALLOW_EMBASSY' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ Side: 'Give', Entry: 'Declaration of Friendship' });
    expect(errors[0].Problem).toContain('Not tradeable under current game state');
    expect(errors.some((e) => e.Entry === 'Allow Embassy')).toBe(false);
  });

  it('passes a toggle that is legal on the menu', () => {
    const { items, errors } = resolve(['Allow Embassy']);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'ALLOW_EMBASSY' }]);
  });

  it('rejects a toggle flagged illegal on the menu', () => {
    const giveRange = sideRange({ allowEmbassy: { legal: false, reasons: ['They lack the required tech'] } });
    const { items, errors } = resolve(['Allow Embassy'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ Side: 'Give', Entry: 'Allow Embassy' });
    expect(errors[0].Problem).toContain('tech');
  });

  it('rejects an optional toggle the ruleset hides from the range (absent key = not legal)', () => {
    // Default sideRange() omits researchAgreement (ruleset-hidden). Authoring it must be rejected cleanly.
    const { items, errors } = resolve(['Research Agreement']);
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ Side: 'Give', Entry: 'Research Agreement' });
  });

  it('passes an optional toggle when the range includes it as legal', () => {
    const giveRange = sideRange({ researchAgreement: { legal: true, reasons: [] } });
    const { items, errors } = resolve(['Research Agreement'], [], { giveRange });
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'RESEARCH_AGREEMENT' }]);
  });

  it('gates gold on availability', () => {
    const giveRange = sideRange({ gold: { available: false, max: 0, reasons: ['You have no gold to trade'] } });
    const { items, errors } = resolve(['Gold 50'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0].Problem).toContain('gold');
  });

  it('rejects a named candidate flagged illegal on the menu', () => {
    const giveRange = sideRange({ techs: [{ techID: 1, name: 'Banking', legal: false, reasons: ['Brokering is blocked'] }] });
    const { items, errors } = resolve(['Banking'], [], { giveRange });
    expect(items).toEqual([]);
    expect(errors[0].Problem).toContain('not available');
  });

  it('validates each authored side of a mutual pact independently (no double-report)', () => {
    const giveRange = sideRange({ defensivePact: { legal: false, reasons: ['Already allied'] } });
    const receiveRange = sideRange({ defensivePact: { legal: true, reasons: [] } });
    const { items, errors } = resolve(['Defensive Pact'], ['Defensive Pact'], { giveRange, receiveRange });
    expect(items).toEqual([{ fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'DEFENSIVE_PACT' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].Side).toBe('Give');
  });

  it('degrades to pass-through when the side range is unavailable (inspection failed)', () => {
    // Call resolveLedger directly so the undefined range is not defaulted by the test helper.
    const { items, errors } = resolveLedger({
      give: ['Allow Embassy', 'Gold 50'],
      receive: [],
      agentID: AGENT,
      counterpartID: COUNTERPART,
      giveRange: undefined,
      receiveRange: undefined,
      promiseTargets: [],
    });
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'ALLOW_EMBASSY' },
      { fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'GOLD', amount: 50 },
    ]);
  });
});

describe('resolveLedger promises', () => {
  it('emits an untargeted promise directed by side', () => {
    const { promises } = resolve([PROMISE_METADATA.MILITARY.label]);
    expect(promises[0]).toEqual({ promiserID: AGENT, recipientID: COUNTERPART, promiseType: 'MILITARY' });
  });

  it('resolves a cooperative-war target by name when eligible', () => {
    const promiseTargets = [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }];
    const { promises, errors } = resolve(['Will join a cooperative war on Rome'], [], { promiseTargets });
    expect(errors).toEqual([]);
    expect(promises[0]).toMatchObject({ promiseType: 'COOP_WAR', targetPlayerID: 9 });
  });

  it('accepts the "coop war with <civ>" alias for a cooperative war', () => {
    const promiseTargets = [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }];
    const { promises } = resolve(['coop war with Rome'], [], { promiseTargets });
    expect(promises[0]).toMatchObject({ promiseType: 'COOP_WAR', targetPlayerID: 9 });
  });

  it('rejects an ineligible cooperative-war target with suggestions', () => {
    const promiseTargets = [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: false }];
    const { promises, errors } = resolve(['Will join a cooperative war on Rome'], [], { promiseTargets });
    expect(promises).toEqual([]);
    expect(errors[0].Entry).toBe('Will join a cooperative war on Rome');
  });
});

describe('resolveLedger third-party items', () => {
  it('resolves third-party peace and war targets by name', () => {
    const giveRange = sideRange({
      thirdPartyPeace: [{ teamID: 9, name: 'Rome', legal: true, reasons: [] }],
      thirdPartyWar: [{ teamID: 8, name: 'Carthage', legal: true, reasons: [] }],
    });
    expect(resolve(['Third-Party Peace with Rome'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'THIRD_PARTY_PEACE', thirdPartyTeamID: 9 });
    expect(resolve(['War on Carthage'], [], { giveRange }).items[0]).toMatchObject({ itemType: 'THIRD_PARTY_WAR', thirdPartyTeamID: 8 });
  });
});
