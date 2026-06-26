/**
 * Unit tests for the Give/Take ledger resolver (src/envoy/utils/ledger-resolver.ts): name→ID
 * resolution off the inspect-deal tradable range, direction (Give = agent→counterpart, Take =
 * counterpart→agent), and the correctable error branches (missing amount/name, unknown name with
 * suggestions, empty category, one-vote-per-side, targeted-promise eligibility). Pure — no game/LLM.
 */

import { describe, it, expect } from 'vitest';
import { resolveLedger, LedgerTermSchema, type LedgerTerm } from '../../../src/envoy/utils/ledger-resolver.js';

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

function resolve(give: LedgerTerm[], take: LedgerTerm[] = [], opts: any = {}) {
  return resolveLedger({
    give,
    take,
    agentID: AGENT,
    counterpartID: COUNTERPART,
    giveRange: opts.giveRange ?? sideRange(),
    takeRange: opts.takeRange ?? sideRange(),
    promiseTargets: opts.promiseTargets ?? [],
  });
}

describe('resolveLedger directions', () => {
  it('directs a Give from the agent to the counterpart', () => {
    const { items, errors } = resolve([{ Term: 'Gold', Amount: 50 }]);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'GOLD', amount: 50 }]);
  });

  it('directs a Take from the counterpart to the agent', () => {
    const { items } = resolve([], [{ Term: 'Open Borders' }]);
    expect(items).toEqual([{ fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'OPEN_BORDERS' }]);
  });

  it('normalizes term labels during direct resolution', () => {
    const { items, errors } = resolve([{ Term: 'open borders' } as LedgerTerm]);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'OPEN_BORDERS' }]);
  });
});

describe('resolveLedger by name', () => {
  it('resolves a resource by name (case-insensitive) and defaults quantity to 1', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items, errors } = resolve([{ Term: 'Resource', Name: 'iron' }], [], { giveRange });
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ itemType: 'RESOURCES', resourceID: 7, quantity: 1 });
  });

  it('uses Amount as the resource quantity', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items } = resolve([{ Term: 'Resource', Name: 'Iron', Amount: 3 }], [], { giveRange });
    expect(items[0]).toMatchObject({ resourceID: 7, quantity: 3 });
  });

  it('rejects a non-positive resource quantity, writing nothing', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    for (const Amount of [0, -2]) {
      const { items, errors } = resolve([{ Term: 'Resource', Name: 'Iron', Amount }], [], { giveRange });
      expect(items).toEqual([]);
      expect(errors[0].Problem).toContain('positive');
    }
  });

  it('caps the resource quantity to what the side holds', () => {
    const giveRange = sideRange({ resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] });
    const { items } = resolve([{ Term: 'Resource', Name: 'Iron', Amount: 99 }], [], { giveRange });
    expect(items[0]).toMatchObject({ resourceID: 7, quantity: 4 });
  });

  it('resolves a city by name', () => {
    const giveRange = sideRange({ cities: [{ cityID: 4, name: 'Berlin', x: 1, y: 2, legal: true, reasons: [] }] });
    const { items } = resolve([{ Term: 'City', Name: 'Berlin' }], [], { giveRange });
    expect(items[0]).toMatchObject({ itemType: 'CITIES', cityID: 4 });
  });

  it('resolves a vote commitment by name and copies its counts', () => {
    const giveRange = sideRange({ voteCommitments: [{ resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo Carthage, Yes', legal: true, reasons: [] }] });
    const { items } = resolve([{ Term: 'Vote Commitment', Name: 'Embargo Carthage, Yes' }], [], { giveRange });
    expect(items[0]).toMatchObject({ itemType: 'VOTE_COMMITMENT', resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false });
  });
});

describe('resolveLedger errors', () => {
  it('flags a missing gold Amount', () => {
    const { items, errors } = resolve([{ Term: 'Gold' }]);
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ Side: 'Give', Term: 'Gold' });
    expect(errors[0].Problem).toContain('Amount');
  });

  it('suggests the closest name for a misspelling', () => {
    const giveRange = sideRange({ techs: [{ techID: 1, name: 'Banking', legal: true, reasons: [] }, { techID: 2, name: 'Sanitation', legal: true, reasons: [] }] });
    const { errors } = resolve([{ Term: 'Technology', Name: 'Bankng' }], [], { giveRange });
    expect(errors[0].Suggestions).toContain('Banking');
  });

  it('reports an empty category', () => {
    const { errors } = resolve([{ Term: 'Technology', Name: 'Banking' }], [], { giveRange: sideRange({ techs: [] }) });
    expect(errors[0].Problem).toContain('no technologies available');
  });

  it('allows only one vote commitment per side', () => {
    const giveRange = sideRange({ voteCommitments: [
      { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'A', legal: true, reasons: [] },
      { resolutionID: 6, voteChoice: 1, numVotes: 12, repeal: false, name: 'B', legal: true, reasons: [] },
    ] });
    const { items, errors } = resolve([
      { Term: 'Vote Commitment', Name: 'A' },
      { Term: 'Vote Commitment', Name: 'B' },
    ], [], { giveRange });
    expect(items).toHaveLength(1);
    expect(errors[0].Problem).toContain('only one vote commitment');
  });
});

describe('LedgerTermSchema forgiving Term labels', () => {
  it('normalizes casing/whitespace to the canonical label', () => {
    expect(LedgerTermSchema.parse({ Term: 'open borders' }).Term).toBe('Open Borders');
    expect(LedgerTermSchema.parse({ Term: "  declaration  of   friendship " }).Term).toBe('Declaration Of Friendship');
  });

  it("normalizes apostrophe and dash variants", () => {
    expect(LedgerTermSchema.parse({ Term: "won't attack" }).Term).toBe("Won't Attack");
    expect(LedgerTermSchema.parse({ Term: 'won’t attack' }).Term).toBe("Won't Attack"); // curly apostrophe
    expect(LedgerTermSchema.parse({ Term: 'Third–Party Peace' }).Term).toBe('Third-Party Peace'); // en-dash
  });

  it('still rejects an unrecognized term', () => {
    expect(LedgerTermSchema.safeParse({ Term: 'Free Stuff' }).success).toBe(false);
  });
});

describe('resolveLedger mutual agreements', () => {
  it('resolves a mutual pact on one side to a single directed item (symmetrized at storage)', () => {
    const { items, errors } = resolve([{ Term: 'Declaration Of Friendship' }]);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'DECLARATION_OF_FRIENDSHIP' }]);
  });

  it('resolves a mutual pact listed on both sides to the opposite-directed pair', () => {
    const { items, errors } = resolve([{ Term: 'Defensive Pact' }], [{ Term: 'Defensive Pact' }]);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { fromPlayerID: AGENT, toPlayerID: COUNTERPART, itemType: 'DEFENSIVE_PACT' },
      { fromPlayerID: COUNTERPART, toPlayerID: AGENT, itemType: 'DEFENSIVE_PACT' },
    ]);
  });
});

describe('resolveLedger promises', () => {
  it('emits an untargeted promise directed by side', () => {
    const { promises } = resolve([{ Term: "Won't Attack" }]);
    expect(promises[0]).toEqual({ promiserID: AGENT, recipientID: COUNTERPART, promiseType: 'MILITARY' });
  });

  it('resolves a cooperative-war target by name when eligible', () => {
    const promiseTargets = [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }];
    const { promises, errors } = resolve([{ Term: 'Cooperative War', Name: 'Rome' }], [], { promiseTargets });
    expect(errors).toEqual([]);
    expect(promises[0]).toMatchObject({ promiseType: 'COOP_WAR', targetPlayerID: 9 });
  });

  it('rejects an ineligible cooperative-war target with suggestions', () => {
    const promiseTargets = [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: false }];
    const { promises, errors } = resolve([{ Term: 'Cooperative War', Name: 'Rome' }], [], { promiseTargets });
    expect(promises).toEqual([]);
    expect(errors[0].Term).toBe('Cooperative War');
  });
});
