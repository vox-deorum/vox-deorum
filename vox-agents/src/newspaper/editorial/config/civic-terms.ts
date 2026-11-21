/** Validate authored civic vocabulary and its optional tiered policy profiles. */
import { z } from 'zod';

/** Slots every catalogue supplies before profiles and civilizations refine them. */
const coreSlots = ['government', 'people', 'leaderTitle', 'leaderAddress'] as const;

const slotNamePattern = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
const civicSlotNameSchema = z.string().regex(slotNamePattern, 'Expected a term slot identifier.');
const civicTermSchema = z.string().trim().min(1);
const civicTermsSchema = z.record(civicSlotNameSchema, civicTermSchema);
const civicErasSchema = z.array(z.string().trim().min(1)).min(1).optional();

/** Neutral words used whenever a policy profile does not replace a slot. */
const civicDefaultsSchema = civicTermsSchema.superRefine((defaults, ctx) => {
  for (const slot of coreSlots)
    if (!Object.hasOwn(defaults, slot))
      ctx.addIssue({ code: 'custom', path: [slot], message: `Declare the ${slot} term.` });
});

/** A policy branch competes with peers of the same tier when it is present. */
export const civicBranchProfileSchema = z.strictObject({
  tier: z.number().int().positive(),
  terms: civicTermsSchema,
  eras: civicErasSchema,
});

/** An ideology applies before branches when its derived or present name matches. */
export const civicIdeologyProfileSchema = z.strictObject({
  terms: civicTermsSchema,
  eras: civicErasSchema,
});

/** Civilization overrides refine general words and the winning policy profile. */
export const civicCivilizationSchema = z.strictObject({
  terms: civicTermsSchema.optional(),
  branches: z.record(z.string().trim().min(1), civicTermsSchema).optional(),
  ideologies: z.record(z.string().trim().min(1), civicTermsSchema).optional(),
});

export const editorialCivicTermsSchema = z
  .strictObject({
    defaults: civicDefaultsSchema,
    branches: z.record(z.string().trim().min(1), civicBranchProfileSchema.nullable()).optional(),
    ideologies: z.record(z.string().trim().min(1), civicIdeologyProfileSchema.nullable()).optional(),
    civilizations: z.record(z.string().trim().min(1), civicCivilizationSchema.nullable()).optional(),
  })
  .superRefine((civic, ctx) => {
    const slots = new Set(Object.keys(civic.defaults));

    /** Check overrides against the slots this catalogue actually declares. */
    function checkSlots(terms: Readonly<Record<string, string>>, path: (string | number)[]): void {
      for (const slot of Object.keys(terms))
        if (!slots.has(slot))
          ctx.addIssue({
            code: 'custom',
            path: [...path, slot],
            message: `Override the declared term slot "${slot}".`,
          });
    }

    for (const [name, profile] of Object.entries(civic.branches ?? {}))
      if (profile) checkSlots(profile.terms, ['branches', name, 'terms']);
    for (const [name, profile] of Object.entries(civic.ideologies ?? {}))
      if (profile) checkSlots(profile.terms, ['ideologies', name, 'terms']);
    for (const [name, civilization] of Object.entries(civic.civilizations ?? {})) {
      if (!civilization) continue;
      if (civilization.terms) checkSlots(civilization.terms, ['civilizations', name, 'terms']);
      for (const [branch, terms] of Object.entries(civilization.branches ?? {}))
        checkSlots(terms, ['civilizations', name, 'branches', branch]);
      for (const [ideology, terms] of Object.entries(civilization.ideologies ?? {}))
        checkSlots(terms, ['civilizations', name, 'ideologies', ideology]);
    }
  });

export type EditorialCivicTerms = z.infer<typeof editorialCivicTermsSchema>;
