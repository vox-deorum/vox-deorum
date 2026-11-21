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
| `folio` | Clay tablet with incised rules | `clay-chronicle`, The Clay Chronicle | The [Babylonian Chronicle tablets](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en) inspire the warm clay, low masthead and stylus marks. Shallow rules separate the news entries. |
| `folio` | Stacked painted registers | `egypt`, The Two Lands Register or The Nubian Ledger | The [agricultural registers in Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438) inspire the horizontal bands. A winged sun and ochre rules sit on pale papyrus with fine horizontal fibres over broader vertical strips. |
| `folio` | Letters on dyed paper | `heian`, e.g. Letters from the Heian Court | The dyed sheets of the [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en) inspire the wisteria tint. Fine grain and scattered fibres suggest handmade washi. A flowering branch opens the ordinary edition; a folded slip closes the page. |
| `folio` | Accordion panels | `folded-chronicle`, The Maya Chronicle | The [Dresden Maya Codex](https://www.slub-dresden.de/en/explore/manuscripts/the-dresden-maya-codex/content) lends its folded sheet and red ruling. On wide sheets the lead opens across two panels, with the first brief in the third. At phone width, clay rules separate the stacked stories. |
| `folio` | Ruled shipping list | `port-register`, e.g. The Dutch Port Register | An early [Lloyd’s List](https://assets.lloyds.com/media/fe594686-4cc1-4f4d-92ca-b013225d3cfb/Lloyd%27s_pocket_guide_v11Oct23.pdf) inspires the compact masthead and ruled entries. On a wide sheet, headlines sit to the left of their reports. On a narrow sheet, each heading sits above its report. |
| `broadsheet` | Ruled multi-column print page | `victorian`, e.g. Chronicle of France | *The Illustrated London News* and *Harper's Weekly* mastheads with medallion ears, *The Times* Oxford rules, printers' factotum initials and fleurons, and *Le Petit Journal* for the breaking edition |
| `folio` | Ruled vellum with briefs in the outer margin | `town-book`, The Town Book | The decorated initials and lively borders of the [Hours of Catherine of Cleves](https://www.themorgan.org/manuscript/76941) inspire the gilt initial and space for short notices. |
| `folio` | Single sheet with a large headline and optional woodcut | `printer-dispatch`, The Printer’s Dispatch | [Hans Glaser’s 1561 Nuremberg news sheet](https://www.e-manuscripta.ch/zuzneb/wick/content/titleinfo/2723858) pairs one prominent woodcut with the lead report. |
| `folio` | Illustrated lead panel with a stack of briefs | `secession-review`, The Secession Review | [Alfred Roller’s first cover for *Ver Sacrum*](https://artsandculture.google.com/asset/titelblatt-ver-sacrum-organ-der-vereinigung-bildenden-k%C3%BCnstler-%C3%96sterreichs-1898-jg-1-heft-1/NgGTFjIUaduJQQ) inspires the square composition and the botanical print that steps over its edge. |
| `folio` | Picture weekly with a cobalt masthead and compact briefs | `national-review`, The National Review | The [first issue of *LIFE*](https://www.life.com/history/lifes-first-ever-cover-story-building-the-fort-peck-dam-1936/) inspires the monochrome cover picture. A large headline carries the page when there is no picture. |
| `folio` | Broadcast headline strip and index of briefs | `teletext-bulletin`, Teletext Bulletin | The [BBC’s Ceefax screens](https://downloads.bbc.co.uk/rd/pubs/archive/pdffiles/engineering/bbc_engineering_111.pdf#page=8) inspire the dark screen, colored section tabs and aligned figures. A red strip marks the breaking lead. |
| `feed` | Full-width timeline | `wire`, e.g. France Wire | Social timelines such as Bluesky: round avatars, a byline above each post and an action row below. Wide posts put photos or data cards beside the text. |

Every design has three front-page layouts. An ordinary page opens with one story followed by briefs. A breaking page gives the lead the most space. When an analysis story has an evidence table, it sits beside the text on a wide sheet and below it on a narrow one.

## Rendering constraints

Designs must keep these rules so the browser reader and the game texture match:

- Horizontal page margins come from the family's layout defaults in `src/newspaper/renderer/layout.ts`, because export measures content at that width. Change the default there rather than overriding horizontal page padding in CSS.
- Decoration on the selected tab is limited to reader mode, because the game draws the selected tab itself.
- If vote buttons have their own background, use `--vd-vote-background` for that color so exported icons have the same backing.
- Avoid CSS `filter`, which makes export paints nondeterministic.
- A reader-only decoration needs an export counterpart. The ancient design's bottom frieze stays fixed under the scrolling page in the browser; exported pages end with the same frieze instead.

## Add or change a design

1. Add or edit the design JSON in `vox-agents/newspaper/designs/`. Choose its family, tokens, fonts, assets, layouts and page labels, then set its [era and civilization weights](editorial.md#pages-and-designs).
2. Keep shared layout rules in `vox-agents/newspaper/src/reader/families/<family>.css`, scoped by `data-design`. Scope a design’s own stylesheet by `data-publication-design` and import it after its family in `reader.css`.
3. Put design-owned artwork in `newspaper/public/assets/designs/<design id>/` and register it as described in the [asset notes](editorial.md#design-assets).
4. In the preview (`npm run newspaper:preview -w vox-agents`), check every layout at wide and narrow widths. Enter a civilization to try its masthead, and try several tints for the feed family.
