import { z } from 'zod';

/** Identity of one offline run or future campaign archive receiver. */
export const newspaperArchiveScopeSchema = z.object({
  runId: z.string().min(1).max(200).describe('Offline run identity.'),
  receiverPlayerID: z.number().int().min(0).max(21).describe('Receiving player.'),
});

/** Compact archive entry shared by offline readers and future live mirrors. */
export const newspaperArchiveIndexSchema = newspaperArchiveScopeSchema.extend({
  issueId: z.string().min(1).describe('Immutable issue identity.'),
  cutoffTurn: z.number().int().nonnegative().describe('Last covered turn.'),
  title: z.string().min(1).describe('Publication title.'),
  itemCount: z.number().int().positive().describe('Number of unique articles.'),
});

/** Optional archive selection; fuller filtering is added by the archive stage. */
export const newspaperArchiveQuerySchema = newspaperArchiveScopeSchema.partial();

export type NewspaperArchiveScope = z.infer<typeof newspaperArchiveScopeSchema>;
export type NewspaperArchiveIndex = z.infer<typeof newspaperArchiveIndexSchema>;
