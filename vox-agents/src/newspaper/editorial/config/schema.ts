import { z } from 'zod';
import { presentationSchema } from '../../contracts/design.js';
import { newspaperLayoutVariantSchema, linkTargetSchema } from '../../contracts/issue.js';
import { getNewspaperAsset } from '../../renderer/assets.js';
import { conditionSchema } from '../shared/conditions.js';
import { weightSchema } from '../shared/weights.js';
import { editorialConstantsSchema } from './constants.js';

const eligibleSchema = z.object({ condition: conditionSchema.optional(), weight: weightSchema });
/** Authored prose uses named placeholders and explicit typed link destinations. */
export const authoredVariantSchema = eligibleSchema.extend({
  id: z.string().min(1),
  headline: z.string().min(1),
  body: z.array(z.string().min(1)).min(1),
  links: z
    .array(
      z.object({
        placeholder: z.string().min(1),
        label: z.string().min(1),
        target: linkTargetSchema,
      })
    )
    .default([]),
});
export type AuthoredVariant = z.infer<typeof authoredVariantSchema>;
/** Available measured detectors and their numeric tuning parameters. */
const triggerSchema = z
  .object({
    id: z.string().min(1),
    detector: z.enum([
      'tradeConcentration',
      'foreignCulture',
      'deal',
      'cityRecovery',
      'cityPopulation',
      'cityFood',
      'cityStatus',
      'economyBudget',
      'economyIncome',
      'happiness',
      'tradePartners',
      'tradeContraction',
      'tradePlunder',
      'firstContact',
      'era',
      'technology',
      'scienceOutput',
      'technologyLead',
      'policy',
      'ideology',
      'cultureOutput',
      'tourismOutput',
      'wonder',
      'greatWorks',
      'goldenAge',
      'religionMilestone',
      'cityReligion',
      'nationalReligion',
      'warTransition',
      'peaceTransition',
      'warProgress',
      'enduringPeace',
    ]),
    condition: conditionSchema.optional(),
    threshold: z.number().nonnegative(),
    scale: z.number().positive(),
    tags: z.array(z.string().min(1)),
    enabled: z.boolean().optional(),
    stage: z.string().optional(),
    tuning: z
      .object({
        absolute: z.number().nonnegative().optional(),
        relative: z.number().nonnegative().optional(),
        window: z.number().positive().optional(),
        persistence: z.number().positive().optional(),
        maxGap: z.number().positive().optional(),
        reserve: z.number().nonnegative().optional(),
        share: z.number().min(0).max(1).optional(),
        milestones: z.array(z.number()).optional(),
        identities: z.array(z.string()).optional(),
        freshness: z.number().positive().optional(),
        cooldown: z.number().nonnegative().optional(),
        rearm: z.number().nonnegative().optional(),
        minimumSamples: z.number().int().min(2).optional(),
        foreign: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((trigger, ctx) => {
    const stages: Record<string, string[]> = {
      cityPopulation: ['milestone', 'boom', 'decline'],
      cityStatus: ['resistance', 'administration', 'razing'],
      economyBudget: ['deficit', 'recovery', 'reserve'],
      religionMilestone: [
        'PantheonFounded',
        'ReligionFounded',
        'ReligionEnhanced',
        'ReligionReformed',
      ],
      warTransition: [
        'declaration',
        'followingMaster',
        'vassalsJoining',
        'defensivePact',
        'inheritedWars',
        'cityStateAttack',
        'cityStateJoining',
        'allianceChange',
        'resumed',
        'observed',
      ],
      peaceTransition: [
        'agreement',
        'masterLed',
        'vassalsIncluded',
        'cityStateAgreement',
        'cityStatesIncluded',
        'partial',
        'concessions',
        'capitulation',
        'quietFronts',
      ],
      warProgress: ['reversal', 'commanding', 'advantage', 'swing', 'balance', 'stagnation'],
      enduringPeace: ['enduring'],
    };
    if (trigger.stage !== undefined && !stages[trigger.detector]?.includes(trigger.stage))
      ctx.addIssue({
        code: 'custom',
        path: ['stage'],
        message: `Unsupported stage for ${trigger.detector}`,
      });
    if (
      [
        'cityPopulation',
        'religionMilestone',
        'warTransition',
        'peaceTransition',
        'warProgress',
        'enduringPeace',
      ].includes(trigger.detector) &&
      trigger.stage === undefined
    )
      ctx.addIssue({ code: 'custom', path: ['stage'], message: 'This detector requires a stage.' });
    const allowed: Record<string, string[]> = {
      cityPopulation: ['window', 'milestones', 'absolute', 'relative'],
      cityRecovery: ['window'],
      cityFood: ['window', 'persistence', 'maxGap', 'reserve'],
      cityStatus: ['window'],
      economyBudget: ['window', 'persistence', 'maxGap', 'reserve'],
      economyIncome: ['window', 'absolute', 'relative'],
      happiness: ['window', 'absolute', 'milestones'],
      tradePartners: ['window'],
      tradeContraction: ['window', 'absolute', 'relative', 'reserve'],
      tradeConcentration: ['window', 'relative', 'share'],
      foreignCulture: ['window', 'absolute', 'relative'],
      cultureOutput: ['window', 'absolute', 'relative'],
      tourismOutput: ['window', 'absolute', 'relative'],
      scienceOutput: ['window', 'absolute', 'relative'],
      technologyLead: ['window', 'maxGap', 'absolute'],
      technology: ['identities'],
      deal: ['maxGap', 'absolute', 'relative', 'reserve'],
      wonder: ['window'],
      greatWorks: ['window'],
      goldenAge: ['window'],
      nationalReligion: ['window'],
      cityReligion: ['window'],
      warTransition: trigger.stage === 'declaration' ? ['freshness'] : [],
      peaceTransition: [],
      warProgress:
        (
          {
            advantage: [
              'window',
              'maxGap',
              'freshness',
              'absolute',
              'persistence',
              'cooldown',
              'rearm',
              'foreign',
            ],
            commanding: ['absolute', 'persistence', 'rearm', 'foreign'],
            reversal: ['absolute', 'persistence', 'window', 'foreign'],
            swing: ['absolute', 'window', 'cooldown', 'foreign'],
            balance: ['absolute', 'persistence', 'cooldown', 'foreign'],
            stagnation: ['absolute', 'persistence', 'minimumSamples', 'cooldown', 'foreign'],
          } as Record<string, string[]>
        )[trigger.stage ?? ''] ?? [],
      enduringPeace: ['persistence', 'freshness', 'maxGap', 'foreign'],
    };
    for (const key of Object.keys(trigger.tuning ?? {}))
      if (!allowed[trigger.detector]?.includes(key))
        ctx.addIssue({
          code: 'custom',
          path: ['tuning', key],
          message: `Unsupported tuning field for ${trigger.detector}`,
        });
    if (
      ['warTransition', 'peaceTransition', 'warProgress', 'enduringPeace'].includes(
        trigger.detector
      ) &&
      trigger.threshold !== 1
    )
      ctx.addIssue({
        code: 'custom',
        path: ['threshold'],
        message:
          'Diplomacy stages require threshold 1; use enabled and stage tuning to configure detection.',
      });
  });
/** Templates explicitly name supported detectors and compatible authored composites. */
const templateSchema = eligibleSchema.extend({
  id: z.string().min(1),
  triggerIds: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)),
  mode: z.enum(['authored', 'llmOnly']).default('authored'),
  short: z.boolean().default(false),
  variants: z.array(authoredVariantSchema),
  compositeOf: z.array(z.string().min(1)).default([]),
});
export type EditorialTemplate = z.infer<typeof templateSchema>;
const layoutSchema = eligibleSchema.extend({
  id: z.string().min(1),
  variant: newspaperLayoutVariantSchema,
});
const designSchema = eligibleSchema.extend({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  presentation: presentationSchema,
  layouts: z.array(layoutSchema).min(1),
  pageLabels: z.record(z.string(), z.string()).default({}),
});
export type EditorialDesign = z.infer<typeof designSchema>;
/** Complete effective catalogue snapshot stored in editorial decisions. */
export const editorialConfigSchema = z
  .object({
    version: z.literal(1),
    constants: editorialConstantsSchema,
    defaults: z.object({
      frequencyStandardTurns: z.number().int().positive(),
      llmEnabled: z.boolean(),
      publicationTitle: z.string().min(1),
      maxItems: z.number().int().positive(),
      frontPageItems: z.number().int().min(2),
      importanceMax: z.number().positive(),
      decayPerTurn: z.number().min(0).max(1),
      seriesWeight: z.number().nonnegative(),
      noveltyBonus: z.number().nonnegative(),
      varietyBonus: z.number().nonnegative(),
      designStickiness: z.number().min(0).max(1),
      feedback: z.object({
        window: z.number().int().positive(),
        series: z.number().nonnegative(),
        tag: z.number().nonnegative(),
        bound: z.number().nonnegative(),
      }),
    }),
    triggers: z.array(triggerSchema),
    templates: z.array(templateSchema),
    pages: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          tags: z.array(z.string()),
          minimum: z.number().int().positive(),
          order: z.number(),
          front: z.boolean().default(false),
          condition: conditionSchema.optional(),
        })
      )
      .min(1),
    designs: z.array(designSchema).min(1),
  })
  .superRefine((config, ctx) => {
    // Validate all catalogue identifiers before resolving references.
    for (const section of ['triggers', 'templates', 'pages', 'designs'] as const) {
      const ids = new Set<string>();
      config[section].forEach((entry, index) => {
        if (ids.has(entry.id))
          ctx.addIssue({
            code: 'custom',
            path: [section, index, 'id'],
            message: `Duplicate ${section} id ${entry.id}`,
          });
        ids.add(entry.id);
      });
    }
    const triggerIds = new Set(config.triggers.map((entry) => entry.id));
    const progressWindow =
      config.triggers.find(
        (entry) => entry.detector === 'warProgress' && entry.stage === 'advantage'
      )?.tuning?.window ?? 30;
    config.triggers.forEach((entry, index) => {
      if (entry.detector !== 'warProgress' || entry.enabled === false) return;
      const persistence =
        entry.tuning?.persistence ??
        (
          { advantage: 2, commanding: 2, reversal: 2, balance: 5, stagnation: 20 } as Record<
            string,
            number
          >
        )[entry.stage ?? ''];
      const lookback =
        entry.tuning?.window ??
        (entry.stage === 'reversal' ? 15 : entry.stage === 'swing' ? 10 : progressWindow);
      if (lookback > progressWindow)
        ctx.addIssue({
          code: 'custom',
          path: ['triggers', index, 'tuning', 'window'],
          message: 'A progress stage cannot look back beyond the shared advantage history window.',
        });
      if (persistence !== undefined && persistence > Math.min(progressWindow, lookback))
        ctx.addIssue({
          code: 'custom',
          path: ['triggers', index, 'tuning', 'persistence'],
          message: 'Progress persistence cannot exceed its available history window.',
        });
    });
    const templateIds = new Set(config.templates.map((entry) => entry.id));
    const pageIds = new Set(config.pages.map((entry) => entry.id));
    if (config.pages.filter((page) => page.front).length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Exactly one front page is required.',
      });
    config.pages.forEach((page, index) => {
      if (page.front && page.condition && page.condition.op !== 'always')
        ctx.addIssue({
          code: 'custom',
          path: ['pages', index],
          message: 'The front page must be unconditional.',
        });
    });
    config.templates.forEach((template, index) => {
      for (const id of template.triggerIds)
        if (!triggerIds.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['templates', index],
            message: `Unknown trigger ${id}`,
          });
      for (const id of template.compositeOf)
        if (!templateIds.has(id) || id === template.id)
          ctx.addIssue({
            code: 'custom',
            path: ['templates', index],
            message: `Invalid composite template ${id}`,
          });
      if (new Set(template.variants.map((variant) => variant.id)).size !== template.variants.length)
        ctx.addIssue({
          code: 'custom',
          path: ['templates', index],
          message: 'Variant ids must be unique.',
        });
    });
    config.designs.forEach((design, index) => {
      for (const variant of ['ordinary', 'breaking']) {
        if (
          !design.layouts.some(
            (layout) =>
              layout.variant === variant &&
              (!layout.condition || layout.condition.op === 'always') &&
              layout.weight.base > 0 &&
              layout.weight.adjustments.length === 0
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['designs', index],
            message: `Every design requires an unconditional positive constant ${variant} layout.`,
          });
      }
      if (new Set(design.layouts.map((layout) => layout.id)).size !== design.layouts.length)
        ctx.addIssue({
          code: 'custom',
          path: ['designs', index],
          message: 'Layout ids must be unique.',
        });
      for (const id of Object.keys(design.pageLabels))
        if (!pageIds.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['designs', index, 'pageLabels'],
            message: `Unknown page ${id}`,
          });
      const { tokens, assets } = design.presentation;
      for (const id of [
        tokens?.bodyFontAssetId,
        tokens?.headingFontAssetId,
        tokens?.mastheadFontAssetId,
      ])
        if (id && getNewspaperAsset(id)?.kind !== 'font')
          ctx.addIssue({
            code: 'custom',
            path: ['designs', index],
            message: `Unknown font asset ${id}`,
          });
      if (assets?.ornamentAssetId && getNewspaperAsset(assets.ornamentAssetId)?.kind !== 'ornament')
        ctx.addIssue({
          code: 'custom',
          path: ['designs', index],
          message: `Unknown ornament asset ${assets.ornamentAssetId}`,
        });
    });
  });
export type EditorialConfig = z.infer<typeof editorialConfigSchema>;
