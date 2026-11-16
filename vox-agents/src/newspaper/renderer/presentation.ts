/** Resolve stored publication choices without consulting mutable editorial configuration. */
import { newspaperDesignIdSchema, type IssuePublication, type NewspaperDesignId } from "../contracts/issue.js";

/** Select the supported renderer family from a stored snapshot or a legacy fixture. */
export function getPublicationRendererFamily(publication: IssuePublication): NewspaperDesignId {
  return publication.presentation?.rendererFamily ?? newspaperDesignIdSchema.parse(publication.designId);
}

/** Resolve the stored decorative asset, retaining the original fixture field. */
export function getPublicationOrnament(publication: IssuePublication): string | undefined {
  return publication.presentation ? publication.presentation.assets?.ornamentAssetId : publication.ornamentAssetId;
}
