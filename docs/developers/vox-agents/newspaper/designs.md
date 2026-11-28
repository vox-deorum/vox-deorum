# Newspaper designs

A design supplies an issue's layout, type, colors, and ornaments. Its `label` describes the format in the browser menus, such as **Victorian Broadsheet**. Its `title` is the fallback printed masthead, such as *The Morning Ledger*. [Masthead rules](editorial.md#masthead-rules) can change the printed title. The [renderer](renderer.md) uses the saved presentation for browser reading and game export.

## Add or change a design

1. Add or edit a JSON entry in `vox-agents/newspaper/designs/`. Give it a format `label`, a printable `title`, and the renderer family, layouts, and page labels. Keep the design ID stable for overlays and archived issues. Set `when` and `weight` for the era and civilization where it fits.
2. Reuse a family where possible. Put shared layout CSS under `vox-agents/newspaper/src/reader/families/` and scope it by `data-design`. Scope CSS specific to one publication design by `data-publication-design`. Import it after its family in `reader.css`. A new family also needs a presentation schema entry, layout defaults, and vote icons under `newspaper/public/assets/families/`.
3. Register any [artwork](#design-assets), then run `npm run newspaper:preview -w vox-agents` from the repository root. In **Mockups**, check ordinary, breaking, and analysis pages at wide and narrow widths. To try a civilization's masthead, choose a design with `civilizationTitles`, such as Victorian Broadsheet. Test dark and pale accents on tintable designs.
4. Capture the exported front page with the screenshot command below. Use the [browser tests](renderer.md#run-the-tests) or a [replay PNG](replay.md#generate-examples-from-the-command-line) to check recorded issues.

### Capture design screenshots

```sh
npm run newspaper:screenshots -w vox-agents
```

The command uses installed Edge or Chrome to capture each stock layout's sample front page from source. It shows vote icons in the game's control positions. The default width is 1000 pixels; files go to `.tmp/newspaper-screenshots/<design>/<layout-id>.png`.

To capture the Victorian broadsheet at phone width in a separate folder:

```sh
npm run newspaper:screenshots -w vox-agents -- --design victorian --layout broadsheet --width 360 --output .tmp/newspaper-narrow
```

For a layout review, capture at 360, 1000, and 1200 pixels in separate folders. Check how the briefs pair and whether the titles and body text have enough room.

### Which design runs

Once there are enough stories to publish, the editor draws among designs with positive weight, a printable fallback title, and an eligible layout for the edition. An eligible design competes when its weight is at least half the strongest one. A competitive design stays for its first three published issues, then joins a weighted draw at each check. After six issues, the next draw leaves it out if another competitive design is eligible. Skipped checks do not advance the run.

Use `when` to rule out a format that would be out of place. Knotted Inca Cords, for example, fits The Inca from Classical through Renaissance. Keep a general option for each era and a fallback if the era is missing. Use the catalogue audit to compare choices across civs. Use `designSelection` in the [CLI replay audit](replay.md#iterate-on-a-rule-or-overlay) to see what happened in a recorded game.

The [editor](editorial.md#pages-and-designs) fills the front with four briefs and an optional lead, and each section with 2 or 4 briefs and an optional lead. Layouts choose how those stories look. Breaking layouts are for the front only. Each design needs an unconditional ordinary and breaking layout with positive constant weights. Resizing rearranges the same articles.

### Audit coverage by civilization and era

From the repository root with workspace dependencies installed, build MCP with `npm run build -w mcp-server`, then run:

```sh
npm run newspaper:audit-designs
npm run --silent newspaper:audit-designs -- --json
```

The report shows which civs have few choices, which designs fall below the draw cutoff, and which groups get choices that a generic civ cannot draw or gets at a lower weight. The JSON includes each eligible design's raw and draw weights by civ and era. Add `--breaking` to check a breaking front instead of a regular one.

The audit uses the stock catalogue and a synthetic opening issue with a known civ, no ideology, and no game events or prior issues. It measures the draw pool. Use replay to study publication frequency and mastheads.

### Design assets

Declare built-in images and ornaments in the design's `assetDefinitions`. The registered ID joins the design and local IDs: Victorian's `harbour` becomes `victorian.harbour`. Overlays and saved issues refer to these bundled IDs. Keep an ID if an existing issue still uses it.

1. Place the file under `vox-agents/newspaper/public/assets/designs/<design id>/`.
2. Give its definition a unique local ID, kind (`image` or `ornament`), media type, dimensions, license, and attribution. Set `path` to a relative path starting with `assets/`, such as `assets/designs/victorian/harbour.png`. Omit dot segments and URL syntax.
3. Reference the registered ID in `presentation.assets.ornamentAssetId` or in an article's `image.assetId`. An article image requires `altText` and can also have a caption.
4. Rebuild with `npm run build:newspaper -w vox-agents` so the reader bundles the declarations and copies the assets.

## Families and designs

A renderer family supplies the shared structure. A design can give it a distinct composition without changing the reader's article and interaction model. The references below identify techniques to borrow.

| Stock design | Family | Layout and source |
| --- | --- | --- |
| Cast Notice Board (`oral-accounts`) | `inscription` | Framed, centred notice board. Roman *Acta Diurna*, Pompeii election notices, Trajan’s Column capitals, and the *tabula ansata* masthead panel. |
| Shang Oracle Shell (`shang`) | `folio` | Framed writing field. [Shang bronze cauldron](https://www.metmuseum.org/art/collection/search/60594): paired eyes and horns; the writing field follows a turtle shell. |
| Clay Tablet (`clay-chronicle`) | `folio` | Clay tablet with paired entries. [Babylonian Chronicle tablets](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en): warm clay and wedge marks in the dividers. |
| Painted Papyrus (`egypt`) | `folio` | Stacked painted registers. [agricultural registers in Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438): ochre rules and a winged sun on cross-grained papyrus. |
| Heian Court Letters (`heian`) | `folio` | Letters on dyed paper. [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en): violet dye, washi fibers, and a folded slip at the foot. |
| Bound Palm Leaves (`palm-leaf-register`) | `folio` | Bound leaves with briefs in pairs. [Bengal palm leaf folio](https://www.metmuseum.org/art/collection/search/74850): etched binding margins and a green cover. |
| Painted Maya Foldout (`folded-chronicle`) | `folio` | Accordion panels. [Dresden Maya Codex](https://www.slub-dresden.de/en/explore/manuscripts/the-dresden-maya-codex/content): fold marks and red ruling, repeated in the breaking and analysis bands. |
| Knotted Inca Cords (`cord-register`) | `folio` | Reports hanging from a shared cord. [Inka khipu](https://dma.org/art/collection/object/5328374): hanging strands divide wide reports and mark the start of narrow ones. |
| Port Ledger (`port-register`) | `folio` | Ruled shipping list with paired briefs. [Lloyd’s List](https://assets.lloyds.com/media/fe594686-4cc1-4f4d-92ca-b013225d3cfb/Lloyd%27s_pocket_guide_v11Oct23.pdf): compact masthead and ruled entries; the wide lead puts its headline beside the text. |
| Victorian Broadsheet (`victorian`) | `broadsheet` | Ruled multi-column print page. *The Illustrated London News* and *Harper’s Weekly* masthead ears, *The Times* rules, and *Le Petit Journal* for breaking news. |
| Evening Extra (`city-extra`) | `folio` | Full-width headline over two columns of briefs. [*Evening World*](https://www.loc.gov/item/sn83030193/1911-03-25/ed-1/): condensed type and heavy rules, red for the breaking lead. |
| Letterpress Street Sheet (`street-gazette`) | `folio` | Centered lead over pairs of ruled notices. [José Guadalupe Posada’s *Gaceta Callejera*](https://www.metmuseum.org/art/collection/search/729891): a tight serif headline and buff letterpress paper. |
| Illuminated Town Book (`town-book`) | `folio` | Ruled vellum with short notices. [Hours of Catherine of Cleves](https://www.themorgan.org/manuscript/76941): gilt initials and ruled notices. |
| Embroidered Frieze (`stitched-chronicle`) | `folio` | Centered lead above a band of briefs. [Bayeux Tapestry](https://www.bayeuxmuseum.com/en/the-bayeux-tapestry/discover-the-bayeux-tapestry/what-is-the-tapestry-about/): stitched bands on pale linen. |
| Woodcut News Sheet (`printer-dispatch`) | `folio` | Single sheet with a large headline and optional woodcut. [Hans Glaser’s 1561 Nuremberg news sheet](https://www.e-manuscripta.ch/zuzneb/wick/content/titleinfo/2723858): one prominent woodcut beside the lead. |
| Secession Magazine (`secession-review`) | `folio` | Illustrated lead panel above the briefs. [Alfred Roller’s first cover for *Ver Sacrum*](https://artsandculture.google.com/asset/titelblatt-ver-sacrum-organ-der-vereinigung-bildenden-k%C3%BCnstler-%C3%96sterreichs-1898-jg-1-heft-1/NgGTFjIUaduJQQ): botanical art across the lead frame. |
| Photo Weekly (`national-review`) | `folio` | Picture weekly with a tinted masthead and compact briefs. [first issue of *LIFE*](https://www.life.com/history/lifes-first-ever-cover-story-building-the-fort-peck-dam-1936/): monochrome cover art, such as Paul Vanderbilt’s [1938 harbor photograph](https://www.loc.gov/item/2017868572/). A large headline works on its own. |
| Telegram Form (`cable-desk`) | `folio` | Telegram form with boxed tabs and pairs of ruled briefs. [Western Union telegram](https://tile.loc.gov/storage-services/service/mss/mss65570/ms/s6/55/70/-0/16/09/mss65570-01609/mss65570-01609.pdf): routing boxes, a turn field, and a typewritten headline strip. |
| Teletext Screen (`teletext-bulletin`) | `folio` | Broadcast headline strip and index of briefs. [BBC’s Ceefax screens](https://downloads.bbc.co.uk/rd/pubs/archive/pdffiles/engineering/bbc_engineering_111.pdf#page=8): colored tabs, fixed-width type, and a red breaking strip. |
| Darkroom Contact Sheet (`contact-sheet`) | `folio` | Enlarged lead frame with one column of text above smaller frames. [Peter Hujar’s darkroom contact sheets](https://www.themorgan.org/blog/peter-hujars-contact-sheets-record-keeping-and-ephemeral-proof): silver frames, charcoal gutters, and a separate frame for analysis evidence. |
| Photocopied Fanzine (`paste-up`) | `folio` | Briefs pair on wide pages. A lead spans both columns. [Photocopied punk fanzines](https://exhibits.library.cornell.edu/punkfest/feature/rise-of-the-fanzines) inspired the cut paper headlines and lime highlights. |
| Swiss Grid (`civic-index`) | `folio` | Two story stacks on the ordinary front and paired stories in sections. [*Neue Grafik*](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965): an asymmetric front with two stories on the left. Section briefs pair on wide paper. |
| Court Dispatch Slips (`court-dispatch`) | `folio` | [Mughal court newsletters](https://royalasiaticcollections.org/akhbarat-archive/): one slip per story, with its observation turn in a ruled margin. |
| Sunday Comic Supplement (`sunday-colour`) | `folio` | Broad lead panel above smaller color panels. [*Little Nemo*’s Sunday comic pages](https://blogs.loc.gov/headlinesandheroes/2018/06/before-bang-pow-zap/): flat colors, narrow gutters, and varied panel sizes. |
| Isotype Bulletin (`civic-survey`) | `folio` | Statistical plate above the lead text. [Vienna’s Isotype statistical plates](https://isotyperevisited.org/2012/08/society-and-economy.php): evidence above the lead; percentage bars leave missing values blank. |
| Meiji Picture Sheet (`meiji-picture-sheet`) | `folio` | Framed lead above paired briefs. [Utagawa Yoshiiku’s 1870s news print for *Tokyo Nichi Nichi Shinbun*](https://pages.uoregon.edu/jsmacollections/home/artists/utagawa-yoshiiku-1833-1904/showing-the-flag.html): a ribbon title and a lead frame that works with or without art. |
| Coffeehouse Essay Sheet (`coffeehouse-essay`) | `folio` | Numbered half-sheet with an essay and paired notices. [Addison and Steele’s *The Spectator*](https://collections.soane.org/b5321): a numbered imprint, fine rules, and modest serif headlines. |
| Printed Almanack (`printed-almanack`) | `folio` | [Benjamin Banneker’s 1793 *Almanack and Ephemeris*](https://transcription.si.edu/pdf/8045/NMAAHC-2014_63_31_008): a turn gutter and celestial ornaments. Put the lead first, then briefs by observation turn, with undated briefs last. |
| Social News Feed (`wire`) | `feed` | Full-width timeline. Social timelines such as Bluesky: round avatars, bylines, and actions below a post. Wide posts can place photos or data beside the text. |

Stock designs offer ordinary, breaking, and analysis layouts. A breaking page emphasizes the lead. Most analysis layouts put evidence beside the story on wide sheets and below it on narrow sheets.

Social News Feed, Telegram Form, Port Ledger, and Teletext Screen show the observation turn near each headline when known and keep the editor's story order. Telegram Form also labels the edition's cutoff in its masthead. Court Dispatch Slips and Printed Almanack have dedicated date fields and show **Undated** when no turn was recorded.

## Rendering constraints

- Give every story one continuous column of text, including the lead. A lead can fill the row. Its body still reads straight down, even when art or evidence sits alongside it.
- Above 760 CSS pixels of paper width, pair briefs side by side, one story per column. Give a lead its own row above the briefs when the editor selects one. At narrower widths, stack the stories in reading order. For exceptions, see the design table and the examples in **Mockups**.
- Keep the issue's copy, links, votes, and evidence in reading order. At narrow widths, scale display type before shrinking body text. Use the margins in `vox-agents/src/newspaper/renderer/layout.ts` so the reader and export have the same geometry.
- Keep selected-tab decoration in browser reader mode. The game draws selection itself. Use `--vd-vote-background` when vote icons need their own background in the export.
- Draw dividers from the format’s materials, such as an incised clay rule or an etched line beside a palm leaf’s binding hole. Use paper, ink, and accent tokens for these marks. Keep textures light behind type and use local artwork for intricate motifs.
- Style figures through `vd-number` and names through `vd-name`. By default, names are underlined.
- Avoid CSS filters and give reader ornaments an export equivalent. For example, the inscription's fixed bottom frieze ends the exported page.
