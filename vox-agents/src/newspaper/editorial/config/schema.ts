import { parse } from 'acorn';
import { z } from 'zod';
import { presentationSchema } from '../../contracts/design.js';
import { linkTargetSchema } from '../../contracts/issue.js';
import { variantStyleKinds, variantStyleSchema } from '../../contracts/style.js';
import { getNewspaperAsset } from '../../renderer/assets.js';
import { editorialCivicTermsSchema } from './civic-terms.js';
import { editorialConstantsSchema, editorialValueNameSchema } from './constants.js';
import { editorialLayoutSchema, editorialPageSchema, eligibleSchema, expressionSchema } from './layouts.js';
import { defaultVariantStyle, styleCatalogueSchema, styleMatchTags } from './styles.js';

export { editorialLayoutSchema, editorialPageSchema, type EditorialLayout } from './layouts.js';
/** A link list names the prose placeholder, display label and typed destination. */
const templateLinksSchema = z.array(z.object({
  placeholder: z.string().min(1),
  label: z.string().min(1),
  target: linkTargetSchema,
}));

/** Shared prose and style fields for authored and resolved variants. */
const variantProseSchema = eligibleSchema.extend({
  id: z.string().min(1),
  ...variantStyleSchema.partial().shape,
  headline: z.string().min(1),
  subheadline: z.string().min(1).optional(),
  byline: z.string().min(1).optional(),
  body: z.array(z.string().min(1)).min(1),
  settled: z.boolean().optional(),
});

/** A variant either picks all three style tags or uses the default style. */
function hasCompleteVariantStyle(variant: z.infer<typeof variantProseSchema>): boolean {
  return variantStyleKinds.every(kind => variant[kind] === undefined) ||
    variantStyleKinds.every(kind => variant[kind] !== undefined);
}

const completeVariantStyleMessage = 'Set voice, stance and genre together.';
/** Prose with a concrete link list in the editorial catalogue and saved decisions. */
const resolvedVariantSchema = variantProseSchema.extend({
  links: templateLinksSchema.default([]),
}).refine(hasCompleteVariantStyle, completeVariantStyleMessage);
export type AuthoredVariant = z.infer<typeof resolvedVariantSchema>;
/** Read a bare or quoted tier name; other expressions are resolved during rating. */
export function literalTierName(source: string): string | undefined {
  // Parse as one expression so comments, whitespace and parentheses match the evaluator.
  try {
    const prefix = '"use strict";\n';
    const wrapped = `${prefix}(\n${source}\n)`;
    const { body } = parse(wrapped, { ecmaVersion: 'latest', preserveParens: true });
    const statement = body[1];
    if (body.length !== 2 || statement?.type !== 'ExpressionStatement') return undefined;
    let expr = statement.expression;
    if (expr.type !== 'ParenthesizedExpression' || expr.start !== prefix.length || expr.end !== wrapped.length)
      return undefined;
    while (expr.type === 'ParenthesizedExpression') expr = expr.expression;
    if (expr.type === 'Identifier') return expr.name;
    if (expr.type === 'Literal' && typeof expr.value === 'string') return expr.value;
  } catch {
    // The expression compiler reports invalid JavaScript with its catalogue location.
  }
  return undefined;
}

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
  tier: expressionSchema,
  adjust: z.union([expressionSchema, z.array(expressionSchema)]).optional(),
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
/** Merge expressions combine qualifying stories before choosing a variant. */
const mergeTemplateSchema = z.strictObject({
  match: expressionSchema,
  min: z.number().int().positive(),
  priority: z.number().int().optional(),
  values: z.record(editorialValueNameSchema, expressionSchema).optional(),
  variants: z.array(resolvedVariantSchema).min(1),
});

/** Templates explicitly name supported triggers and any placeholder format overrides. */
export const templateSchema = eligibleSchema.extend({
  id: z.string().min(1),
  triggers: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)),
  formats: z.record(z.string().min(1), z.string().min(1)).default({}),
  names: z.array(z.string().min(1)).optional(),
  mode: z.enum(['authored', 'llmOnly']).default('authored'),
  short: z.boolean().default(false),
  variants: z.array(resolvedVariantSchema),
  merge: mergeTemplateSchema.nullish(),
});
export type EditorialTemplate = z.infer<typeof templateSchema>;

const inheritingVariantSchema = variantProseSchema.extend({
  links: templateLinksSchema.nullish(),
}).refine(hasCompleteVariantStyle, completeVariantStyleMessage);
/** Authored files can omit or reset links before resolving inheritance. */
export const authoredTemplateSchema = templateSchema.extend({
  extends: z.string().min(1).nullish(),
  links: templateLinksSchema.nullish(),
  variants: z.array(inheritingVariantSchema),
  merge: mergeTemplateSchema.extend({ variants: z.array(inheritingVariantSchema).min(1) }).nullish(),
});

/** A named list shared by story templates. */
export const rootTemplateSchema = z.strictObject({
  id: z.string().min(1),
  links: templateLinksSchema,
});

/** Version of the effective editorial catalogue saved with decisions. */
export const editorialConfigVersion = 3;

const designSchema = eligibleSchema.extend({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  civilizationTitles: z.record(z.string().min(1), z.string().trim().min(1)).nullable().optional(),
  motto: z.string().min(1).optional(),
  presentation: presentationSchema,
  layouts: z.array(editorialLayoutSchema).min(1),
  pageLabels: z.record(z.string(), z.string()).default({}),
});
export type EditorialDesign = z.infer<typeof designSchema>;
/** Authored masthead alternatives available only to the Node editor and its selected design. */
export const editorialMastheadRuleSchema = eligibleSchema.extend({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  motto: z.string().trim().min(1).optional(),
  pageLabels: z.record(z.string(), z.string().trim().min(1)).default({}),
  designs: z.array(z.string().min(1)).optional(),
});
export type EditorialMastheadRule = z.infer<typeof editorialMastheadRuleSchema>;
/** Complete effective catalogue snapshot stored in editorial decisions. */
export const editorialConfigSchema = z
  .object({
    version: z.literal(editorialConfigVersion),
    constants: editorialConstantsSchema,
    defaults: z.strictObject({
      frequencyStandardTurns: z.number().int().positive(),
      llmEnabled: z.boolean(),
      publicationTitle: z.string().min(1),
      /** Ranked stories available to the paper; the front needs four briefs and possibly a lead. */
      maxItems: z.number().int().min(5),
      importanceMax: z.number().positive(),
      decayPerTurn: z.number().min(0).max(1),
      seriesWeight: z.number().nonnegative(),
      noveltyBonus: z.number().nonnegative(),
      varietyBonus: z.number().nonnegative(),
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
    pages: z.array(editorialPageSchema).min(1),
    designs: z.array(designSchema).min(1),
    mastheadRules: z.array(editorialMastheadRuleSchema).optional(),
    styles: styleCatalogueSchema.optional(),
    civicTerms: editorialCivicTermsSchema.optional(),
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
      const tier = literalTierName(rule.tier);
      if (tier !== undefined && !Object.hasOwn(config.constants.tiers, tier))
        ctx.addIssue({ code: 'custom', path: ['triggers', index, 'tier'], message: `Unknown editorial tier "${tier}".` });
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
        if ((['distances', 'spans', 'sizes', 'shares', 'types', 'tiers'] as const).some(
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
    const designIds = new Set(config.designs.map((design) => design.id));
    const mastheadRuleIds = new Set<string>();
    config.mastheadRules?.forEach((rule, index) => {
      if (mastheadRuleIds.has(rule.id))
        ctx.addIssue({
          code: 'custom',
          path: ['mastheadRules', index, 'id'],
          message: `Duplicate masthead rule id ${rule.id}`,
        });
      mastheadRuleIds.add(rule.id);
      for (const id of Object.keys(rule.pageLabels))
        if (!pageIds.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['mastheadRules', index, 'pageLabels', id],
            message: `Unknown page ${id}`,
          });
      rule.designs?.forEach((id, designIndex) => {
        if (!designIds.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['mastheadRules', index, 'designs', designIndex],
            message: `Unknown design ${id}`,
          });
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
      const variantIds = new Set<string>();
      /** Validate variant identity across both prose lists and check style tags. */
      function checkVariants(variants: AuthoredVariant[], path: string[]) {
        variants.forEach((variant, variantIndex) => {
          const variantPath = ['templates', index, ...path, variantIndex];
          if (variantIds.has(variant.id))
            ctx.addIssue({ code: 'custom', path: [...variantPath, 'id'], message: 'Variant ids must be unique.' });
          variantIds.add(variant.id);
          checkStyleTags(variant, variantPath);
        });
      }
      checkVariants(template.variants, ['variants']);
      if (template.merge) checkVariants(template.merge.variants, ['merge', 'variants']);
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
