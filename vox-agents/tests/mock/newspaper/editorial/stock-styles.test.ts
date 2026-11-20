/** Behavioral checks for the stock newspaper style preferences. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import type { AuthoredVariant, EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { applyStylePreferences } from '../../../../src/newspaper/editorial/selection/styles.js';
import type { EditorialCandidate } from '../../../../src/newspaper/editorial/selection/templates.js';
import type { ExpressionCheckBudget } from '../../../../src/newspaper/editorial/shared/expressions.js';

let config: EditorialConfig;

/** Build a permitted snapshot with a predictable row reference. */
function snapshot(subjectID: number, turn: number, values: Record<string, unknown>): NewspaperSnapshot {
  return { subjectID, values, source: { table: 'PlayerSummaries', id: turn * 100 + subjectID, turn, createdAt: turn * 1000 } };
}

/** Build receiver evidence for one era, optionally with a known national happiness. */
function fixture(era: string, happiness?: number): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10 },
    players: [snapshot(0, 10, {
      Era: era,
      Gold: 20,
      ...(happiness === undefined ? {} : { HappinessPercentage: happiness }),
    })],
    cities: [], comparisons: { players: [], cities: [] }, events: [],
  };
}

/** Build one authored variant whose style starts at general, neutral and report. */
function variant(id: string, style: { voice?: string; stance?: string; genre?: string } = {}): AuthoredVariant {
  return {
    id, headline: id, body: [id],
    voice: style.voice ?? 'general',
    stance: style.stance ?? 'neutral',
    genre: style.genre ?? 'report',
    weight: { base: 1, adjustments: [] },
    links: [],
  };
}

/** Build a selected candidate with explicit style variants and story facts. */
function styleCandidate(
  id: string, variants: EditorialCandidate['variants'],
  facts: Partial<Pick<EditorialCandidate, 'importance' | 'urgent' | 'short' | 'tags'>> = {},
): EditorialCandidate {
  return {
    id, subject: `player/${id}`, period: { from: 5, to: 10 }, triggerIds: [], ruleIds: [], templateIds: [],
    seriesKeys: [], tags: facts.tags ?? [], importance: facts.importance ?? 50, urgent: facts.urgent ?? false,
    short: facts.short ?? false, weight: 1, variants,
    variantWeights: Object.fromEntries(variants.map(item => [item.id, 1])),
    variantSources: {}, variantBindings: {}, values: {}, sources: [], fingerprint: id,
  };
}

/** Apply the stock style rules to selected candidates against one receiver fixture. */
async function applyStock(candidates: EditorialCandidate[], era: string, happiness?: number) {
  const compiled = await getEditorialExpressions(config);
  const budget: ExpressionCheckBudget = { interruptedSlots: new Set(), choiceErrors: new Map() };
  const result = await applyStylePreferences(candidates, compiled,
    { constants: {}, facts: buildNewspaperFacts(fixture(era, happiness)) }, budget);
  return { ...result, budget };
}

describe('stock newspaper styles', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
  });

  describe('voice by era', () => {
    it('should discourage feed and keep spoken in the Ancient era', async () => {
      const candidate = styleCandidate('ancient',
        ['general', 'spoken', 'feed'].map(id => variant(id, { voice: id })));
      const { selected } = await applyStock([candidate], 'Ancient Era');
      const weights = selected[0].variantWeights;
      expect(weights.feed).toBeLessThan(weights.general);
      expect(weights.spoken).toEqual(weights.general);
    });

    it('should discourage spoken and keep feed in the Information era', async () => {
      const candidate = styleCandidate('information',
        ['general', 'spoken', 'feed'].map(id => variant(id, { voice: id })));
      const { selected } = await applyStock([candidate], 'Information Era');
      const weights = selected[0].variantWeights;
      expect(weights.spoken).toBeLessThan(weights.general);
      expect(weights.feed).toEqual(weights.general);
    });
  });

  describe('genre by story', () => {
    it('should discourage a joke against a report on an urgent story', async () => {
      const candidate = styleCandidate('urgent',
        [variant('joke', { genre: 'joke' }), variant('report')], { urgent: true });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.joke).toBeLessThan(weights.report);
    });

    it('should raise a proverb above an analysis on a short filler', async () => {
      const candidate = styleCandidate('short',
        [variant('proverb', { genre: 'proverb' }), variant('analysis', { genre: 'analysis' })], { short: true });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.proverb).toBeGreaterThan(weights.analysis);
    });

    it('should raise an editorial above a report on an important story', async () => {
      const candidate = styleCandidate('important',
        [variant('editorial', { genre: 'editorial' }), variant('report')], { importance: 90 });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.editorial).toBeGreaterThan(weights.report);
    });
  });

  describe('stance by story', () => {
    it('should raise a local stance above a neutral one on city and domestic news', async () => {
      const candidate = styleCandidate('local',
        [variant('local', { stance: 'local' }), variant('neutral')], { tags: ['cities', 'domestic'] });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.local).toBeGreaterThan(weights.neutral);
    });
  });

  describe('rule evaluation', () => {
    it('should record no choice error when every stock style is in play', async () => {
      const styles = config.styles;
      if (!styles) throw new Error('The stock catalogue has no style definitions.');
      const story = {
        importance: 90, urgent: true, short: true,
        tags: ['cities', 'domestic', 'military', 'international', 'religion', 'wonders', 'science', 'diplomacy'],
      };
      const voices = styleCandidate('voices', styles.voice.map(({ id }) => variant(id, { voice: id })), story);
      const stances = styleCandidate('stances', styles.stance.map(({ id }) => variant(id, { stance: id })), story);
      const genres = styleCandidate('genres', styles.genre.map(({ id }) => variant(id, { genre: id })), story);
      const { budget } = await applyStock([voices, stances, genres], 'Ancient Era', 40);
      expect(budget.choiceErrors?.size ?? 0).toBe(0);
      expect(budget.choiceEvaluationIncomplete).toBeUndefined();
    });
  });
});
