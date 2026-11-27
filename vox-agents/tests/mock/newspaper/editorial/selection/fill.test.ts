/** Behavioral checks for filling the front and the sections from scored stories. */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createInitialPublicationState, type PublicationState,
} from '../../../../../src/newspaper/contracts/publication.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { planPage } from '../../../../../src/newspaper/editorial/presentation/page-plan.js';
import { computeFeedback } from '../../../../../src/newspaper/editorial/selection/feedback.js';
import { fillPages } from '../../../../../src/newspaper/editorial/selection/fill.js';
import type { EditorialCandidate } from '../../../../../src/newspaper/editorial/selection/templates.js';

let config: EditorialConfig;

beforeAll(async () => {
  const base = await loadEditorialConfig();
  config = editorialConfigSchema.parse({ ...base, defaults: { ...base.defaults, sections: 2 } });
});

/** Build a printable candidate with explicit placement facts. */
function story(id: string, facts: Partial<EditorialCandidate> = {}): EditorialCandidate {
  const variantId = `${id}-variant`;
  return {
    id, subject: facts.subject ?? `subject/${id}`, period: { from: 5, to: 10 },
    triggerIds: [], ruleIds: [], templateIds: [id], seriesKeys: [],
    tier: 'routine', tags: [], importance: 50, urgent: false, weight: 0,
    variants: [{ id: variantId, headline: id, body: [id], links: [], weight: { base: 1, adjustments: [] } }],
    variantWeights: { [variantId]: 1 }, variantSources: {}, values: {}, sources: [], fingerprint: id,
    ...facts,
  };
}

/** Record one earlier issue that printed a story from the given rule. */
function printedIssue(turn: number, ruleId: string): PublicationState['issues'][number] {
  const issueId = `issue-${turn}`;
  return {
    issueId, turn, designId: 'wire',
    items: [{
      id: `old-${turn}`, issueId, turn, tags: [], seriesKeys: [], templateIds: ['old'],
      triggerIds: [ruleId], ruleIds: [ruleId], importance: 50,
      headline: [{ type: 'text', text: 'Earlier headline' }], evidenceSummary: 'Earlier audit detail',
      sources: [], fingerprint: `old-${turn}`,
    }],
  };
}

/** Fill every stock section from the given stories. */
function fill(
  candidates: readonly EditorialCandidate[],
  state: PublicationState = createInitialPublicationState(),
  turn = 10,
) {
  return fillPages({
    candidates, state, config, feedback: computeFeedback(state, config), turn,
    sections: config.pages.filter(page => !page.front),
  });
}

describe('page filling', () => {
  describe('front and section placement', () => {
    it('should fill the front first and the first matching section up to four briefs or five with a lead', async () => {
      const front = Array.from({ length: 4 }, (_, index) => story(`front-${index}`, {
        importance: 90, subject: `front-subject/${index}`,
      }));
      const section = Array.from({ length: 8 }, (_, index) => story(`war-${index}`, {
        importance: 40 + index, tags: ['military'], subject: `war-subject/${index}`, ruleIds: [`war-rule-${index}`],
      }));

      const full = await fill([...front, ...section]);
      expect(full.pages.map(page => page.page.id)).toEqual(['front', 'war']);
      expect(full.pages[0].stories.map(entry => entry.id)).toEqual(['front-0', 'front-1', 'front-2', 'front-3']);
      expect(full.pages[1].stories).toHaveLength(4);
      expect(full.outcomes.get('war-0')).toBe('outranked');

      const led = section.map((entry, index) => index === 7 ? { ...entry, importance: 80 } : entry);
      const withLead = await fill([...front, ...led]);
      expect(withLead.pages[1].stories).toHaveLength(5);
      expect(withLead.pages[1].stories[0].id).toBe('war-7');
    });

    it('should drop a section with one story while keeping its selected outcome', async () => {
      const front = Array.from({ length: 4 }, (_, index) => story(`front-${index}`, {
        importance: 90, subject: `front-subject/${index}`,
      }));
      const lone = story('lone', { importance: 20, tags: ['economy'] });

      const result = await fill([...front, lone]);
      expect(result.pages.map(page => page.page.id)).toEqual(['front']);
      expect(result.outcomes.get('lone')).toBe('selected');
      expect(result.scores.find(entry => entry.id === 'lone')?.selected).toBe(false);
    });

    it('should keep the two sections with the highest story scores', async () => {
      const front = Array.from({ length: 4 }, (_, index) => story(`front-${index}`, {
        importance: 100, subject: `front-subject/${index}`,
      }));
      const war = [0, 1].map(index => story(`war-${index}`, {
        importance: 30 + index * 10, tags: ['military'], ruleIds: [`war-rule-${index}`],
      }));
      const economy = [0, 1].map(index => story(`economy-${index}`, {
        importance: 50 + index * 10, tags: ['economy'], ruleIds: [`economy-rule-${index}`],
      }));
      const home = [0, 1].map(index => story(`home-${index}`, {
        importance: 70 + index * 10, tags: ['domestic'], ruleIds: [`home-rule-${index}`],
      }));

      const result = await fill([...front, ...war, ...economy, ...home]);
      expect(result.pages.map(page => page.page.id)).toEqual(['front', 'economy', 'home']);
      expect(result.outcomes.get('war-0')).toBe('selected');
      expect(result.scores.find(entry => entry.id === 'war-0')?.selected).toBe(false);
    });
  });

  describe('scoring and reserved front stories', () => {
    it('should penalize a third story from the same rule below a lower-importance story from another rule', async () => {
      const repeated = [0, 1, 2].map(index => story(`repeat-${index}`, {
        importance: 60, ruleIds: ['shared'], subject: `repeat-subject/${index}`,
      }));
      const other = story('other', { importance: 40, ruleIds: ['other-rule'], subject: 'other-subject' });

      const result = await fill([...repeated, other]);
      const placed = result.pages[0].stories.map(entry => entry.id);
      expect(placed.indexOf('other')).toBeLessThan(placed.indexOf('repeat-2'));
      const scores = new Map(result.scores.map(entry => [entry.id, entry.score]));
      expect(scores.get('repeat-2')).toBeLessThan(scores.get('other')!);
    });

    it('should lower the score of a rule printed in a recent issue more than an older one', async () => {
      const candidate = story('candidate', { importance: 50, ruleIds: ['shared'] });
      const older = createInitialPublicationState();
      older.issues = [printedIssue(1, 'shared')];
      const recent = createInitialPublicationState();
      recent.issues = [printedIssue(9, 'shared')];

      const olderScore = (await fill([candidate], older)).scores[0].score;
      const recentScore = (await fill([candidate], recent)).scores[0].score;
      expect(olderScore).toBeGreaterThan(recentScore);
    });

    it('should fill the front with four stories that share one subject', async () => {
      const candidates = Array.from({ length: 4 }, (_, index) => story(`same-${index}`, {
        importance: 60, subject: 'player/0', ruleIds: [`same-rule-${index}`],
      }));

      const result = await fill(candidates);
      expect(result.frontComplete).toBe(true);
      expect(result.pages[0].stories).toHaveLength(4);
      expect(result.scores.every(entry => entry.selected)).toBe(true);
    });

    it('should lead a breaking front with an urgent story', async () => {
      const normal = Array.from({ length: 4 }, (_, index) => story(`normal-${index}`, {
        importance: 80, subject: `normal-subject/${index}`,
      }));
      const urgent = story('urgent', { importance: 5, urgent: true, ruleIds: ['urgent-rule'] });

      const result = await fill([...normal, urgent]);
      const front = result.pages[0].stories;
      expect(front[0].id).toBe('urgent');
      expect(front).toHaveLength(5);
      expect(planPage(front, true)).toEqual({ leadId: 'urgent', breaking: true });
    });
  });
});
