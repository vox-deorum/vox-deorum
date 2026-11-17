/** Contracts for curated non-war coverage and its evidence boundaries. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperEvent, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { loadEditorialConfig, editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config.js';
import { detectTriggers, evidenceConditionContext } from '../../../../src/newspaper/editorial/triggers.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/templates.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { createInitialPublicationState } from '../../../../src/newspaper/contracts/publication.js';

let config: EditorialConfig;
const context = { receiverTeamId: 7, receiverOwnerName: 'France', playerNames: { '0': 'France', '1': 'Morocco', '2': 'Zulu' },
  playerTeamIds: { '0': 7, '1': 8, '2': 9 }, majorPlayerIds: [0, 1, 2], standardTurnsPerGameTurn: 1 };
/** Make one dated national or city observation with a stable reference. */
function snapshot(id: number, turn: number, values: Record<string, unknown>, city = false): NewspaperSnapshot {
  return { subjectID: id, values, source: { table: city ? 'CityInformations' : 'PlayerSummaries', id: turn * 100 + id, turn, createdAt: turn * 1000 } };
}
/** Make a permitted recorded event with its original turn and identity. */
function event(type: string, values: Record<string, unknown>, turn = 10, id = 1): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 + id } };
}
/** Start with a bounded evidence envelope and no implied zero measurements. */
function evidence(previous = 5, cutoff = 10): NewspaperEvidence {
  return { request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: cutoff }, players: [], cities: [],
    comparisons: { players: [], cities: [] }, events: [] };
}
/** Add domestic city observations under a continuous recorded owner. */
function cityRows(input: NewspaperEvidence, before: Record<string, unknown>, current: Record<string, unknown>): void {
  input.comparisons.cities = [snapshot(3, 5, { Owner: 'France', Name: 'Paris', X: 1, Y: 2, ...before }, true)];
  input.cities = [snapshot(3, 10, { Owner: 'France', Name: 'Paris', X: 1, Y: 2, ...current }, true)];
}
/** Return only one configured family so negative assertions remain scoped. */
function findings(input: NewspaperEvidence, id: string, override = context) {
  return detectTriggers(input, config, override).filter(trigger => trigger.definitionId === id);
}

describe('curated non-war developments', () => {
  beforeAll(async () => { config = await loadEditorialConfig(); });

  it('should require both boom thresholds and preserve milestones and stable-owner declines', () => {
    const input = evidence();
    cityRows(input, { Population: 8 }, { Population: 10 });
    expect(findings(input, 'city-population-boom')).toHaveLength(1);
    expect(findings(input, 'city-population-milestone')[0].values.milestone).toBe(10);
    input.cities[0].values.Population = 9;
    expect(findings(input, 'city-population-boom')).toEqual([]);
    input.cities[0].values.Population = 6;
    expect(findings(input, 'city-population-decline')[0].values.growth).toBe(-2);
    input.comparisons.cities[0].values.Owner = 'Morocco';
    expect(findings(input, 'city-population-decline')).toEqual([]);
  });

  it('should reject growth and completion across lifecycle and access changes', () => {
    const input = evidence();
    cityRows(input, { Population: 4, Wonders: [] }, { Population: 10, Wonders: ['Pyramids'], GreatWorkCount: 2 });
    expect(findings(input, 'new-wonder')).toHaveLength(1);
    expect(findings(input, 'great-works')).toEqual([]);
    input.events.push(event('CityCaptureComplete', { CityX: 1, CityY: 2 }, 7));
    expect(findings(input, 'new-wonder')).toEqual([]);
    expect(findings(input, 'city-population-boom')).toEqual([]);
  });

  it('should recognize resistance, administration, razing and comparable great-work increases', () => {
    const input = evidence();
    cityRows(input, { ResistanceTurns: 2, IsPuppet: true, IsOccupied: true, RazingTurns: 0, GreatWorkCount: 1 },
      { ResistanceTurns: 0, IsPuppet: false, IsOccupied: false, RazingTurns: 3, GreatWorkCount: 3 });
    for (const id of ['city-resistance', 'city-administration', 'city-razing', 'great-works']) expect(findings(input, id)).toHaveLength(1);
    input.comparisons.cities[0].values = { Owner: 'France' };
    for (const id of ['city-resistance', 'city-administration', 'city-razing', 'great-works']) expect(findings(input, id)).toEqual([]);
  });

  it('should use actual elapsed history for a shortage and report a later low-reserve escalation once', () => {
    const input = evidence(7, 10);
    cityRows(input, { FoodPerTurn: 1, FoodStored: 20 }, { FoodPerTurn: -2, FoodStored: 10 });
    input.comparisons.cities.push(snapshot(3, 8, { Owner: 'France', FoodPerTurn: -2, FoodStored: 14 }, true));
    expect(findings(input, 'city-food-shortage')[0].values).toMatchObject({ food: -2, stored: 10, stage: 'sustained shortage' });
    input.request.previousCheckTurn = 10; input.request.cutoffTurn = 12;
    input.comparisons.cities.push(input.cities[0]);
    input.cities = [snapshot(3, 12, { Owner: 'France', FoodPerTurn: -2, FoodStored: 4 }, true)];
    expect(findings(input, 'city-food-shortage')[0].values.stage).toBe('low reserves');
    input.request.previousCheckTurn = 12; input.request.cutoffTurn = 13;
    input.comparisons.cities.push(input.cities[0]);
    input.cities = [snapshot(3, 13, { Owner: 'France', FoodPerTurn: -2, FoodStored: 2 }, true)];
    expect(findings(input, 'city-food-shortage')).toEqual([]);
  });

  it('should distinguish negative fiscal data from unavailable data and require persistence', () => {
    const input = evidence(8, 10);
    input.comparisons.players = [snapshot(0, 5, { GoldPerTurn: 2 }), snapshot(0, 8, { GoldPerTurn: -20 })];
    input.players = [snapshot(0, 10, { GoldPerTurn: -30, Gold: 120, HappinessPercentage: -5 })];
    expect(findings(input, 'budget-deficit')[0].values.income).toBe(-30);
    expect(findings(input, 'income-shift')[0].values.change).toBe(-10);
    input.comparisons.players[0].source.turn = 0;
    expect(findings(input, 'budget-deficit')).toEqual([]);
    input.comparisons.players = [snapshot(0, 8, {})];
    expect(findings(input, 'income-shift')).toEqual([]);
  });

  it('should escalate low food reserves with a normal five-turn observation cadence', () => {
    const input = evidence();
    cityRows(input, { FoodPerTurn: -2, FoodStored: 12 }, { FoodPerTurn: -2, FoodStored: 2 });
    expect(findings(input, 'city-food-shortage')[0].values.stage).toBe('low reserves');
    input.comparisons.cities[0].source.turn = 1;
    expect(findings(input, 'city-food-shortage')).toEqual([]);
  });

  it('should qualify a precise reserve crossing and a later exhaustion without repeating low balances', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { Gold: 60, GoldPerTurn: -10 })];
    input.players = [snapshot(0, 10, { Gold: 49, GoldPerTurn: -10 })];
    expect(findings(input, 'treasury-reserve')).toHaveLength(1);
    input.comparisons.players[0].values.Gold = 49;
    input.players[0].values.Gold = 40;
    expect(findings(input, 'treasury-reserve')).toEqual([]);
    input.players[0].values.Gold = 0;
    expect(findings(input, 'treasury-reserve')).toHaveLength(1);
  });

  it('should scale persistence and reserve bounds to the recorded game pace', () => {
    const input = evidence(8, 10);
    input.comparisons.players = [snapshot(0, 5, { GoldPerTurn: 1, Gold: 200 }), snapshot(0, 8, { GoldPerTurn: -10, Gold: 120 })];
    input.players = [snapshot(0, 10, { GoldPerTurn: -10, Gold: 90 })];
    expect(findings(input, 'budget-deficit')).toHaveLength(1);
    expect(findings(input, 'budget-deficit', { ...context, standardTurnsPerGameTurn: 0.5 })).toEqual([]);
    expect(findings(input, 'treasury-reserve')).toEqual([]);
    expect(findings(input, 'treasury-reserve', { ...context, standardTurnsPerGameTurn: 0.5 })).toHaveLength(1);
  });

  it('should require absolute and relative output changes and never use foreign science or economy', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { SciencePerTurn: 100, CulturePerTurn: 100, GoldPerTurn: 100 }),
      snapshot(1, 5, { SciencePerTurn: 1, GoldPerTurn: 1, CulturePerTurn: 20, TourismPerTurn: 10 })];
    input.players = [snapshot(0, 10, { SciencePerTurn: 120, CulturePerTurn: 125, GoldPerTurn: 125 }),
      snapshot(1, 10, { SciencePerTurn: 100, GoldPerTurn: 100, CulturePerTurn: 25, TourismPerTurn: 15 })];
    expect(findings(input, 'science-shift')).toEqual([]);
    expect(findings(input, 'income-shift')).toHaveLength(1);
    expect(findings(input, 'income-shift')[0].values).not.toHaveProperty('culture');
    expect(findings(input, 'domestic-culture')).toHaveLength(1);
    expect(findings(input, 'domestic-culture')[0].values).toMatchObject({ culture: 125, previousCulture: 100 });
    expect(findings(input, 'foreign-culture')).toHaveLength(1);
    expect(findings(input, 'tourism-shift')[0].tags).toContain('international');
    expect(findings(input, 'tourism-shift')[0].values).not.toHaveProperty('culture');
    input.players[0].values.SciencePerTurn = 125;
    expect(findings(input, 'science-shift')).toHaveLength(1);
    expect(findings(input, 'science-shift')[0].values).not.toHaveProperty('culture');
  });

  it('should preserve route sentinels, unused slots and complete earlier partner observations', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { OutgoingTradeRoutes: { 'Not assigned': 2 } })];
    input.players = [snapshot(0, 10, { OutgoingTradeRoutes: { 'Paris => Rabat (Morocco)': { FromGold: -1 }, 'Not assigned': 1 } })];
    expect(findings(input, 'trade-partner')[0].values.partnerId).toBe(1);
    expect(findings(input, 'trade-concentration')).toEqual([]);
    input.comparisons.players[0].values = {};
    expect(findings(input, 'trade-partner')).toEqual([]);
    input.comparisons.players[0].values.OutgoingTradeRoutes = { 'Paris => Rabat (Morocco)': { FromGold: -1 } };
    expect(findings(input, 'trade-partner')).toEqual([]);
  });

  it('should report concentration at a majority crossing and trade contraction against complete history', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { OutgoingTradeRoutes: {
      'Paris => Rabat (Morocco)': { FromGold: 49 }, 'Paris => Ulundi (Zulu)': { FromGold: 51 } } })];
    input.players = [snapshot(0, 10, { OutgoingTradeRoutes: {
      'Paris => Rabat (Morocco)': { FromGold: 51 }, 'Paris => Ulundi (Zulu)': { FromGold: 49 } } })];
    expect(findings(input, 'trade-concentration')).toHaveLength(2);
    input.comparisons.players[0].values.OutgoingTradeRoutes = {
      'Paris => Rabat (Morocco)': { FromGold: 50 }, 'Paris => Ulundi (Zulu)': { FromGold: 50 } };
    input.players[0].values.OutgoingTradeRoutes = {
      'Paris => Rabat (Morocco)': { FromGold: 50.01 }, 'Paris => Ulundi (Zulu)': { FromGold: 49.99 } };
    expect(findings(input, 'trade-concentration')).toHaveLength(1);
    expect(findings(input, 'trade-concentration')[0].values.partnerId).toBe(1);
    input.players[0].values.OutgoingTradeRoutes = {};
    expect(findings(input, 'trade-contraction')[0].values).toMatchObject({ routes: 0, gold: 0 });
  });

  it('should require receiver team contact and structured consequential deal terms', () => {
    const input = evidence();
    input.events = [event('TeamMeet', { CurrentTeamID: 7, OtherTeamID: 8 }),
      event('DealMade', { FromPlayerID: 0, ToPlayerID: 1, FromGives: ['Gold'], TradedItems: [] }, 10, 2)];
    expect(findings(input, 'first-contact')).toHaveLength(1);
    expect(findings(input, 'first-contact', { ...context, receiverTeamId: 0 })).toEqual([]);
    expect(findings(input, 'deal')).toEqual([]);
    input.events[1].values.TradedItems = [{ ItemType: 'ResearchAgreement', FromPlayerID: 0 }];
    expect(findings(input, 'deal')[0].values.terms).toContain('ResearchAgreement');
  });

  it('should ground monetary bargain significance in a fresh dated domestic circumstance', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 8, { Gold: 100, GoldPerTurn: 20 })];
    input.events = [event('DealMade', { FromPlayerID: 0, ToPlayerID: 1, TradedItems: [{ ItemType: 'Gold', Data1: 50, FromPlayerID: 1 }] })];
    expect(findings(input, 'deal')[0].sources.map(source => source.table)).toContain('PlayerSummaries');
    input.comparisons.players[0].values.Gold = 1000;
    expect(findings(input, 'deal')).toEqual([]);
    input.comparisons.players[0].values.Gold = 100;
    input.comparisons.players[0].source.turn = 1;
    expect(findings(input, 'deal')).toEqual([]);
    input.events[0].values.TradedItems = [{ ItemType: 'Gold', Data1: 50, FromPlayerID: 1 }, { ItemType: 'OpenBorders', FromPlayerID: 0 }];
    expect(findings(input, 'deal')[0].values.significantTerms).toBe(1);
    expect(findings(input, 'deal')[0].sources).toHaveLength(1);
  });

  it('should retain each recorded deal terms and supporting sources when start turns match', () => {
    const input = evidence();
    const economy = snapshot(0, 8, { Gold: 100, GoldPerTurn: 20 });
    const treaty = event('DealMade', { FromPlayerID: 0, ToPlayerID: 1, StartTurn: 10,
      TradedItems: [{ ItemType: 'OpenBorders', FromPlayerID: 0 }] }, 10, 1);
    const bargain = event('DealMade', { FromPlayerID: 0, ToPlayerID: 1, StartTurn: 10,
      TradedItems: [{ ItemType: 'Gold', Data1: 50, FromPlayerID: 1 }, { ItemType: 'GoldPerTurn', Data1: 10, FromPlayerID: 1 }] }, 10, 2);
    input.comparisons.players = [economy];
    input.events = [treaty, bargain];
    const deals = findings(input, 'deal');
    expect(deals).toHaveLength(2);
    const treatyStory = deals.find(deal => deal.sources.some(source => source.table === 'GameEvents' && source.id === treaty.source.id))!;
    const bargainStory = deals.find(deal => deal.sources.some(source => source.table === 'GameEvents' && source.id === bargain.source.id))!;
    expect(treatyStory.values).toMatchObject({ terms: 'OpenBorders', significantTerms: 1 });
    expect(treatyStory.sources).toEqual([treaty.source]);
    expect(bargainStory.values.significantTerms).toBe(2);
    expect(bargainStory.values.terms).toContain('GoldPerTurn');
    expect(bargainStory.values.terms).not.toContain('OpenBorders');
    expect(bargainStory.sources).toEqual([bargain.source, economy.source]);
    const result = runEditorialCheck({ campaignId: 'deals', timelineId: 'test', receiver: { playerId: 0, label: 'France' },
      evidence: input, state: createInitialPublicationState(), config, context });
    expect(result.status).toBe('published');
    if (result.status === 'published') expect(result.issue.items).toHaveLength(1);
  });

  it('should bundle duplicate research and era representations with semantic continuity', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { Era: 'Ancient' })];
    input.players = [snapshot(0, 10, { Era: 'Classical' })];
    input.events = [event('TeamTechResearched', { TeamID: 7, TechID: 'Writing', ChangeAmount: 1 }),
      event('TeamSetHasTech', { TeamID: 7, TechID: 'Writing', HasTech: true }, 10, 2),
      event('TeamSetEra', { TeamID: 7, NewEra: 1 }, 10, 3)];
    const tech = findings(input, 'significant-technology');
    expect(tech).toHaveLength(1);
    expect(tech[0].sources).toHaveLength(2);
    expect(findings(input, 'new-era')).toHaveLength(1);
    expect(findings(input, 'new-era')[0].values.era).toBe('Classical');
    input.events = [event('TeamTechResearched', { TeamID: 7, TechID: 'Writing', ChangeAmount: 1 }, 10, 9)];
    expect(findings(input, 'significant-technology')[0].fingerprint).toBe(tech[0].fingerprint);
    input.events[0].values.ChangeAmount = -1;
    expect(findings(input, 'significant-technology')).toEqual([]);
  });

  it('should compare technology counts only within a sufficiently fresh major cohort', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { Technologies: 5 }), snapshot(1, 5, { Technologies: 6 }), snapshot(2, 5, { Technologies: 4 })];
    input.players = [snapshot(0, 10, { Technologies: 7 }), snapshot(1, 10, { Technologies: 6 }), snapshot(2, 10, { Technologies: 4 })];
    expect(findings(input, 'technology-lead')[0].values).toMatchObject({ leaders: 'France', previousLeaders: 'Morocco', knownMajors: 3 });
    input.players[2].source.turn = 6;
    expect(findings(input, 'technology-lead')).toEqual([]);
    expect(findings(input, 'technology-lead', { ...context, majorPlayerIds: [0, 1] })).toHaveLength(1);
  });

  it('should preserve era identity across readable labels and reserve one story for research advancement', () => {
    const input = evidence();
    input.players = [snapshot(0, 10, { Era: 'Classical' })];
    input.events = [event('TeamSetEra', { TeamID: 7, NewEra: 1 }),
      event('TeamTechResearched', { TeamID: 7, TechID: 'Writing', ChangeAmount: 1 }, 10, 2)];
    const named = findings(input, 'new-era')[0];
    input.players = [];
    expect(findings(input, 'new-era')[0].fingerprint).toBe(named.fingerprint);
    const result = runEditorialCheck({ campaignId: 'research', timelineId: 'test', receiver: { playerId: 0, label: 'France' },
      evidence: input, state: createInitialPublicationState(), config, context });
    expect(result.status).toBe('published');
    if (result.status === 'published') expect(result.issue.items).toHaveLength(1);
    input.events = [event('TeamSetEra', { TeamID: 7, NewEra: 2 }, 10, 2), event('TeamSetEra', { TeamID: 7, NewEra: 1 }, 8, 1)];
    expect(findings(input, 'new-era')).toHaveLength(1);
    expect(findings(input, 'new-era')[0].values.eraIdentity).toBe('2');
    expect(findings(input, 'new-era')[0].sources).toHaveLength(2);
    input.events = [];
    input.comparisons.players = [snapshot(0, 5, { Era: 'Ancient' })];
    input.players = [snapshot(0, 10, { Era: 'Classical' })];
    expect(findings(input, 'new-era')).toEqual([]);
  });

  it('should require a known receiving team before matching a research event', () => {
    const input = evidence();
    input.events = [event('TeamTechResearched', { TechID: 'Writing', ChangeAmount: 1 })];
    expect(detectTriggers(input, config, { ...context, receiverTeamId: undefined }).some(trigger => trigger.definitionId === 'significant-technology')).toBe(false);
    input.events[0].values.TeamID = 7;
    expect(detectTriggers(input, config, { ...context, receiverTeamId: undefined }).some(trigger => trigger.definitionId === 'significant-technology')).toBe(false);
    expect(findings(input, 'significant-technology')).toHaveLength(1);
  });

  it('should date the latest ideology switch with its own recorded branch identities', () => {
    const input = evidence();
    input.events = [event('IdeologySwitched', { PlayerID: 0, OldBranchType: 'Order', NewBranchType: 'Freedom' }, 10, 2),
      event('IdeologySwitched', { PlayerID: 0, OldBranchType: 'Autocracy', NewBranchType: 'Order' }, 8, 1)];
    const changes = findings(input, 'ideology-switch');
    expect(changes).toHaveLength(1);
    expect(changes[0].values).toMatchObject({ previousIdeology: 'Order', ideology: 'Freedom', eventTurn: 10 });
    expect(changes[0].sources).toHaveLength(2);
  });

  it('should bundle policy direction and conversion events while retaining ideology and religious milestones', () => {
    const input = evidence();
    input.events = [event('PlayerAdoptPolicyBranch', { PlayerID: 0, BranchType: 'Tradition' }),
      event('PlayerAdoptPolicy', { PlayerID: 0, PolicyID: 'Aristocracy' }, 10, 2),
      event('IdeologySwitched', { PlayerID: 0, OldBranchType: 'Autocracy', NewBranchType: 'Order' }, 10, 3),
      event('ReligionFounded', { PlayerID: 1, ReligionID: 'Hinduism' }, 10, 4),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Hinduism' }, 9, 5),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Hinduism' }, 9, 6),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Buddhism' }, 10, 7),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 2, CityY: 3, ReligionID: 'Hinduism' }, 10, 8),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Hinduism' }, 10, 9)];
    input.comparisons.cities = [snapshot(3, 5, { Owner: 'France', X: 1, Y: 2, MajorityReligion: 'Hinduism' }, true),
      snapshot(4, 5, { Owner: 'France', X: 2, Y: 3, MajorityReligion: 'Buddhism' }, true)];
    expect(findings(input, 'policy-direction')).toHaveLength(1);
    expect(findings(input, 'policy-direction')[0].sources).toHaveLength(2);
    expect(findings(input, 'ideology-switch')).toHaveLength(1);
    expect(findings(input, 'religion-founded')[0].tags).toContain('international');
    expect(findings(input, 'city-conversions')[0].values).toMatchObject({ conversions: 2, reversals: 1 });
    expect(findings(input, 'city-conversions')[0].sources).toHaveLength(5);
    const candidates = matchTemplates(detectTriggers(input, config, context), config, evidenceConditionContext(input, context));
    expect(candidates).toHaveLength(4);
    expect(candidates.every(candidate => candidate.variants.length > 0)).toBe(true);
  });

  it('should detect golden-age, happiness and national-majority changes from explicit prior states', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { GoldenAge: 'Estimated in 3 turns', HappinessPercentage: -5, MajorityReligion: 'None' })];
    input.players = [snapshot(0, 10, { GoldenAge: '5 turns remaining', HappinessPercentage: 10, MajorityReligion: 'Hinduism' })];
    for (const id of ['golden-age', 'happiness-shift', 'national-religion']) expect(findings(input, id)).toHaveLength(1);
    input.comparisons.players = [];
    for (const id of ['golden-age', 'happiness-shift', 'national-religion']) expect(findings(input, id)).toEqual([]);
  });

  it('should ignore follower-only religious events and use a first event only as a majority baseline', () => {
    const input = evidence();
    input.comparisons.cities = [snapshot(3, 5, { Owner: 'France', X: 1, Y: 2, MajorityReligion: 'Hinduism' }, true)];
    input.events = [event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Hinduism' }, 8),
      event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Hinduism' }, 10, 2)];
    expect(findings(input, 'city-conversions')).toEqual([]);
    input.comparisons.cities = [];
    expect(findings(input, 'city-conversions')).toEqual([]);
    input.events[1].values.ReligionID = 'Buddhism';
    expect(findings(input, 'city-conversions')[0].values).toMatchObject({ conversions: 1, changes: 1, reversals: 0 });
    expect(findings(input, 'city-conversions')[0].importance).toBeLessThan(config.defaults.importanceMax);
    input.events.push(event('CityCaptureComplete', { CityX: 1, CityY: 2 }, 9, 3));
    expect(findings(input, 'city-conversions')).toEqual([]);
    input.comparisons.cities = [snapshot(3, 5, { Owner: 'France', X: 1, Y: 2, MajorityReligion: 'Hinduism' }, true)];
    input.events[2] = event('CityFlipped', { CityID: 3 }, 9, 3);
    expect(findings(input, 'city-conversions')).toEqual([]);
    input.events[2] = event('PlayerLiberated', { CityID: 99 }, 9, 3);
    expect(findings(input, 'city-conversions')).toHaveLength(1);
  });

  it('should aggregate recorded plundering affecting our commerce without foreign-only incidents', () => {
    const input = evidence();
    input.events = [event('PlayerPlunderedTradeRoute', { OriginOwnerID: 0, DestinationOwnerID: 1, PlunderGoldValue: 50 }),
      event('PlayerPlunderedTradeRoute', { OriginOwnerID: 2, DestinationOwnerID: 0, PlunderGoldValue: 75 }, 10, 2),
      event('PlayerPlunderedTradeRoute', { OriginOwnerID: 1, DestinationOwnerID: 2, PlunderGoldValue: 500 }, 10, 3)];
    expect(findings(input, 'trade-plunder')).toHaveLength(1);
    expect(findings(input, 'trade-plunder')[0].values).toMatchObject({ plunderEvents: 2, plunderGold: 125 });
    input.events.push(input.events[0]);
    expect(findings(input, 'trade-plunder')[0].values).toMatchObject({ plunderEvents: 2, plunderGold: 125 });
    const additional = event('PlayerPlunderedTradeRoute', { OriginOwnerID: 0, DestinationOwnerID: 1, PlunderGoldValue: 50 }, 10, 4);
    additional.source.createdAt = input.events[0].source.createdAt;
    input.events.push(additional);
    expect(findings(input, 'trade-plunder')[0].values).toMatchObject({ plunderEvents: 3, plunderGold: 175 });
    expect(findings(input, 'trade-plunder')[0].values).not.toHaveProperty('origin');
    expect(findings(input, 'trade-plunder')[0].values).not.toHaveProperty('destination');
  });

  it('should bound conversion lifecycle changes by recorded time within the same turn', () => {
    const input = evidence();
    const baseline = snapshot(3, 8, { Owner: 'France', X: 1, Y: 2, MajorityReligion: 'Hinduism' }, true);
    baseline.source.createdAt = 8005;
    const conversion = event('CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, ReligionID: 'Buddhism' }, 8, 10);
    const capture = event('CityCaptureComplete', { CityX: 1, CityY: 2, CityID: 3 }, 8, 1);
    input.comparisons.cities = [baseline];
    input.events = [capture, conversion];
    expect(findings(input, 'city-conversions')).toHaveLength(1);
    expect(findings(input, 'city-conversions')[0].sources).toEqual([baseline.source, conversion.source]);
    capture.source.createdAt = 8007;
    expect(findings(input, 'city-conversions')).toEqual([]);
    capture.source.createdAt = baseline.source.createdAt;
    expect(findings(input, 'city-conversions')).toEqual([]);
    capture.source.createdAt = conversion.source.createdAt;
    expect(findings(input, 'city-conversions')).toEqual([]);
    capture.source.createdAt = conversion.source.createdAt + 1;
    expect(findings(input, 'city-conversions')).toHaveLength(1);
  });

  it('should route domestic and foreign culture and religion through their geographic sections', () => {
    const input = evidence();
    input.comparisons.players = [snapshot(0, 5, { CulturePerTurn: 10 }), snapshot(1, 5, { CulturePerTurn: 10 })];
    input.players = [snapshot(0, 10, { CulturePerTurn: 100 }), snapshot(1, 10, { CulturePerTurn: 100 })];
    input.events = [event('ReligionFounded', { PlayerID: 0, ReligionID: 'Buddhism' }),
      event('ReligionFounded', { PlayerID: 2, ReligionID: 'Hinduism' }, 10, 2)];
    const revised = structuredClone(config);
    revised.defaults.frontPageItems = 2;
    revised.pages.forEach(page => { if (!page.front) page.minimum = 1; });
    const result = runEditorialCheck({ campaignId: 'routing', timelineId: 'test', receiver: { playerId: 0, label: 'France' },
      evidence: input, state: createInitialPublicationState(), config: revised, context });
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    const home = result.issue.pages.find(page => page.id === 'home');
    const abroad = result.issue.pages.find(page => page.id === 'abroad');
    expect(home).toBeDefined();
    expect(abroad).toBeDefined();
    for (const id of home!.itemIds) expect(result.issue.items.find(item => item.id === id)!.tags).toContain('domestic');
    for (const id of abroad!.itemIds) expect(result.issue.items.find(item => item.id === id)!.tags).toContain('international');
  });

  it('should validate tuning and stage names and let a local catalogue disable one family', () => {
    const input = evidence(); cityRows(input, { Population: 8 }, { Population: 10 });
    const revised = structuredClone(config);
    revised.triggers.find(trigger => trigger.id === 'city-population-boom')!.enabled = false;
    expect(detectTriggers(input, revised, context).some(trigger => trigger.definitionId === 'city-population-boom')).toBe(false);
    revised.triggers[0].stage = 'typo';
    expect(editorialConfigSchema.safeParse(revised).success).toBe(false);
    revised.triggers = structuredClone(config.triggers);
    revised.triggers.find(trigger => trigger.id === 'significant-technology')!.tuning = { persistence: 2 };
    expect(editorialConfigSchema.safeParse(revised).success).toBe(false);
    revised.triggers = structuredClone(config.triggers);
    revised.triggers.find(trigger => trigger.id === 'deal')!.tuning = { window: 10 };
    expect(editorialConfigSchema.safeParse(revised).success).toBe(false);
  });
});
