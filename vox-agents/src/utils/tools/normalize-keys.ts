/**
 * @module utils/tools/normalize-keys
 *
 * Realigns object KEY casing to a JSON Schema's canonical property names, recursively.
 *
 * Under shape-only constrained decoding — and even with some native tool-calling providers — the
 * model is free to pick key casing. A schema declares `Message` / `Term` / `Amount`, but the model
 * emits `message` / `term` / `amount`; because JSON/Zod object keys are case-sensitive, the declared
 * key is then effectively missing and validation rejects otherwise-valid input (an enum reports the
 * value as `undefined`). This util rewrites such keys back to the schema's casing *before*
 * validation, at every nesting level (objects and `items` arrays), so a lowercase `Give:[{term}]`
 * becomes `Give:[{Term}]`.
 *
 * It is deliberately conservative — the same guards the old flat helper used, now applied
 * recursively:
 *  - a key is renamed only when it case-insensitively matches a declared property AND that canonical
 *    key is not already claimed (in the input or by an earlier rename), so a genuine value is never
 *    silently clobbered or dropped;
 *  - unknown keys (no schema property) pass through untouched and un-recursed;
 *  - only `properties` (objects), `items` (arrays), and local `$ref`s are traversed; a property
 *    typed with a combinator (`anyOf` / `oneOf` / `allOf`) exposes no `properties` here, so keys
 *    nested under a union pass through un-normalized rather than being guessed at;
 *  - on a pure no-op it returns the *original* reference (identity-preserving), letting callers
 *    detect "nothing changed" cheaply and leave the payload byte-for-byte alone.
 *
 * It never throws on shape it doesn't recognize — it simply stops normalizing there and returns the
 * value unchanged. JSON Schema (not Zod) is the input contract because the tool-rescue middleware
 * already holds each tool's `inputSchema` as JSON Schema, and a Zod schema converts to one on demand
 * (`z.toJSONSchema`), making this the single representation both call sites can share.
 */

/** A permissive JSON Schema node. Only the structural keywords used for key alignment are read. */
export type JsonSchemaNode = Record<string, any>;

/** Resolve a local JSON Pointer `$ref` (e.g. `#/$defs/Foo`) against the root schema, if present. */
function resolveRef(ref: string, root: JsonSchemaNode | undefined): JsonSchemaNode | undefined {
  if (!root || typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node: any = root;
  for (const segment of ref.slice(2).split("/")) {
    if (!node || typeof node !== "object") return undefined;
    // Unescape JSON Pointer tokens (`~1` → `/`, `~0` → `~`).
    node = node[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return node && typeof node === "object" ? node : undefined;
}

/**
 * Follow a `$ref` chain to the schema node that actually describes the shape; identity otherwise.
 * Tracks visited refs so a pathological cycle (`#/$defs/A` → `#/$defs/B` → `#/$defs/A`) gives up
 * with `undefined` instead of recursing until the stack overflows.
 */
function deref(
  schema: JsonSchemaNode | undefined,
  root: JsonSchemaNode | undefined
): JsonSchemaNode | undefined {
  const seen = new Set<string>();
  let node = schema;
  while (node && typeof node === "object" && typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return undefined;
    seen.add(node.$ref);
    node = resolveRef(node.$ref, root);
  }
  return node && typeof node === "object" ? node : undefined;
}

/**
 * Recursively rewrite `value`'s object keys to the casing declared by `schema`. `root` carries the
 * top-level schema so nested `$ref`s resolve; it defaults to `schema` on the first call. Returns the
 * original reference whenever nothing changes at that node (identity-preserving no-op).
 */
export function normalizeKeysToSchema(
  value: unknown,
  schema: JsonSchemaNode | undefined,
  root: JsonSchemaNode | undefined = schema
): unknown {
  const node = deref(schema, root);
  if (!node) return value;

  // Array: recurse each element against the `items` schema.
  if (Array.isArray(value)) {
    const itemSchema = node.items;
    if (!itemSchema || typeof itemSchema !== "object") return value;
    let changed = false;
    const out = value.map((element) => {
      const next = normalizeKeysToSchema(element, itemSchema, root);
      if (next !== element) changed = true;
      return next;
    });
    return changed ? out : value;
  }

  // Object: remap keys to canonical property names, then recurse into each property's sub-schema.
  if (value && typeof value === "object") {
    const props = node.properties;
    if (!props || typeof props !== "object") return value;
    const canonicalByLower = new Map<string, string>(
      Object.keys(props).map((key) => [key.toLowerCase(), key])
    );

    let changed = false;
    const out: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(source)) {
      // Determine the key under which this entry should live: itself if already canonical, otherwise
      // the case-insensitive match — but only when that canonical key is still free (not in the input
      // and not already taken by an earlier rename), mirroring the flat helper's no-clobber guards.
      let outKey = key;
      if (!(key in props)) {
        const canonical = canonicalByLower.get(key.toLowerCase());
        if (canonical !== undefined && !(canonical in source) && !(canonical in out)) {
          outKey = canonical;
          changed = true;
        }
      }
      // Recurse into the (canonical) property's sub-schema when one exists; unknown keys pass through.
      const childSchema = (props as Record<string, JsonSchemaNode>)[outKey];
      const nextEntry = childSchema !== undefined ? normalizeKeysToSchema(entry, childSchema, root) : entry;
      if (nextEntry !== entry) changed = true;
      out[outKey] = nextEntry;
    }
    return changed ? out : value;
  }

  return value;
}
