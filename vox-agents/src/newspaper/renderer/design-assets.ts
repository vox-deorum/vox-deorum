/** Browser-safe validation of asset definitions authored on built-in designs. */
import { isRecord } from "../../utils/guards.js";
import type { NewspaperAsset } from "./assets.js";

/** Keep the namespace separator out of design IDs and local IDs. */
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Match a portable directory-relative asset path under assets/. */
const assetPathPattern = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Match an image media type for a design-owned asset. */
const mediaTypePattern = /^image\/[A-Za-z0-9.+-]+$/;

/** Return a required nonempty string field or report its authored location. */
function readString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${where} needs a nonempty ${field}.`);
  return value;
}

/** Return a required positive integer field or report its authored location. */
function readSize(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    throw new Error(`${where} needs a positive integer ${field}.`);
  return value;
}

/** Normalize one authored definition into a globally identified asset record. */
function normalizeDefinition(designId: string, value: unknown, index: number): NewspaperAsset {
  const where = `Design "${designId}" assetDefinitions[${index}]`;
  if (!isRecord(value)) throw new Error(`${where} must be an object.`);
  const localId = readString(value, "id", where);
  if (!identifierPattern.test(localId))
    throw new Error(`${where} has an invalid id "${localId}".`);
  const kind = readString(value, "kind", where);
  if (kind !== "image" && kind !== "ornament")
    throw new Error(`${where} has unsupported kind "${kind}".`);
  const path = readString(value, "path", where);
  if (!assetPathPattern.test(path))
    throw new Error(`${where} has an unsafe asset path "${path}".`);
  const mediaType = readString(value, "mediaType", where);
  if (!mediaTypePattern.test(mediaType))
    throw new Error(`${where} has an invalid mediaType "${mediaType}".`);
  return {
    id: `${designId}.${localId}`,
    kind,
    path,
    mediaType,
    width: readSize(value, "width", where),
    height: readSize(value, "height", where),
    license: readString(value, "license", where),
    attribution: readString(value, "attribution", where),
  };
}

/** Build the design-owned assets, rejecting invalid declarations and derived ID collisions. */
export function normalizeDesignAssets(documents: readonly unknown[]): Map<string, NewspaperAsset> {
  const assets = new Map<string, NewspaperAsset>();
  for (const document of documents) {
    if (!Array.isArray(document))
      throw new Error("Every built-in newspaper design file must hold an array of designs.");
    for (const design of document) {
      if (!isRecord(design))
        throw new Error("Every built-in newspaper design entry must be an object.");
      const definitions = design.assetDefinitions;
      if (definitions === undefined) continue;
      const designId = readString(design, "id", "Design");
      if (!identifierPattern.test(designId))
        throw new Error(`Design "${designId}" has an invalid id.`);
      if (!Array.isArray(definitions))
        throw new Error(`Design "${designId}" assetDefinitions must be an array.`);
      definitions.forEach((definition, index) => {
        const asset = normalizeDefinition(designId, definition, index);
        if (assets.has(asset.id))
          throw new Error(`Duplicate newspaper asset id "${asset.id}".`);
        assets.set(asset.id, asset);
      });
    }
  }
  return assets;
}
