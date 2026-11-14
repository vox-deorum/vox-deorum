# Newspaper reader assets

The registry in `vox-agents/src/newspaper/renderer/assets.ts` names the assets used by the Victorian and modern designs. Vite copies this directory into the compiled reader.

The thirteen font faces come from the prototype assets. Bodoni Moda, Libre Caslon Text, Inter, and UnifrakturMaguntia retain their SIL Open Font License texts in `licenses/`.

The harbour and container-port illustrations were generated with image_gen for the newspaper prototypes. The Victorian scrollwork follows the prototype ornament. The vote icons provide separate neutral and selected states for each design. These project artwork assets follow the repository license.

Asset URLs are relative to the served reader directory. Keep the registry paths and the files together when packaging.
