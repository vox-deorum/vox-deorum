# Newspaper designs

A design determines how an issue looks: its layout, typography, colors, and ornaments. It also supplies default titles and page labels. The [renderer](renderer.md) uses the saved presentation for browser reading and game export.

## Add or change a design

1. Add or edit a JSON entry in `vox-agents/newspaper/designs/`. Set its renderer family, presentation, layouts, and page labels. Set `when` and `weight` for the era and civilization where it fits.
2. Reuse a family where possible. Put shared layout CSS under `vox-agents/newspaper/src/reader/families/` and scope it by `data-design`. Scope CSS specific to one publication design by `data-publication-design`. Import it after its family in `reader.css`.
3. Register any [artwork](#design-assets), then run `npm run newspaper:preview -w vox-agents` from the repository root. In **Mockups**, check ordinary, breaking, and analysis pages at wide and narrow widths. Try a civilization's masthead and test both dark and pale accents on tintable designs.
4. Check the exported page with the [browser tests](renderer.md#run-the-tests) or a [replay PNG](replay.md#generate-examples-from-the-command-line).

Designs can limit eligibility by era or by recorded civilization name. For example, `cord-register` is eligible from Classical through Renaissance with weight 66 for The Inca and 1 elsewhere. Check the design JSON for the exact values. Keep at least one general option available in each era.

The editor keeps the previous design if it is still eligible and its weight is at least 60% of the highest eligible weight by default. Otherwise it draws from the eligible designs in proportion to their weights. A low weight gives a design a chance on a fresh draw. Published issues retain the choice.

### Design assets

Declare built-in images and ornaments in the design's `assetDefinitions`. The registered ID joins the design and local IDs: Victorian's `harbour` becomes `victorian.harbour`. Overlays can reference bundled IDs.

1. Place the file under `vox-agents/newspaper/public/assets/designs/<design id>/`.
2. Give its definition a unique local ID, kind (`image` or `ornament`), media type, dimensions, license, attribution, and relative path under `assets/` without dot segments or URL syntax.
3. Reference the registered ID in `presentation.assets.ornamentAssetId` or in an article's `image.assetId`. An article image requires `altText` and can also have a caption.
4. Rebuild with `npm run build:newspaper -w vox-agents` so the reader bundles the declarations and copies the assets.

## Families and designs

A renderer family supplies the shared structure. A design can give it a distinct composition without changing the reader's article and interaction model. The references below identify techniques to borrow.

| Family | Structure | Stock design | Real-world references |
| --- | --- | --- | --- |
| `inscription` | Framed, centred notice board | `oral-accounts`, e.g. Annals of Rome | The Roman *Acta Diurna* notice board, painted election notices at Pompeii (red and black), Trajan's Column capitals (Cinzel), the *tabula ansata* panel for the masthead, Greek key friezes, and the *hedera* ivy leaf as divider |
| `folio` | Framed writing field | `shang`, Records of the Shang Court | The paired eyes and symmetrical horns of a [Shang bronze cauldron](https://www.metmuseum.org/art/collection/search/60594) crown the masthead. Inside the bronze rim, pale seams and growth rings trace the plates of a turtle shell. |
| `folio` | Clay tablet with incised rules | `clay-chronicle`, The Clay Chronicle | The [Babylonian Chronicle tablets](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en) inspire the warm clay, low masthead and stylus marks. Shallow rules separate the news entries. |
| `folio` | Stacked painted registers | `egypt`, The Two Lands Register or The Nubian Ledger | The [agricultural registers in Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438) inspire the horizontal bands. A winged sun and ochre rules sit on pale papyrus with fine horizontal fibres over broader vertical strips. |
| `folio` | Letters on dyed paper | `heian`, e.g. Letters from the Heian Court | The dyed sheets of the [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en) inspire the wisteria tint. Fine grain and scattered fibres suggest handmade washi. A flowering branch opens the ordinary edition; a folded slip closes the page. |
| `folio` | Bound leaves with one report per strip | `palm-leaf-register`, The Palm Leaf Register | A [Bengal palm leaf folio](https://www.metmuseum.org/art/collection/search/74850) inspires the long ochre strips and their binding margin. A green cover opens the issue, and a deeper leaf gives the lead more room. |
| `folio` | Accordion panels | `folded-chronicle`, The Maya Chronicle | The [Dresden Maya Codex](https://www.slub-dresden.de/en/explore/manuscripts/the-dresden-maya-codex/content) lends its folded sheet and red ruling. On wide sheets the lead opens across two panels, with the first brief in the third. At phone width, clay rules separate the stacked stories. |
| `folio` | Reports hanging from a shared cord | `cord-register`, The Cord Register | An [Inka khipu](https://dma.org/art/collection/object/5328374) inspires the horizontal cord and its hanging strands. The strands separate reports on a wide sheet and mark their starts along one edge on a narrow sheet. |
| `folio` | Ruled shipping list | `port-register`, e.g. The Dutch Port Register | An early [Lloyd’s List](https://assets.lloyds.com/media/fe594686-4cc1-4f4d-92ca-b013225d3cfb/Lloyd%27s_pocket_guide_v11Oct23.pdf) inspires the compact masthead and ruled entries. On a wide sheet, headlines sit to the left of their reports. On a narrow sheet, each heading sits above its report. |
| `broadsheet` | Ruled multi-column print page | `victorian`, e.g. Chronicle of France | *The Illustrated London News* and *Harper's Weekly* mastheads with medallion ears, *The Times* Oxford rules, printers' factotum initials and fleurons, and *Le Petit Journal* for the breaking edition |
| `folio` | Full-width headline over two columns of briefs | `city-extra`, The City Extra | New York’s [*Evening World*](https://www.loc.gov/item/sn83030193/1911-03-25/ed-1/) inspires the bold condensed headline, cream newsprint and heavy rules. The lead rule turns red on breaking pages. |
| `folio` | Centered headline over ruled notices | `street-gazette`, The Street Gazette | [José Guadalupe Posada’s *Gaceta Callejera*](https://www.metmuseum.org/art/collection/search/729891) inspires the tight serif headline, buff paper and dark letterpress ink. |
| `folio` | Ruled vellum with briefs in the outer margin | `town-book`, The Town Book | The decorated initials and lively borders of the [Hours of Catherine of Cleves](https://www.themorgan.org/manuscript/76941) inspire the gilt initial and space for short notices. |
| `folio` | Centered lead above a band of briefs | `stitched-chronicle`, The Stitched Chronicle | The paired friezes of the [Bayeux Tapestry](https://www.bayeuxmuseum.com/en/the-bayeux-tapestry/discover-the-bayeux-tapestry/what-is-the-tapestry-about/) inspire the stitched bands on pale linen. |
| `folio` | Single sheet with a large headline and optional woodcut | `printer-dispatch`, The Printer’s Dispatch | [Hans Glaser’s 1561 Nuremberg news sheet](https://www.e-manuscripta.ch/zuzneb/wick/content/titleinfo/2723858) pairs one prominent woodcut with the lead report. |
| `folio` | Illustrated lead panel with a stack of briefs | `secession-review`, The Secession Review | [Alfred Roller’s first cover for *Ver Sacrum*](https://artsandculture.google.com/asset/titelblatt-ver-sacrum-organ-der-vereinigung-bildenden-k%C3%BCnstler-%C3%96sterreichs-1898-jg-1-heft-1/NgGTFjIUaduJQQ) inspires the square composition and the botanical print that steps over its edge. |
| `folio` | Picture weekly with a tinted masthead and compact briefs | `national-review`, The National Review | The [first issue of *LIFE*](https://www.life.com/history/lifes-first-ever-cover-story-building-the-fort-peck-dam-1936/) inspires the monochrome cover picture. A large headline carries the page when there is no picture. |
| `folio` | Telegram form with boxed tabs and ruled briefs | `cable-desk`, The Cable Desk | A [Western Union telegram](https://tile.loc.gov/storage-services/service/mss/mss65570/ms/s6/55/70/-0/16/09/mss65570-01609/mss65570-01609.pdf) inspires the turn field, routing boxes, and typewritten headline on a paper strip. |
| `folio` | Broadcast headline strip and index of briefs | `teletext-bulletin`, Teletext Bulletin | The [BBC’s Ceefax screens](https://downloads.bbc.co.uk/rd/pubs/archive/pdffiles/engineering/bbc_engineering_111.pdf#page=8) inspire the dark screen, colored section tabs and aligned figures. A red strip marks the breaking lead. |
| `folio` | Enlarged lead frame above smaller frames | `contact-sheet`, The Contact Sheet | [Peter Hujar’s darkroom contact sheets](https://www.themorgan.org/blog/peter-hujars-contact-sheets-record-keeping-and-ephemeral-proof) inspire the charcoal gutters, silver frames and yellow pencil mark. The analysis table gets a frame of its own. |
| `folio` | Cut headline strips with a column of briefs | `paste-up`, The Paste-Up | [Photocopied punk fanzines](https://exhibits.library.cornell.edu/punkfest/feature/rise-of-the-fanzines) inspire the black headline strips and the cut paper masthead. Lime highlights pick out figures in the copy. |
| `folio` | Wide lead and narrow column for briefs or figures | `civic-index`, The Civic Index | [*Neue Grafik*](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965) inspires the asymmetric grid and compact sans serif masthead. The briefs or evidence move beneath the lead at phone width. |
| `folio` | Staggered sheets with the turn in a ruled margin | `court-dispatch`, e.g. Court Dispatches of India | The [Mughal court newsletters](https://royalasiaticcollections.org/akhbarat-archive/) put each dispatch on a separate slip. Paper grain, brown ink and the turn docket tie the sheets together. |
| `folio` | Broad lead panel above smaller color panels | `sunday-colour`, The Sunday Colour | [*Little Nemo*’s Sunday comic pages](https://blogs.loc.gov/headlinesandheroes/2018/06/before-bang-pow-zap/) inspire the varying panel sizes, flat colors and narrow gutters. |
| `folio` | Statistical plate above the lead text | `civic-survey`, The Civic Survey | [Vienna’s Isotype statistical plates](https://isotyperevisited.org/2012/08/society-and-economy.php) inspire the ruled evidence panel and the use of rust ink for figures. |
| `feed` | Full-width timeline | `wire`, e.g. France Wire | Social timelines such as Bluesky: round avatars, a byline above each post and an action row below. Wide posts put photos or data cards beside the text. |

The stock designs have ordinary, breaking, and analysis layouts; a design can offer more than one layout of a kind. A breaking page emphasizes the lead. Analysis pages generally put evidence beside the story on wide sheets and below it on narrow sheets. The Civic Survey keeps evidence above the report and can show percentages as bars, leaving missing values unmarked.

## Rendering constraints

- Keep the issue's copy, links, votes, and evidence. Use the available width for columns or evidence. Use composition to set the lead apart, and give decorations a job. For example, a cast inscription groups stories inside a rim.
- Use the margins in `vox-agents/src/newspaper/renderer/layout.ts`. Export measures content with those values. At narrow widths, stack columns and scale display type before shrinking body text.
- Keep selected-tab decoration in browser reader mode. The game draws selection itself. Use `--vd-vote-background` when vote icons need their own background in the export.
- Use paper, ink, and accent tokens for simple marks. Keep textures light behind type and use local artwork for intricate motifs. Designs can style figures through `vd-number`.
- Avoid CSS filters and give reader ornaments an export equivalent. For example, the inscription's fixed bottom frieze ends the exported page.
