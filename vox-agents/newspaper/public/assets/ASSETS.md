# Newspaper reader assets

The registry in `vox-agents/src/newspaper/renderer/assets.ts` holds fonts and vote icons shared by every design. Illustrations and ornaments are declared by the built-in files under `vox-agents/newspaper/designs/`. The renderer registers each design-local definition as `<design id>.<local id>`. Vite copies this directory into the compiled reader.

The thirteen font faces come from the prototype assets. Bodoni Moda, Libre Caslon Text, Inter, and UnifrakturMaguntia retain their SIL Open Font License texts in `licenses/`.

The harbour and container-port illustrations were generated with image_gen for the newspaper prototypes. The Victorian scrollwork follows the prototype ornament. The vote icons provide separate neutral and selected states for each design. These project artwork assets follow the repository license.

To add an illustration or ornament:

1. Add the file under `public/assets/` and use its path relative to `public/`.
2. Add an `assetDefinitions` entry to the design that owns it under `vox-agents/newspaper/designs/`. Use `kind` `image` or `ornament` and include the media type, both dimensions, license, and attribution. Authored definitions belong to built-in designs.
3. Reference the derived ID, such as `victorian.scrollwork`, from the design's presentation or, for an illustration, an article.
4. Rebuild the reader with `npm run build:newspaper -w vox-agents`.

Asset URLs are relative to the served reader directory. Paths must stay under `assets/` without dot segments or URL syntax. Keep the declared paths and the files together when packaging.
