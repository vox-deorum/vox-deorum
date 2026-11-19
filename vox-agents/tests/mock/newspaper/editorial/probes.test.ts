/** Probe overlay stories and the People's Daily design, loaded from the on-disk folder. */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, type PublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { evidence as buildEvidence } from '../../../helpers/newspaper-diplomacy.js';

const probeDirectory = fileURLToPath(new URL('../../../../newspaper/probes/', import.meta.url));
const probeRuleId = 'probe-treasury';
const probeTemplateId = 'probe-treasury-account';
const probeDesignId = 'probe-communist-press';
const probeIdentity = 'Probe Republic';

let defaultConfig: EditorialConfig;
let probeConfig: EditorialConfig;
let probeOnlyConfig: EditorialConfig;

/** Give the receiver one treasury reading and cover the stock rules' lookback windows. */
function treasuryEvidence(gold: number): NewspaperEvidence {
  const projected = buildEvidence([], [], 10, 5, 0);
  projected.players[0].values = { Gold: gold };
  projected.request.historyFromTurn = -1;
  projected.history = {
    fromTurn: -1,
    baseline: { players: [], cities: [] },
    snapshots: { players: projected.players, cities: [] },
    events: [],
    gaps: [],
  };
  return projected;
}

/** Run the real editor on the treasury input with a named receiver and catalogue. */
function check(gold: number, catalogue: EditorialConfig, identity = 'France') {
  const projected = treasuryEvidence(gold);
  const facts = buildNewspaperFacts(projected, {
    playerIdentities: { 0: { name: identity, major: true } },
  });
  return runEditorialCheck({
    campaignId: 'campaign',
    timelineId: 'probe',
    receiver: { playerId: 0, label: identity },
    evidence: projected,
    facts,
    speedMultiplier: 1,
    state: createInitialPublicationState(),
    config: catalogue,
  });
}

/** Read which templates actually made it into print. */
function publishedTemplates(state: PublicationState) {
  return state.issues.flatMap((issue) => issue.items.flatMap((item) => item.templateIds));
}

describe('probe overlay', () => {
  beforeAll(async () => {
    defaultConfig = await loadEditorialConfig();
    probeConfig = await loadEditorialConfig(probeDirectory);
    probeOnlyConfig = {
      ...probeConfig,
      designs: probeConfig.designs.filter((design) => design.id === probeDesignId),
    };
  });

  describe('treasury probe', () => {
    it('should publish the probe story at the constant threshold', async () => {
      const result = await check(100, probeConfig);
      expect(publishedTemplates(result.state)).toContain(probeTemplateId);
    });

    it('should leave the probe story unpublished below the threshold', async () => {
      const result = await check(99, probeConfig);
      expect(publishedTemplates(result.state)).not.toContain(probeTemplateId);
    });
  });

  it('should keep the probes out of the default catalogue', () => {
    expect(defaultConfig.triggers.map((trigger) => trigger.id)).not.toContain(probeRuleId);
    expect(defaultConfig.templates.map((template) => template.id)).not.toContain(probeTemplateId);
    expect(defaultConfig.designs.map((design) => design.id)).not.toContain(probeDesignId);
  });

  describe("People's Daily design", () => {
    it('should choose the probe design for its synthetic identity', async () => {
      const result = await check(100, probeOnlyConfig, probeIdentity);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.publication.designId).toBe(probeDesignId);
    });

    it('should not publish an issue for a real identity', async () => {
      const result = await check(100, probeOnlyConfig, 'France');
      expect(result.status).toBe('skipped');
      expect(
        result.decision.candidateScores.some(
          (candidate) => candidate.selected && candidate.id.startsWith(`${probeTemplateId}/`)
        )
      ).toBe(true);
    });
  });
});
