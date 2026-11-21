import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { fact, reference } from '../../../../../src/newspaper/editorial/facts/model.js';
import { storyIdentity, storySubject } from '../../../../../src/newspaper/editorial/facts/story.js';

let stock: EditorialConfig;

/** Give player observations distinct evidence rows at each date. */
function player(subjectID: number, turn: number, values: Record<string, unknown>): NewspaperSnapshot {
  return { subjectID, values, source: { table: 'PlayerSummaries', id: turn * 100 + subjectID, turn, createdAt: turn } };
}

/** Build a reporting window with the newest player observations at its cutoff. */
function evidence(players: NewspaperSnapshot[], earlier: NewspaperSnapshot[] = []): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 7, historyFromTurn: 5 },
    players, events: [], cities: [], comparisons: { players: [], cities: [] },
    history: { fromTurn: 5, baseline: { players: [], cities: [] },
      snapshots: { players: [...earlier, ...players], cities: [] }, events: [], gaps: [] },
  };
}

const identities = { 0: { name: 'France', major: true }, 1: { name: 'Rome', major: true } };
const sampleVocabulary = {
  defaults: { government: 'government', people: 'people', leaderTitle: 'leader', leaderAddress: 'Honored Leader' },
  branches: {
    Authority: { tier: 1, terms: { government: 'war council' } },
    Progress: { tier: 1, terms: { government: 'assembly' } },
    Fealty: { tier: 2, terms: { government: 'court', people: 'subjects' } },
    Statecraft: { tier: 2, terms: { government: 'council' }, eras: ['Medieval Era'] },
  },
  ideologies: { Order: { terms: { government: 'workers’ congress', people: 'comrades' } } },
  civilizations: {
    Rome: {
      terms: { government: 'forum', leaderAddress: 'First Citizen' },
      branches: { Progress: { government: 'senate' } },
    },
  },
};

/** Publish a controlled issue with the real editor and its fact model. */
function check(config: EditorialConfig, observations: NewspaperEvidence) {
  return runEditorialCheck({
    config, evidence: observations, campaignId: 'civic', timelineId: 'test',
    receiver: { playerId: 0, label: 'France' }, speedMultiplier: 1, state: createInitialPublicationState(),
    facts: buildNewspaperFacts(observations, { playerIdentities: identities }, { ideologies: config.constants.types.ideologies }),
  });
}

describe('newspaper civic vocabulary', () => {
  beforeAll(async () => { stock = await loadEditorialConfig(); });

  it.each([
    ['ideology before tier', { Fealty: ['A'], Order: 1 }, 'Medieval Era', 'workers’ congress'],
    ['tier before policy count', { Progress: 6, Fealty: ['A'] }, 'Medieval Era', 'court'],
    ['list and count compare by investment', { Fealty: ['A'], Statecraft: 2 }, 'Medieval Era', 'council'],
    ['equal counts compare alphabetically', { Statecraft: 2, Fealty: ['A', 'B'] }, 'Medieval Era', 'court'],
    ['unknown count makes the tier alphabetical', { Statecraft: null, Fealty: ['A'] }, 'Medieval Era', 'court'],
    ['era filters an otherwise eligible profile', { Statecraft: 2, Progress: ['A'] }, 'Ancient Era', 'assembly'],
  ] as const)('should resolve %s', (_, branches, era, government) => {
    const model = buildNewspaperFacts(evidence([player(0, 10, { PolicyBranches: branches, Era: era })]),
      { playerIdentities: identities }, { ideologies: ['Order'] });
    const identity = storyIdentity(storySubject('player/0', model), model, sampleVocabulary);
    expect(identity['player.civic.government']?.value).toBe(government);
  });

  it('should resolve a direct player reference at its observation and leave an unresolved reference unavailable', () => {
    const old = player(1, 8, { PolicyBranches: { Progress: 3 } });
    const current = player(1, 10, { PolicyBranches: { Order: 2 } });
    const model = buildNewspaperFacts(evidence([current, player(2, 10, {})], [old]),
      { playerIdentities: identities }, { ideologies: ['Order'] });
    const row = { table: 'GameEvents' as const, id: 81, turn: 8, createdAt: 8 };
    const fields = {
      dated: fact(reference('player', 1, 8), [row]),
      current: fact(reference('player', 1)),
      visible: fact(reference('player', 2)),
      hidden: fact(reference('player', 3)),
    };
    const identity = storyIdentity({ key: 'incident/test', kind: 'incident', fields }, model, sampleVocabulary);
    expect(identity['incident.dated.civic.government']).toEqual({ value: 'senate', sources: expect.arrayContaining([old.source, row]) });
    expect(identity['incident.dated.civic.government'].sources).not.toContainEqual(current.source);
    expect(identity['incident.current.civic.government']?.value).toBe('forum');
    expect(identity['incident.current.civic.people']?.value).toBe('comrades');
    expect(identity['incident.visible.civic.government']?.value).toBe('government');
    expect(identity['incident.hidden.civic.government']).toBeUndefined();
  });

  it('should render home and foreign vocabulary through a merge and cite only printed terms', async () => {
    /** Put a placeholder in a map link label. */
    const link = (placeholder: string, label: string) => ({ placeholder, label, target: { type: 'screen', screen: 'map' } });
    const weight = { base: 1 };
    const config = await parseEditorialConfig({
      ...stock,
      civicTerms: sampleVocabulary,
      defaults: { ...stock.defaults, minItems: 2, maxItems: 2 },
      triggers: [
        { id: 'anchor', subject: 'city', when: 'true' },
        { id: 'notice', subject: 'world', when: 'true' },
        { id: 'ledger', subject: 'world', when: 'true' },
      ],
      templates: [
        { id: 'notice', triggers: ['notice'], weight, tags: [], variants: [{ id: 'notice', headline: 'Notice', body: ['Notice.'], weight }] },
        { id: 'ledger', triggers: ['ledger'], weight, tags: [], variants: [{ id: 'ledger', headline: 'Ledger', body: ['Ledger.'], weight }] },
        { id: 'anchor', triggers: ['anchor'], weight, tags: [], variants: [], merge: {
          match: 'true', min: 2,
          variants: [{ id: 'merged', headline: 'From our {{terms.civic.government}}', weight,
            body: ['Dispatch from the {{foreignOffice}}.'],
            links: [link('foreignOffice', '{{city.owner.civic.government}}')] }],
        } },
      ],
    });
    const home = player(0, 10, { PolicyBranches: { Fealty: ['A'] } });
    const foreign = player(1, 10, { PolicyBranches: { Progress: 2 } });
    const city: NewspaperSnapshot = { subjectID: 11, values: { OwnerID: 1, Name: 'Port' },
      source: { table: 'CityInformations', id: 11, turn: 10, createdAt: 10 } };
    const result = await check(config, { ...evidence([home, foreign]), cities: [city] });
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    expect(result.issue.items).toHaveLength(1);
    expect(result.issue.items[0].headline).toContainEqual({ type: 'text', text: 'court' });
    expect(result.issue.items[0].body.flat()).toContainEqual(expect.objectContaining({ type: 'link', text: 'senate' }));
    expect(result.state.issues[0].items[0].sources).toEqual(expect.arrayContaining([home.source, foreign.source]));
    expect(result.decision.evidence).toEqual(expect.arrayContaining([home.source, foreign.source]));

    const plain = await parseEditorialConfig({
      ...config, defaults: { ...config.defaults, minItems: 1 },
      templates: [{ id: 'notice', triggers: ['notice'], weight, tags: [],
        variants: [{ id: 'plain', headline: 'Notice', body: ['Notice.'], weight,
          links: [link('unprinted', '{{terms.civic.government}}')] }] }],
    });
    const plainResult = await check(plain, evidence([home]));
    expect(plainResult.status).toBe('published');
    expect(plainResult.state.issues[0].items[0].sources).not.toContainEqual(home.source);
  });

  it('should print the same stock crier variant with Fealty and with neutral defaults without a home row', async () => {
    const id = 'congress-new-proposals-ours';
    const template = stock.templates.find(entry => entry.variants.some(variant => variant.id === id))!;
    const config = await parseEditorialConfig({
      ...stock, defaults: { ...stock.defaults, minItems: 1 },
      triggers: [{ id: 'congress-new-proposals', subject: 'world', when: 'true', values: { ours: 'true' } }],
      templates: [{ ...template, variants: template.variants.filter(variant => variant.id === id) }],
    });
    const home = player(0, 10, { PolicyBranches: { Fealty: ['A'] } });
    const fealty = await check(config, evidence([home]));
    const neutral = await check(config, evidence([]));
    expect(fealty.status).toBe('published');
    expect(neutral.status).toBe('published');
    if (fealty.status !== 'published' || neutral.status !== 'published') return;
    expect(Object.values(fealty.decision.selectedVariants)).toEqual([id]);
    expect(Object.values(neutral.decision.selectedVariants)).toEqual([id]);
    expect(fealty.issue.items[0].body.flat()).toContainEqual({ type: 'text', text: 'subjects' });
    expect(neutral.issue.items[0].body.flat()).toContainEqual({ type: 'text', text: 'people' });
    expect(fealty.state.issues[0].items[0].sources).toContainEqual(home.source);
  });
});
