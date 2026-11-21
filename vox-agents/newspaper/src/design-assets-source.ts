/**
 * Browser source of asset definitions authored on built-in newspaper designs.
 *
 * Vite aliases the renderer's Node adapter specifier to this module.
 */
const designDocuments = import.meta.glob("../designs/*.json", {
  import: "default",
  eager: true,
  exhaustive: true,
});

/** Read built-in design documents from the bundled catalogue in filename order. */
export function readBuiltInDesignDocuments(): unknown[] {
  return Object.keys(designDocuments)
    .sort()
    .map((name) => designDocuments[name]);
}
