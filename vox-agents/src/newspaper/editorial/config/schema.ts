import { z } from 'zod';
import { presentationSchema } from '../../contracts/design.js';
import { newspaperLayoutVariantSchema, linkTargetSchema } from '../../contracts/issue.js';
import { variantStyleKinds, variantStyleSchema } from '../../contracts/style.js';
import { getNewspaperAsset } from '../../renderer/assets.js';
import { editorialConstantsSchema, editorialValueNameSchema } from './constants.js';
import { defaultVariantStyle, styleCatalogueSchema, styleMatchTags } from './styles.js';

const expressionSchema = z.string().refine((source) => source.trim().length > 0, 'Expected an expression.');
const weightSchema = z.strictObject({
  base: z.number().finite(),
  adjustments: z.array(z.strictObject({ when: expressionSchema, add: z.number().finite() })).default([]),
});
const eligibleSchema = z.strictObject({ when: expressionSchema.optional(), weight: weightSchema });
/** Authored prose uses named placeholders and explicit typed link destinations. */
export const authoredVariantSchema = eligibleSchema.extend({
  id: z.string().min(1),
  ...variantStyleSchema.partial().shape,
  headline: z.string().min(1),
  subheadline: z.string().min(1).optional(),
  byline: z.string().min(1).optional(),
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
}).refine(
  (variant) => variantStyleKinds.every((kind) => variant[kind] === undefined) ||
    variantStyleKinds.every((kind) => variant[kind] !== undefined),
  'Set voice, stance and genre together.',
);
export type AuthoredVariant = z.infer<typeof authoredVariantSchema>;
const spanSchema = z.union([z.string().min(1), z.number().positive()]);
const eventTypesSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

/** A rule runs on one kind of fact subject and reports the developments it finds. */
export const editorialTriggerRuleSchema = z.strictObject({
  id: z.string().min(1),
  subject: z.enum(['city', 'player', 'pair', 'event', 'incident', 'world']),
  event: eventTypesSchema.optional(),
  window: spanSchema.optional(),
  when: z.union([expressionSchema, z.array(expressionSchema).min(1)]),
  values: z.record(editorialValueNameSchema, expressionSchema).optional(),
  importance: z.union([z.number(), expressionSchema]).optional(),
  urgent: expressionSchema.optional(),
  group: z.strictObject({ by: expressionSchema, min: z.number().int().positive().optional() }).optional(),
  chance: z.number().min(0).max(1).optional(),
  repeat: spanSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().optional(),
}).superRefine((rule, ctx) => {
  if (rule.subject === 'event' && rule.event === undefined)
    ctx.addIssue({ code: 'custom', path: ['event'], message: 'Set event to a type name or a nonempty list of type names.' });
  else if (rule.subject !== 'event' && rule.event !== undefined)
    ctx.addIssue({ code: 'custom', path: ['event'], message: 'Remove event or change the subject to event.' });
});
export type EditorialTriggerRule = z.infer<typeof editorialTriggerRuleSchema>;
/** Templates explicitly name supported triggers. */
const templateSchema = eligibleSchema.extend({
  id: z.string().min(1),
  triggers: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)),
  mode: z.enum(['authored', 'llmOnly']).default('authored'),
  short: z.boolean().default(false),
  variants: z.array(authoredVariantSchema),
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
  motto: z.string().min(1).optional(),
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
      minItems: z.number().int().positive().optional(),
      maxItems: z.number().int().positive(),
      frontPageItems: z.number().int().min(2),
      importanceMax: z.number().positive(),
      decayPerTurn: z.number().min(0).max(1),
      seriesWeight: z.number().nonnegative(),
      noveltyBonus: z.number().nonnegative(),
      varietyBonus: z.number().nonnegative(),
      designStickiness: z.number().min(0).max(1),
      styleRepeat: z.strictObject({
        voice: z.number().finite().positive(),
        stance: z.number().finite().positive(),
        genre: z.number().finite().positive(),
      }).default({ voice: 1, stance: 1, genre: 0.8 }),
      feedback: z.object({
        window: z.number().int().positive(),
        series: z.number().nonnegative(),
        tag: z.number().nonnegative(),
        bound: z.number().nonnegative(),
      }),
    }),
    triggers: z.array(editorialTriggerRuleSchema),
    templates: z.array(templateSchema),
    pages: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          label: z.string().min(1),
          tags: z.array(z.string()),
          minimum: z.number().int().positive(),
          order: z.number(),
          front: z.boolean().default(false),
          when: expressionSchema.optional(),
        })
      )
      .min(1),
    designs: z.array(designSchema).min(1),
    styles: styleCatalogueSchema.optional(),
  })
  .superRefine((config, ctx) => {
    if ((config.defaults.minItems ?? 1) > config.defaults.maxItems)
      ctx.addIssue({ code: 'custom', path: ['defaults', 'minItems'], message: 'The edition minimum cannot exceed the edition cap.' });
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
    /** Index one style section while reporting duplicate IDs at their source. */
    function indexStyleIds(section: string, entries: readonly { id: string }[]): Set<string> {
      const ids = new Set<string>();
      for (const [index, { id }] of entries.entries()) {
        if (ids.has(id))
          ctx.addIssue({ code: 'custom', path: ['styles', section, index, 'id'], message: `Duplicate style ID "${id}".` });
        ids.add(id);
      }
      return ids;
    }
    const styleIds = new Map(variantStyleKinds.map(kind => {
      const ids = config.styles ? indexStyleIds(kind, config.styles[kind]) : new Set<string>([defaultVariantStyle[kind]]);
      if (!ids.has(defaultVariantStyle[kind]))
        ctx.addIssue({ code: 'custom', path: ['styles', kind], message: `Register the default ${kind} tag "${defaultVariantStyle[kind]}".` });
      return [kind, ids] as const;
    }));
    /** Check each explicit tag against its kind in the same effective catalogue. */
    function checkStyleTags(tags: Partial<z.infer<typeof variantStyleSchema>>, path: (string | number)[]): void {
      for (const kind of variantStyleKinds) {
        const id = tags[kind];
        if (id !== undefined && !styleIds.get(kind)?.has(id))
          ctx.addIssue({ code: 'custom', path: [...path, kind], message: `Unknown ${kind} tag "${id}".` });
      }
    }
    if (config.styles) {
      indexStyleIds('rules', config.styles.rules);
      config.styles.rules.forEach((rule, index) => {
        for (const kind of variantStyleKinds) {
          const tags = styleMatchTags(rule.match[kind]);
          if (!tags) continue;
          const seen = new Set<string>();
          for (const id of tags) {
            if (seen.has(id))
              ctx.addIssue({ code: 'custom', path: ['styles', 'rules', index, 'match', kind], message: `Duplicate ${kind} tag "${id}".` });
            else if (!styleIds.get(kind)?.has(id))
              ctx.addIssue({ code: 'custom', path: ['styles', 'rules', index, 'match', kind], message: `Unknown ${kind} tag "${id}".` });
            seen.add(id);
          }
        }
      });
    }
    const rulesById = new Map(config.triggers.map((rule) => [rule.id, rule]));
    config.triggers.forEach((rule, index) => {
      for (const field of ['window', 'repeat'] as const) {
        const span = rule[field];
        if (field === 'repeat' && (span === 'rearm' || span === 'once')) continue;
        if (typeof span === 'string' && !Object.hasOwn(config.constants.spans, span))
          ctx.addIssue({
            code: 'custom',
            path: ['triggers', index, field],
            message: `Unknown editorial span "${span}".`,
          });
      }
      for (const name of Object.keys(rule.values ?? {}))
        if ((['distances', 'spans', 'sizes', 'shares', 'types'] as const).some(
          (group) => Object.hasOwn(config.constants[group], name)
        ))
          ctx.addIssue({
            code: 'custom',
            path: ['triggers', index, 'values', name],
            message: `Value "${name}" collides with a named constant.`,
          });
    });
    const pageIds = new Set(config.pages.map((entry) => entry.id));
    if (config.pages.filter((page) => page.front).length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Exactly one front page is required.',
      });
    config.pages.forEach((page, index) => {
      if (page.front && page.when !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['pages', index],
          message: 'The front page must be unconditional.',
        });
    });
    config.templates.forEach((template, index) => {
      if (new Set(template.triggers).size !== template.triggers.length)
        ctx.addIssue({
          code: 'custom',
          path: ['templates', index, 'triggers'],
          message: 'Template trigger ids must be unique.',
        });
      const scopes = new Set<string>();
      for (const id of template.triggers) {
        const rule = rulesById.get(id);
        if (!rule)
          ctx.addIssue({
            code: 'custom',
            path: ['templates', index],
            message: `Unknown trigger ${id}`,
          });
        else
          scopes.add(`${rule.subject}/${rule.group ? 'grouped' : 'ungrouped'}`);
      }
      if (scopes.size > 1)
        ctx.addIssue({
          code: 'custom',
          path: ['templates', index, 'triggers'],
          message: 'Template triggers must use the same subject kind and must either all group their matches or all leave them ungrouped.',
        });
      if (new Set(template.variants.map((variant) => variant.id)).size !== template.variants.length)
        ctx.addIssue({
          code: 'custom',
          path: ['templates', index],
          message: 'Variant ids must be unique.',
        });
      template.variants.forEach((variant, variantIndex) =>
        checkStyleTags(variant, ['templates', index, 'variants', variantIndex]));
    });
    config.designs.forEach((design, index) => {
      for (const variant of ['ordinary', 'breaking']) {
        if (
          !design.layouts.some(
            (layout) =>
              layout.variant === variant &&
              layout.when === undefined &&
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
