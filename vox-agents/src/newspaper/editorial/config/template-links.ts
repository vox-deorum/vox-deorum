/** Resolve reusable link lists after the authored catalogue's layers are assembled. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { authoredTemplateSchema, rootTemplateSchema, type AuthoredVariant, type EditorialTemplate } from './schema.js';

type TemplateLinks = AuthoredVariant['links'];

const rootTemplatesSchema = z.array(rootTemplateSchema).superRefine((roots, ctx) => {
  const ids = new Set<string>();
  for (const [index, { id }] of roots.entries()) {
    if (ids.has(id))
      ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate root template id "${id}".` });
    ids.add(id);
  }
});

/** Read the optional root catalogue, checking each root before it can be overlaid. */
export async function readRootTemplates(directory: string): Promise<Map<string, TemplateLinks>> {
  const file = path.join(directory, 'root-templates.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON in ${file}.`, { cause });
  }
  const parsed = rootTemplatesSchema.safeParse(document);
  if (!parsed.success)
    throw new z.ZodError(parsed.error.issues.map(issue => ({ ...issue, path: [file, ...issue.path] })));
  return new Map(parsed.data.map(({ id, links }) => [id, links]));
}

/** Flatten inherited lists for the editor and desk, leaving authored rows untouched. */
export function resolveTemplateLinks(input: unknown, roots: ReadonlyMap<string, TemplateLinks>): EditorialTemplate[] {
  const catalogue = z.object({
    templates: z.array(authoredTemplateSchema).superRefine((templates, ctx) => {
      for (const [index, template] of templates.entries()) {
        const root = template.extends;
        if (root != null && !roots.has(root))
          ctx.addIssue({ code: 'custom', path: [index, 'extends'], message: `Unknown root template "${root}".` });
      }
    }),
  }).parse({ templates: input });
  return catalogue.templates.map(({ extends: root, links, merge, ...template }) => {
    const inherited = links ?? (root != null ? roots.get(root) : undefined) ?? [];
    /** A variant can inherit or explicitly supply the whole link list. */
    const resolveVariant = (variant: z.infer<typeof authoredTemplateSchema>['variants'][number]): AuthoredVariant =>
      ({ ...variant, links: variant.links ?? inherited });
    return {
      ...template,
      variants: template.variants.map(resolveVariant),
      ...(merge !== undefined && { merge: merge && { ...merge, variants: merge.variants.map(resolveVariant) } }),
    };
  });
}
