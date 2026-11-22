import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import type { DeskCatalogueResponse, DeskRef, DeskSettleRequest, DeskVariantDetail } from '../../types/api.js';
import { errorMessage } from '../../utils/errors.js';
import { sendError } from '../../web/http-utils.js';
import { deskChoicesLimit } from './batch.js';
import { DeskError, deskTriggers, readDeskCatalogue } from './catalogue.js';
import { deskVariantStyle, findDeskVariant } from './brief.js';
import { clearCandidates, deskModelNames, getCandidates, getCurrentJob, startJob, stopJob, type DeskWriter } from './generate.js';
import { settleVariant, unsettleVariant } from './settle.js';
import { templateVariables } from './variables.js';

const refSchema = z.object({ templateId: z.string().min(1), variantId: z.string().min(1) });
const batchSchema = z.object({
  refs: z.array(refSchema).min(1),
  models: z.array(z.string().min(1)).min(1),
  choices: z.number().int().min(1).max(deskChoicesLimit),
});
const revisionSchema = z.object({ revision: z.string().min(1) });
const copySchema = revisionSchema.extend({
  headline: z.string(),
  subheadline: z.string().optional(),
  byline: z.string().optional(),
  body: z.array(z.string()),
});

/** Adapt a desk operation to the common JSON error boundary. */
function reply(operation: (request: express.Request) => unknown): RequestHandler {
  return async (req, res) => {
    try {
      res.json(await operation(req));
    } catch (error) {
      const status = error instanceof DeskError ? error.status : error instanceof ZodError ? 400 : 500;
      sendError(res, status, errorMessage(error));
    }
  };
}

/** Read a variant address from the route. */
function refFrom(req: express.Request): DeskRef {
  return refSchema.parse(req.params);
}

/** Return the list without shipping article bodies, siblings, or candidate text. */
async function catalogueSummary(): Promise<DeskCatalogueResponse> {
  const { available, reason, templates } = await readDeskCatalogue();
  return {
    available, reason,
    models: available ? deskModelNames() : [],
    templates: templates.map(({ id, file, tags, triggerSummary, variants }) => ({
      id, file, tags, triggerSummary,
      variants: variants.map(variant => ({
        id: variant.id, headline: variant.text.headline, settled: variant.settled, style: deskVariantStyle(variant),
        candidateCount: variant.settled ? 0 : getCandidates({ templateId: id, variantId: variant.id }).length,
      })),
    })),
  };
}

/** Return the full writing and context for one stock variant. */
async function variantDetail(ref: DeskRef): Promise<DeskVariantDetail> {
  const catalogue = await readDeskCatalogue();
  if (!catalogue.available) throw new DeskError(503, catalogue.reason ?? 'The Writing Desk is unavailable.');
  const found = findDeskVariant(catalogue, ref);
  if (!found) throw new DeskError(404, 'Stock variant not found.');
  const { template, variant } = found;
  const { text, settled, revision } = variant;
  const triggers = deskTriggers(template, catalogue).map(({ id, subject, when, values, group }) => ({ id, subject, when, values, group }));
  return {
    ...ref, text, settled, revision, style: deskVariantStyle(variant), triggers,
    variables: templateVariables(template, catalogue, variant),
    siblings: template.variants.filter(item => item !== variant).map(({ id, text }) => ({ id, text })),
    candidates: settled ? [] : getCandidates(ref),
  };
}

/** Save or reopen one variant and clear any drafts for its earlier revision. */
async function updateVariant(ref: DeskRef, request: DeskSettleRequest | { revision: string }): Promise<DeskVariantDetail> {
  const { revision } = request;
  if ('headline' in request) {
    const { headline, subheadline, byline, body } = request;
    await settleVariant(ref, { headline, subheadline, byline, body }, revision, { onChange: clearCandidates });
  } else {
    await unsettleVariant(ref, revision, { onChange: clearCandidates });
  }
  return variantDetail(ref);
}

/** Install desk handlers and their JSON parser ahead of the newspaper API fallback. */
export function mountDeskRoutes(app: Express, writer?: DeskWriter): void {
  const router = express.Router();
  const variantPath = '/templates/:templateId/variants/:variantId';
  router.use(express.json({ limit: '256kb' }));
  router.get('/', reply(catalogueSummary));
  router.get(variantPath, reply(req => variantDetail(refFrom(req))));
  router.post('/jobs', reply(req => startJob(batchSchema.parse(req.body), writer)));
  router.get('/jobs/current', reply(getCurrentJob));
  router.post('/jobs/current/stop', reply(stopJob));
  router.post(variantPath + '/settle', reply(req => updateVariant(refFrom(req), copySchema.parse(req.body))));
  router.post(variantPath + '/unsettle', reply(req => updateVariant(refFrom(req), revisionSchema.parse(req.body))));

  /** Return parser failures in the same format as desk errors. */
  const parserError: ErrorRequestHandler = (error, _req, res, _next) => {
    sendError(res, error.type === 'entity.too.large' ? 413 : 400, errorMessage(error));
  };
  router.use(parserError);
  app.use('/api/newspaper/desk', router);
}
