# Newspaper designs

A design supplies an issue's layout, type, colors, and ornaments. Its `label` describes the format in the browser menus, such as **Victorian Broadsheet**. Its `title` is the fallback printed masthead, such as *The Morning Ledger*. [Masthead rules](editorial.md#masthead-rules) can change the printed title. The [renderer](renderer.md) uses the saved presentation for browser reading and game export.

## Add or change a design

1. Add or edit a JSON entry in `vox-agents/newspaper/designs/`. Give it a format `label`, a printable `title`, and the renderer family, layouts, and page labels. Keep the design ID stable for overlays and archived issues. Set `when` and `weight` for the era and civilization where it fits.
2. Reuse a family where possible. Put shared layout CSS under `vox-agents/newspaper/src/reader/families/` and scope it by `data-design`. Scope CSS specific to one publication design by `data-publication-design`. Import it after its family in `reader.css`.
3. Register any [artwork](#design-assets), then run `npm run newspaper:preview -w vox-agents` from the repository root. In **Mockups**, check ordinary, breaking, and analysis pages at wide and narrow widths. Try a civilization's masthead and test both dark and pale accents on tintable designs.
4. Capture the exported front page with the screenshot command below. Use the [browser tests](renderer.md#run-the-tests) or a [replay PNG](replay.md#generate-examples-from-the-command-line) to check recorded issues.

### Capture design screenshots

```sh
npm run newspaper:screenshots -w vox-agents
```

The command uses installed Edge or Chrome to capture the full sample front page for each built-in design and its distinct visual layouts: ordinary, breaking, and analysis where available. It reads the source files on each run, so CSS, artwork, and catalogue edits appear without a build or game recording. Captures show the vote icons over the slots the game uses for its own controls. The default width is 1000 pixels, and files are saved as `.tmp/newspaper-screenshots/<design>/<variant>.png`. Rerunning replaces the PNGs with the same names.

To capture only the Victorian design at phone width and keep it in a separate folder:

```sh
npm run newspaper:screenshots -w vox-agents -- --design victorian --width 360 --output .tmp/newspaper-narrow
```

For a layout review, capture at 360, 1000, and 1200 pixels in separate folders. Check how the briefs pair and whether the titles and body text have enough room.

### Which design runs

The stock editor draws among designs with positive weight, a printable fallback title, and at least half the highest eligible weight. A competitive design stays for its first three published issues. Then it joins a new weighted draw at each check. After six issues, the next draw leaves it out if another competitive design fits. A design that stops fitting can change immediately. Skipped checks do not advance the run, and a sole competitive design can continue indefinitely.

Use `when` to rule out a format that would be out of place. Knotted Inca Cords, for example, fits The Inca from Classical through Renaissance. Set weights relative to the other designs that can appear at the same time: an option needs 40 to compete with a weight of 80. Keep a general option for each era and a fallback if the era is missing. Check the [replay decision](replay.md#read-replay-diagnostics) before tuning weights.

New stock runs use `defaults.designSelection: "pressRun"`. Saved catalogues that predate that setting and overlays with `"legacy"` use `designStickiness` instead. Legacy keeps the previous design while its weight is at least the configured fraction of the highest eligible weight, then draws among all eligible designs.

### Design assets

Declare built-in images and ornaments in the design's `assetDefinitions`. The registered ID joins the design and local IDs: Victorian's `harbour` becomes `victorian.harbour`. Overlays and saved issues refer to these bundled IDs. Keep an ID if an existing issue still uses it.

1. Place the file under `vox-agents/newspaper/public/assets/designs/<design id>/`.
2. Give its definition a unique local ID, kind (`image` or `ornament`), media type, dimensions, license, and attribution. Set `path` to a relative path starting with `assets/`, such as `assets/designs/victorian/harbour.png`. Omit dot segments and URL syntax.
3. Reference the registered ID in `presentation.assets.ornamentAssetId` or in an article's `image.assetId`. An article image requires `altText` and can also have a caption.
4. Rebuild with `npm run build:newspaper -w vox-agents` so the reader bundles the declarations and copies the assets.

## Families and designs

A renderer family supplies the shared structure. A design can give it a distinct composition without changing the reader's article and interaction model. The references below identify techniques to borrow.

| Family | Structure | Stock design | Real-world references |
| --- | --- | --- | --- |
| `inscription` | Framed, centred notice board | Cast Notice Board (`oral-accounts`) | The Roman *Acta Diurna* notice board, painted election notices at Pompeii (red and black), Trajan's Column capitals (Cinzel), the *tabula ansata* panel for the masthead, Greek key friezes, and the *hedera* ivy leaf as divider |
| `folio` | Framed writing field | Shang Oracle Shell (`shang`) | The paired eyes and symmetrical horns of a [Shang bronze cauldron](https://www.metmuseum.org/art/collection/search/60594) crown the masthead. Inside the bronze rim, pale seams and growth rings trace the plates of a turtle shell. |
| `folio` | Clay tablet with paired entries | Clay Tablet (`clay-chronicle`) | The [Babylonian Chronicle tablets](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en) inspire the warm clay, low masthead and wedge marks in the incised dividers. |
| `folio` | Stacked painted registers | Painted Papyrus (`egypt`) | The [agricultural registers in Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438) inspire the horizontal bands. A winged sun and ochre rules sit on pale papyrus with fine horizontal fibres over broader vertical strips. |
| `folio` | Letters on dyed paper | Heian Court Letters (`heian`) | The dyed sheets of the [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en) inspire the wisteria tint. Fine grain and scattered fibres suggest handmade washi. A flowering branch opens the ordinary edition; a folded slip closes the page. |
| `folio` | Bound leaves with briefs in pairs | Bound Palm Leaves (`palm-leaf-register`) | A [Bengal palm leaf folio](https://www.metmuseum.org/art/collection/search/74850) inspires the ochre strips and etched binding margins. A green cover opens the issue, and a deeper leaf gives the lead more room. |
| `folio` | Accordion panels | Painted Maya Foldout (`folded-chronicle`) | The [Dresden Maya Codex](https://www.slub-dresden.de/en/explore/manuscripts/the-dresden-maya-codex/content) lends its folded sheet and red ruling. Fold marks separate the paired stories on wide sheets. Breaking and analysis pages repeat the folds in a rule band above the stories. |
| `folio` | Reports hanging from a shared cord | Knotted Inca Cords (`cord-register`) | An [Inka khipu](https://dma.org/art/collection/object/5328374) inspires the horizontal cord and its hanging strands. The strands separate reports on a wide sheet and mark their starts along one edge on a narrow sheet. |
| `folio` | Ruled shipping list with paired briefs | Port Ledger (`port-register`) | An early [Lloyd’s List](https://assets.lloyds.com/media/fe594686-4cc1-4f4d-92ca-b013225d3cfb/Lloyd%27s_pocket_guide_v11Oct23.pdf) inspires the compact masthead and ruled entries. On a wide ordinary sheet, the lead headline sits beside its report. Brief headings sit above their reports. |
| `broadsheet` | Ruled multi-column print page | Victorian Broadsheet (`victorian`) | *The Illustrated London News* and *Harper's Weekly* mastheads with medallion ears, *The Times* Oxford rules, printers' factotum initials and fleurons, and *Le Petit Journal* for the breaking edition |
| `folio` | Full-width headline over two columns of briefs | Evening Extra (`city-extra`) | New York’s [*Evening World*](https://www.loc.gov/item/sn83030193/1911-03-25/ed-1/) inspires the bold condensed headline, cream newsprint and heavy rules. The lead rule turns red on breaking pages. |
| `folio` | Centered lead over pairs of ruled notices | Letterpress Street Sheet (`street-gazette`) | [José Guadalupe Posada’s *Gaceta Callejera*](https://www.metmuseum.org/art/collection/search/729891) inspires the tight serif headline, buff paper and dark letterpress ink. |
| `folio` | Ruled vellum with short notices | Illuminated Town Book (`town-book`) | The decorated initials and lively borders of the [Hours of Catherine of Cleves](https://www.themorgan.org/manuscript/76941) inspire the gilt initial and space for short notices. |
| `folio` | Centered lead above a band of briefs | Embroidered Frieze (`stitched-chronicle`) | The paired friezes of the [Bayeux Tapestry](https://www.bayeuxmuseum.com/en/the-bayeux-tapestry/discover-the-bayeux-tapestry/what-is-the-tapestry-about/) inspire the stitched bands on pale linen. |
| `folio` | Single sheet with a large headline and optional woodcut | Woodcut News Sheet (`printer-dispatch`) | [Hans Glaser’s 1561 Nuremberg news sheet](https://www.e-manuscripta.ch/zuzneb/wick/content/titleinfo/2723858) pairs one prominent woodcut with the lead report. |
| `folio` | Illustrated lead panel above the briefs | Secession Magazine (`secession-review`) | [Alfred Roller’s first cover for *Ver Sacrum*](https://artsandculture.google.com/asset/titelblatt-ver-sacrum-organ-der-vereinigung-bildenden-k%C3%BCnstler-%C3%96sterreichs-1898-jg-1-heft-1/NgGTFjIUaduJQQ) inspires the botanical print that crosses the fitted headline frame. |
| `folio` | Picture weekly with a tinted masthead and compact briefs | Photo Weekly (`national-review`) | The [first issue of *LIFE*](https://www.life.com/history/lifes-first-ever-cover-story-building-the-fort-peck-dam-1936/) inspires the monochrome cover picture. The mockup uses Paul Vanderbilt’s [1938 harbor photograph](https://www.loc.gov/item/2017868572/). A large headline carries the page when there is no picture. |
| `folio` | Telegram form with boxed tabs and pairs of ruled briefs | Telegram Form (`cable-desk`) | A [Western Union telegram](https://tile.loc.gov/storage-services/service/mss/mss65570/ms/s6/55/70/-0/16/09/mss65570-01609/mss65570-01609.pdf) inspires the turn field, routing boxes, and typewritten headline on a paper strip. |
| `folio` | Broadcast headline strip and index of briefs | Teletext Screen (`teletext-bulletin`) | The [BBC’s Ceefax screens](https://downloads.bbc.co.uk/rd/pubs/archive/pdffiles/engineering/bbc_engineering_111.pdf#page=8) inspire the dark screen, colored section tabs, and fixed-width type. A red strip marks the breaking lead. |
| `folio` | Enlarged lead frame with one column of text above smaller frames | Darkroom Contact Sheet (`contact-sheet`) | [Peter Hujar’s darkroom contact sheets](https://www.themorgan.org/blog/peter-hujars-contact-sheets-record-keeping-and-ephemeral-proof) inspire the charcoal gutters, silver frames and yellow pencil mark. The analysis table gets a frame of its own. |
| `folio` | Cut headline strips with a column of briefs | Photocopied Fanzine (`paste-up`) | [Photocopied punk fanzines](https://exhibits.library.cornell.edu/punkfest/feature/rise-of-the-fanzines) inspire the black headline strips and the cut paper masthead. Lime highlights pick out figures in the copy. |
| `folio` | Wide lead and narrow column for briefs or figures | Swiss Grid (`civic-index`) | [*Neue Grafik*](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965) inspires the asymmetric grid and compact sans serif masthead. The briefs or evidence move beneath the lead at phone width. |
| `folio` | Dispatch slips with the turn in a ruled margin | Court Dispatch Slips (`court-dispatch`) | The [Mughal court newsletters](https://royalasiaticcollections.org/akhbarat-archive/) put each dispatch on a separate slip. A double rule separates the turn docket from the story on ordinary pages. |
| `folio` | Broad lead panel above smaller color panels | Sunday Comic Supplement (`sunday-colour`) | [*Little Nemo*’s Sunday comic pages](https://blogs.loc.gov/headlinesandheroes/2018/06/before-bang-pow-zap/) inspire the varying panel sizes, flat colors and narrow gutters. |
| `folio` | Statistical plate above the lead text | Isotype Bulletin (`civic-survey`) | [Vienna’s Isotype statistical plates](https://isotyperevisited.org/2012/08/society-and-economy.php) inspire the ruled evidence panel and the use of rust ink for figures. |
| `folio` | Framed lead above paired briefs | Meiji Picture Sheet (`meiji-picture-sheet`) | [Utagawa Yoshiiku’s 1870s news print for *Tokyo Nichi Nichi Shinbun*](https://pages.uoregon.edu/jsmacollections/home/artists/utagawa-yoshiiku-1833-1904/showing-the-flag.html) inspires the title ribbon and the way text and illustration share the lead. The framed lead also works without art. |
| `folio` | Numbered half-sheet with an essay and paired notices | Coffeehouse Essay Sheet (`coffeehouse-essay`) | [Addison and Steele’s *The Spectator*](https://collections.soane.org/b5321) inspires the numbered imprint, fine rules and modest serif headlines. |
| `folio` | Ruled entries with a turn gutter | Printed Almanack (`printed-almanack`) | [Benjamin Banneker’s 1793 *Almanack and Ephemeris*](https://transcription.si.edu/pdf/8045/NMAAHC-2014_63_31_008) inspires the dated rows and celestial ornaments. Each date is the latest recorded observation supporting that report. The lead comes first. Briefs follow by date, with undated ones last. |
| `feed` | Full-width timeline | Social News Feed (`wire`) | Social timelines such as Bluesky: round avatars, a byline above each post and an action row below. Wide posts put photos or data cards beside the text. |

The stock designs have ordinary, breaking, and analysis layouts; a design can offer more than one layout of a kind. A breaking page emphasizes the lead. Analysis pages generally put evidence beside the story on wide sheets and below it on narrow sheets. The Civic Survey keeps evidence above the report and can show percentages as bars, leaving missing values unmarked.

## Rendering constraints

- Give every story one continuous column of text, including the lead. A lead can fill the row. Its body still reads straight down, even when art or evidence sits alongside it.
- Above 760 CSS pixels of paper width, give the lead a full row and pair briefs below it, one story per column. Keep an unpaired brief in its grid slot. At narrower widths, stack the stories in reading order. Modern designs such as the feed, Teletext, the Fanzine, and the Swiss Grid can keep their own arrangements.
- Keep the issue's copy, links, votes, and evidence in reading order. At narrow widths, scale display type before shrinking body text. Use the margins in `vox-agents/src/newspaper/renderer/layout.ts` so the reader and export have the same geometry.
- Keep selected-tab decoration in browser reader mode. The game draws selection itself. Use `--vd-vote-background` when vote icons need their own background in the export.
- Draw dividers from the format’s materials, such as an incised clay rule or an etched line beside a palm leaf’s binding hole. Use paper, ink, and accent tokens for these marks. Keep textures light behind type and use local artwork for intricate motifs.
- Style figures through `vd-number` and names through `vd-name`. By default, names are underlined.
- Avoid CSS filters and give reader ornaments an export equivalent. For example, the inscription's fixed bottom frieze ends the exported page.
