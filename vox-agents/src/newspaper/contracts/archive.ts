import { z } from 'zod';
import { newspaperArchiveIndexSchema, newspaperArchiveScopeSchema } from '../../../../mcp-server/dist/newspaper/protocol.js';
import { issueDocumentSchema } from './issue.js';
import { archivedDecisionSchema, publishedItemRecordSchema } from './publication.js';

/** Stored current coverage preference, independent of a particular page placement. */
export const archiveVoteSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

/** Ordered entries belonging to the configured receiver and replay run. */
export const archiveListSchema = z.object({ issues: z.array(newspaperArchiveIndexSchema) });

/** Immutable content and historical decision paired with today's replaceable votes. */
export const archiveIssueSchema = z.object({
  index: newspaperArchiveIndexSchema,
  issue: issueDocumentSchema,
  votes: z.record(z.string(), archiveVoteSchema),
  decision: archivedDecisionSchema,
  articles: z.array(publishedItemRecordSchema),
});

/** A scope is required on mutations so stale tabs cannot alter another replay. */
export const archiveVoteRequestSchema = newspaperArchiveScopeSchema.extend({
  itemId: z.string().min(1), value: archiveVoteSchema,
});

export type ArchiveIssue = z.infer<typeof archiveIssueSchema>;
export type ArchiveList = z.infer<typeof archiveListSchema>;
