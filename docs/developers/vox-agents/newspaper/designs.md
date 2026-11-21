# Newspaper designs

A newspaper design sets the colors, fonts, ornaments and page labels for an issue. The stories stay the same. The [renderer guide](renderer.md) covers rendering and export; the [editorial guide](editorial.md#pages-and-designs) covers when the editor chooses each design.

## Principles

1. **Keep the copy fixed.** Show the issue's masthead, tabs, stories, links, votes and evidence. Use typography and decoration for emphasis; omit invented dates, prices and “Breaking” labels.
2. **Use the printable width.** Keep a modest outer margin. If a line becomes too long, use the space beside it for a second column, a brief, a photo or a table. Avoid a fixed-width article floating in an empty sheet. Let short briefs run as one paragraph.
3. **Give each paper its own composition.** Start with a real reference and name the device you borrowed. A cast inscription can group stories inside a rim; a social feed can pair a dispatch with a photo. Change the arrangement as well as the type and colors.
4. **Give each ornament a job.** A design can use several motifs. Reserve the most recognizable one for a particular place: the Ancient paper uses the Greek key at the sheet edges and a single palm above a breaking headline. A divider needs no extra rules or blank bands around it.
5. **Use texture when it suits the material.** Crossed strips suggest papyrus, scattered fibres suggest handmade paper, and curved seams suggest turtle shell. Keep the grain faint behind print. Check the smallest text, links and table figures at phone width and on an exported page.
6. **Use color tokens for simple marks.** Fill frames, dividers and initials with the paper, ink or accent color. Use a local image for more intricate artwork. Give the figures in article text (`vd-number`) a treatment appropriate to the design.
7. **Keep tintable designs legible.** The feed derives its palette from one accent. Check both dark and pale tints, including text on a solid fill. Reserve red alerts for breaking pages.
8. **Protect reading space on narrow papers.** Stack columns, shrink or remove side ornaments and scale display type before reducing body text. Keep section tabs and evidence readable.

## Families and designs

A renderer family is a layout structure that several designs can share. A design is one variant of a family, with its own tokens, fonts, assets and page labels. Add a new look as a design first, and add a family only for a new structure.

| Family | Structure | Stock design | Real-world references |
| --- | --- | --- | --- |
| `inscription` | Framed, centred notice board | `oral-accounts`, e.g. Annals of Rome | The Roman *Acta Diurna* notice board, painted election notices at Pompeii (red and black), Trajan's Column capitals (Cinzel), the *tabula ansata* panel for the masthead, Greek key friezes, and the *hedera* ivy leaf as divider |
| `folio` | Framed writing field | `shang`, Records of the Shang Court | The paired eyes and symmetrical horns of a [Shang bronze cauldron](https://www.metmuseum.org/art/collection/search/60594) crown the masthead. Inside the bronze rim, pale seams and growth rings trace the plates of a turtle shell. |
| `folio` | Stacked painted registers | `egypt`, The Two Lands Register or The Nubian Ledger | The [agricultural registers in Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438) inspire the horizontal bands. A winged sun and ochre rules sit on pale papyrus with fine horizontal fibres over broader vertical strips. |
| `folio` | Letters on dyed paper | `heian`, e.g. Letters from the Heian Court | The dyed sheets of the [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en) inspire the wisteria tint. Fine grain and scattered fibres suggest handmade washi. A flowering branch opens the ordinary edition; a folded slip closes the page. |
| `broadsheet` | Ruled multi-column print page | `victorian`, e.g. Chronicle of France | *The Illustrated London News* and *Harper's Weekly* mastheads with medallion ears, *The Times* Oxford rules, printers' factotum initials and fleurons, and *Le Petit Journal* for the breaking edition |
| `feed` | Full-width timeline | `wire`, e.g. France Wire | Social timelines such as Bluesky: round avatars, a byline above each post and an action row below. Wide posts put photos or data cards beside the text. |

Every design has three front-page layouts. An ordinary page opens with one story followed by briefs. A breaking page gives the lead the most space. An analysis page pairs it with an evidence table. On a narrow sheet, the table follows the lead text.

## Rendering constraints

Designs must keep these rules so the browser reader and the game texture match:

- Horizontal page margins come from the family's layout defaults in `src/newspaper/renderer/layout.ts`, because export measures content at that width. Change the default there rather than overriding horizontal page padding in CSS.
- Decoration on the selected tab is limited to reader mode, because the game draws the selected tab itself.
- Avoid CSS `filter`, which makes export paints nondeterministic.
- A reader-only decoration needs an export counterpart. The ancient design's bottom frieze stays fixed under the scrolling page in the browser; exported pages end with the same frieze instead.

## Add or change a design

1. Add or edit the design JSON in `vox-agents/newspaper/designs/`. Choose its family, tokens, fonts, assets, layouts and page labels, then set its [era and civilization weights](editorial.md#pages-and-designs).
2. Keep shared layout rules in `vox-agents/newspaper/src/reader/families/<family>.css`, scoped by `data-design`. Scope a design’s own stylesheet by `data-publication-design` and import it after its family in `reader.css`.
3. Put design-owned artwork in `newspaper/public/assets/designs/<design id>/` and register it as described in the [asset notes](editorial.md#design-assets).
4. In the preview (`npm run newspaper:preview -w vox-agents`), check every layout at wide and narrow widths. Enter a civilization to try its masthead, and try several tints for the feed family.
