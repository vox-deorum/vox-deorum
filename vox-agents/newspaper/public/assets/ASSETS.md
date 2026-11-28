# Newspaper reader assets

The registry in `vox-agents/src/newspaper/renderer/assets.ts` holds shared fonts and per-family vote icons. Built-in designs under `vox-agents/newspaper/designs/` declare their own ornaments and illustrations, and the renderer registers each design-local definition as `<design id>.<local id>`. Vite copies this directory into the compiled reader.

Folders group assets by owner:

| Folder | Owner | Contents |
| --- | --- | --- |
| `fonts/`, `licenses/` | Shared | Font faces and their OFL license texts for Bodoni Moda, Libre Caslon Text, Inter, UnifrakturMaguntia, Cinzel, and Cardo |
| `families/<family>/` | Renderer family | Vote icons: `vote-up-neutral.svg`, `vote-up-selected.svg`, `vote-down-neutral.svg`, `vote-down-selected.svg`, registered as `vote-<family>-<direction>-<state>` |
| `designs/<design id>/` | One design | Ornaments and illustrations used by that design |

Cinzel supplies weights 400, 700 and 900. Cardo supplies 400, 700 and 400 italic. Both come from Google Fonts and keep their OFL texts in `licenses/` as `cinzel-OFL.txt` and `cardo-OFL.txt`. The other font families retain their existing license files.

The generated illustrations are `designs/steam-press-broadsheet/harbour.png` (`steam-press-broadsheet.harbour`) and `designs/endless-scroll/port.png` (`endless-scroll.port`). The authored SVG ornament is the scrollwork cartouche in `designs/steam-press-broadsheet/scrollwork.svg` (`steam-press-broadsheet.scrollwork`). Each renderer family owns its neutral and selected vote icons. These project artwork assets follow the repository license. Family stylesheets draw decorations as pseudo-elements with inline SVG masks, so they add no asset loads.

To add an illustration or ornament:

1. Add the file under `public/assets/designs/<design id>/` and use its path relative to `public/`, such as `assets/designs/steam-press-broadsheet/new-illustration.png`.
2. Add an `assetDefinitions` entry to the design that owns it under `vox-agents/newspaper/designs/`. Use `kind` `image` or `ornament` and include the media type, both dimensions, license, and attribution. Authored definitions belong to built-in designs.
3. Reference the derived ID, such as `steam-press-broadsheet.scrollwork`, from the design's presentation or, for an illustration, an article.
4. Rebuild the reader with `npm run build:newspaper -w vox-agents`.

Asset URLs are relative to the served reader directory. Paths must stay under `assets/` without dot segments or URL syntax. Keep the declared paths and the files together when packaging.
