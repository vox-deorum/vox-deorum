# Newspaper designs

A design supplies an issue's layout, type, colors, and ornaments. Its `label` describes the format in the browser menus, such as **Steam-Press Broadsheet**. Its `title` is the fallback printed masthead, such as *The Morning Ledger*. The design ID is the label in kebab case, such as `steam-press-broadsheet`. Labels name the format without real-world proper names; titles can carry real-world flavor, but never a modern brand or newspaper name. [Masthead rules](editorial.md#masthead-rules) can change the printed title. The [renderer](renderer.md) uses the saved presentation for browser reading and game export.

## Add or change a design

1. Add or edit a JSON entry in `vox-agents/newspaper/designs/`. Give it a format `label`, a printable `title`, and the renderer family, layouts, and page labels. Keep the design ID stable for overlays and archived issues. Set `when` and `weight` for the era and civilization where it fits. To target a civilization group from `constants.json`, use its shortcut, such as `self.is.westAsian`.
2. Reuse a family where possible. Put shared layout CSS under `vox-agents/newspaper/src/reader/families/` and scope it by `data-design`. Scope CSS specific to one publication design by `data-publication-design`. Import it after its family in `reader.css`. A new family also needs a presentation schema entry, layout defaults, and vote icons under `newspaper/public/assets/families/`.
3. Register any [artwork](#design-assets), then run `npm run newspaper:preview -w vox-agents` from the repository root. In **Mockups**, check ordinary, breaking, and analysis pages at wide and narrow widths. To try a civilization's masthead, choose a design with `civilizationTitles`, such as Steam-Press Broadsheet. Test dark and pale accents on tintable designs.
4. Capture the exported front page with the screenshot command below. Use the [browser tests](renderer.md#run-the-tests) or a [replay PNG](replay.md#generate-examples-from-the-command-line) to check recorded issues.

### Capture design screenshots

```sh
npm run newspaper:screenshots -w vox-agents
```

The command uses installed Edge or Chrome to capture each stock layout's sample front page from source. It shows vote icons in the game's control positions. The default width is 1000 pixels; files go to `.tmp/newspaper-screenshots/<design>/<layout-id>.png`.

To capture the Steam-Press Broadsheet at phone width in a separate folder:

```sh
npm run newspaper:screenshots -w vox-agents -- --design steam-press-broadsheet --layout broadsheet --width 360 --output .tmp/newspaper-narrow
```

For a layout review, capture at 360, 1000, and 1200 pixels in separate folders. Check how the briefs pair and whether the titles and body text have enough room.

### Redesign an existing template

1. **Pair the baseline with a historical reference.** Keep the ordinary edition screenshot in `.tmp/newspaper-screenshots/<design>/`. Delegate image search and download to GPT-6-Luna. Give it the design ID, the screenshot path, and the source listed under [Families and designs](#families-and-designs). Ask it to save an authentic example next to the screenshot, verify that the image opens, and return the source URL, credit, and any stated license. Keep the photo in `.tmp/` for comparison.
2. **Ask Claude Code for the first study.** Use Opus and give it the baseline, the reference (a viewable copy if the image is large), and one output path beside them. Ask it to look at how the artifact was made, how it grouped entries, and where it used ornament. Let it choose the composition. The study should be a single offline HTML file with its styles and artwork inline. Keep the ordinary edition's copy and controls for comparison. Pair whole stories on wide paper and stack them in order at 360 px. See the [Papyrus prompt](#claude-code-prompt-for-winged-sun-papyrus) for an example.
3. **Review the study in a browser.** Check that the historical cues come through, the first story starts near the top, and the text and controls are easy to read. Try it wide and narrow. Use the HTML to discuss and revise the design before changing the template.
4. **Have Codex port the approved study and compare exports.** Reuse the reader's existing structure and controls where possible. Capture the ordinary, breaking, and analysis layouts before and after the change at 1200 px for game width and 360 px for narrow reading. Use separate output folders. Check text contrast, story order, links, votes, and evidence. Then review one era-appropriate issue with a civilization masthead: the stock screenshots use shared sample stories, which can pull the design out of period.

For a parallel batch, give each study its own template and screenshot folder. Start the next reference and study while Codex ports the previous one. Keep edits to a template's styles and assets where possible, and review a shared renderer change separately if several designs need it.

**Space and legibility.** Minimize the blank space above the masthead and keep the masthead short so the stories start sooner. Let ornament do double duty as a border or a divider. At the same paper width, compare how far down the first headline starts before and after the change. Keep story text conspicuous: use dark ink and lighten any watermark or texture that competes with it. Check at narrow width before shrinking body text to save space.

**News type icons.** In a study that uses marks beside headlines, draw a separate SVG for each news type in the template's own visual style. Make their shapes distinct at reading size. When porting, choose the icon from the story's saved tags so it stays the same across layouts. Give specific topics priority over broad scope tags. For example, a story tagged both `trade` and `international` uses the trade mark. Try mixed and untagged stories, and give icons that identify a topic an accessible label.

**Pilot: Cuneiform Tablet.** Compare `entries.png`, `reference-babylonian-chronicle.jpg`, and `tablet-study.html` in `.tmp/newspaper-screenshots/cuneiform-tablet/`. The [British Museum's Babylonian Chronicle photo](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en) suggested an uneven clay rim, pressed wedges above the masthead, and a scored rule across each pair of briefs. The production port carries the clay surface across the independently captured header and body. The ordinary layout starts its first headline 64 px higher at 1200 px paper width and 52 px higher at 360 px. The before and after folders also show the breaking and analysis layouts. The after folders include a sample Persian issue with its own masthead.

**Winged-Sun Papyrus.** Compare `folio.png`, `reference-nakht-chapel.jpg`, and `papyrus-study-claude.html` in `.tmp/newspaper-screenshots/winged-sun-papyrus/`. The [Met's facsimile of Nakht's offering chapel](https://www.metmuseum.org/art/collection/search/548438) suggested a lotus frieze and stacked bands in teal, terracotta, and ochre. The port follows Claude's study with a pale plaster wash, painted columns between brief pairs, and a winged sun beside the title. The masthead takes one row at game width, putting the first headline 92 px from the top. All three layouts are in the before and after folders. The after folders also include a sample issue of *The Nubian Ledger*.

Papyrus uses a single painted mark beside each headline, such as a house for domestic news or a riverboat for trade. See `topic-icons.png` for the set and the `topics-360` and `topics-1200` folders for examples in print. The priority in `story.ts` is military, congress, science, religion, culture, trade, economy, cities, domestic, international, then politics. Older issues with the `foreign` tag use the international mark. If there is no recognized tag, the headline gets a decorative lotus.

**Cracked Oracle Shell.** Compare `folio.png`, `reference-shang-oracle-bone.jpg`, and Claude Code's `oracle-shell-study.html` in `.tmp/newspaper-screenshots/cracked-oracle-shell/`. The [Smithsonian's inscribed turtle plastron](https://asia-archive.si.edu/object/F1985.35/) dates to the late Shang period (ca. 1250–1050 BCE). The image is CC0. The study borrows the broken rim and turns the shell's seams into dividers. It keeps the pale writing field and small clusters of incisions beside the masthead. The offline study starts its first headline 128 px down at 1000 px paper width and stacks the briefs at 360 px.

#### Claude Code prompt for Winged-Sun Papyrus

This is the original prompt for Opus, which built `papyrus-study-claude.html` as a second study. For a first study, provide the baseline and reference and omit the earlier HTML input. The smaller reference in this prompt was a scratch copy of the same museum image.

```text
Work in F:/vox-deorum/vox-deorum on one independent design sketch for Vox Deorum's Winged-Sun Papyrus newspaper. Read only these inputs:
- F:/vox-deorum/vox-deorum/.tmp/newspaper-screenshots/winged-sun-papyrus/papyrus-study.html (first HTML demo, including its four sample stories)
- F:/vox-deorum/vox-deorum/.tmp/newspaper-screenshots/winged-sun-papyrus/folio.png (current production baseline)
- F:/vox-deorum/vox-deorum/.tmp/newspaper-screenshots/winged-sun-papyrus/reference-nakht-chapel.jpg (The Met's facsimile of Nakht's offering chapel; consult if the CLI supports viewing it; at 4.6 MB)
- F:/vox-deorum/vox-deorum/.tmp/newspaper-screenshots/winged-sun-papyrus/_nakht-claude-preview.jpg (smaller copy of the same image; use this first).
Write only F:/vox-deorum/vox-deorum/.tmp/newspaper-screenshots/winged-sun-papyrus/papyrus-study-claude.html. The user wants a more stylish reimplementation, use your own composition and art direction. Use the painted horizontal registers, lotus bands, limited pigment (teal, terracotta, ochre) and overall visual character as starting points. Design for a historical artifact with distinctive details and not a modern web page with texture. You may draw your own inline SVG. Aim for immediate visual difference from the original sketch while being useful as a newspaper. Keep the upper margin minimal, the masthead short, and body text conspicuous against quiet texture. Use the same four articles and labels The Register and Trade for side-by-side comparisons, pair on wide paper (over 760 px) and stack in order at narrow widths (check conceptually at 360 px), keep one continuous text column per story, and retain recognizable navigation, story links and sample vote affordances. Output one self-contained offline HTML with no external dependencies. Keep the code simple; if adding functions, provide a brief purpose comment. Write plain language without em dashes. Do not run shell / tests; Codex will verify.
Stay within the assigned paths and task. Preserve unrelated edits. Do not change Git state, delegate further, or access secrets. Report blocked actions and uncertainty instead of attempting workarounds. Return the affected paths and evidence for each acceptance criterion.
```

### Which design runs

Once there are enough stories to publish, the editor draws among designs with positive weight, a printable fallback title, and an eligible layout for the edition. An eligible design competes when its weight is at least half the strongest one. A competitive design stays for its first three published issues, then joins a weighted draw at each check. After six issues, the next draw leaves it out if another competitive design is eligible. Skipped checks do not advance the run.

Use `when` to rule out a format that would be out of place. Knotted Cord Account, for example, fits the South American civs from Ancient through Renaissance, with extra weight for The Inca. Keep a general option for each era and a fallback if the era is missing. Use the catalogue audit to compare choices across civs. Use `designSelection` in the [CLI replay audit](replay.md#iterate-on-a-rule-or-overlay) to see what happened in a recorded game.

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

Declare built-in images and ornaments in the design's `assetDefinitions`. The registered ID joins the design and local IDs: Steam-Press Broadsheet's `harbour` becomes `steam-press-broadsheet.harbour`. Overlays and saved issues refer to these bundled IDs. Keep an ID if an existing issue still uses it.

1. Place the file under `vox-agents/newspaper/public/assets/designs/<design id>/`.
2. Give its definition a unique local ID, kind (`image` or `ornament`), media type, dimensions, license, and attribution. Set `path` to a relative path starting with `assets/`, such as `assets/designs/steam-press-broadsheet/harbour.png`. Omit dot segments and URL syntax.
3. Reference the registered ID in `presentation.assets.ornamentAssetId` or in an article's `image.assetId`. An article image requires `altText` and can also have a caption.
4. Rebuild with `npm run build:newspaper -w vox-agents` so the reader bundles the declarations and copies the assets.

## Families and designs

A renderer family supplies the shared structure. A design can give it a distinct composition without changing the reader's article and interaction model. The references below identify techniques to borrow.

| Stock design | Family | Layout and source |
| --- | --- | --- |
| Forum Bronze (`forum-bronze`) | `inscription` | Framed, centred notice board. Roman *Acta Diurna*, Pompeii election notices, Trajan’s Column capitals, and a [bronze *tabula ansata*](https://metmuseum.org/art/collection/search/251144) for the masthead panel. |
| Cracked Oracle Shell (`cracked-oracle-shell`) | `folio` | Framed writing field for East Asian civs. [Shang bronze cauldron](https://www.metmuseum.org/art/collection/search/60594) for the production ornament; [inscribed turtle plastron](https://asia-archive.si.edu/object/F1985.35/) for the shell study. |
| Cuneiform Tablet (`cuneiform-tablet`) | `folio` | Clay tablet with paired entries for West Asian civs. [Babylonian Chronicle tablets](https://artsandculture.google.com/asset/the-life-and-times-of-nebuchadnezzar-ii/6AFSiGg9EQkQ7Q?hl=en): an uneven rim, a pressed wedge stamp, and scored rules across each pair. |
| Winged-Sun Papyrus (`winged-sun-papyrus`) | `folio` | Stacked painted registers for North African civs. [Nakht’s chapel](https://www.metmuseum.org/art/collection/search/548438): lotus friezes, painted columns, and a winged sun over a pale plaster wash. |
| Scented Court Letters (`scented-court-letters`) | `folio` | Letters on dyed paper. [Gen’ei poetry manuscript](https://emuseum.nich.go.jp/detail?content_base_id=100171&content_part_id=000&langId=en): violet dye, washi fibers, and a folded slip at the foot. |
| Bound Palm Leaves (`bound-palm-leaves`) | `folio` | Bound leaves with briefs in pairs, for India, Siam, and Indonesia. [Bengal palm leaf folio](https://www.metmuseum.org/art/collection/search/74850): etched binding margins and a green cover. |
| Painted Screenfold (`painted-screenfold`) | `folio` | Accordion panels for The Maya and The Aztecs. [Dresden Maya Codex](https://www.slub-dresden.de/en/explore/manuscripts/the-dresden-maya-codex/content): fold marks and red ruling, repeated in the breaking and analysis bands. |
| Knotted Cord Account (`knotted-cord-account`) | `folio` | Reports hanging from a shared cord, for South American civs. [Inka khipu](https://dma.org/art/collection/object/5328374): hanging strands divide wide reports and mark the start of narrow ones. |
| Winter Count Hide (`winter-count-hide`) | `folio` | Painted hide for North American and steppe civs. [Lone Dog’s winter count](https://centerofthewest.org/2015/12/05/treasures-lone-dogs-winter-count/): a spiral of yearly pictographs, bordered with bead rows after [Haudenosaunee wampum](https://www.onondaganation.org/culture/wampum). |
| Stamped Bark Cloth (`stamped-bark-cloth`) | `folio` | Stamped bands for Southeast Asian and Pacific civs. [Tongan ngatu](https://collections.tepapa.govt.nz/object/83325): beaten bark and stamped triangles, with a [Marshallese rebbelib stick chart](https://www.metmuseum.org/art/collection/search/311297) for the ornaments. |
| Serpent Runestone (`serpent-runestone`) | `folio` | Carved stone over vellum for Northwestern European civs. [Jelling monuments](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/the-monuments-at-jelling): red serpent bands and interlace. |
| Imperial Purple Codex (`imperial-purple-codex`) | `folio` | Gold and silver letters on purple vellum for Southern, Central, and Eastern European civs. [Rossano Gospels](https://artsandculture.google.com/story/9wXBYc45V5WHdA): dyed parchment and gilt panels. |
| Illuminated Town Book (`illuminated-town-book`) | `folio` | Ruled vellum with short notices. [Hours of Catherine of Cleves](https://www.themorgan.org/manuscript/76941): gilt initials and ruled notices. |
| Embroidered Frieze (`embroidered-frieze`) | `folio` | Centered lead above a band of briefs. [Bayeux Tapestry](https://www.bayeuxmuseum.com/en/the-bayeux-tapestry/discover-the-bayeux-tapestry/what-is-the-tapestry-about/): stitched bands on pale linen. |
| Caravan Manuscript (`caravan-manuscript`) | `folio` | Manuscript leaves for African civs, Arabia, Persia, and The Ottomans. [Timbuktu manuscripts](https://artsandculture.google.com/project/timbuktu-manuscripts): laid paper, red and green headpieces, margin glosses, and tooled leather wallets. |
| Courier Slips (`courier-slips`) | `folio` | [Mughal court newsletters](https://royalasiaticcollections.org/akhbarat-archive/): one slip per story, with its observation turn in a ruled margin. |
| Woodcut Tidings (`woodcut-tidings`) | `folio` | Single sheet with a large headline and optional woodcut. [Hans Glaser’s 1561 Nuremberg news sheet](https://www.e-manuscripta.ch/zuzneb/wick/content/titleinfo/2723858): one prominent woodcut beside the lead. |
| Quayside Ledger (`quayside-ledger`) | `folio` | Ruled shipping list with paired briefs. [Lloyd’s List](https://assets.lloyds.com/media/fe594686-4cc1-4f4d-92ca-b013225d3cfb/Lloyd%27s_pocket_guide_v11Oct23.pdf): compact masthead and ruled entries; the wide lead puts its headline beside the text. |
| Coffeehouse Half-Sheet (`coffeehouse-half-sheet`) | `folio` | Numbered half-sheet with an essay and paired notices. [Addison and Steele’s *The Spectator*](https://collections.soane.org/b5321): a numbered imprint, fine rules, and modest serif headlines. |
| Stargazer’s Almanack (`stargazers-almanack`) | `folio` | [Benjamin Banneker’s 1793 *Almanack and Ephemeris*](https://transcription.si.edu/pdf/8045/NMAAHC-2014_63_31_008): a turn gutter and celestial ornaments. Put the lead first, then briefs by observation turn, with undated briefs last. |
| Steam-Press Broadsheet (`steam-press-broadsheet`) | `broadsheet` | Ruled multi-column print page. Masthead ears from *The Illustrated London News*, as on its [9 June 1855 front page](https://emuseum.vassar.edu/objects/10134/the-illustrated-london-news-june-9-1855-front-page-p-56), and *Harper’s Weekly*; *The Times* rules, and *Le Petit Journal* for breaking news. |
| Brocade Picture News (`brocade-picture-news`) | `folio` | Framed lead above paired briefs, for East Asian civs. [Utagawa Yoshiiku’s 1870s news print for *Tokyo Nichi Nichi Shinbun*](https://pages.uoregon.edu/jsmacollections/home/artists/utagawa-yoshiiku-1833-1904/showing-the-flag.html): a ribbon title and a lead frame that works with or without art. |
| Hawker’s Handbill (`hawkers-handbill`) | `folio` | Centered lead over pairs of ruled notices. [José Guadalupe Posada’s *Gaceta Callejera*](https://www.metmuseum.org/art/collection/search/729891): a tight serif headline and buff letterpress paper. |
| Evening Extra (`evening-extra`) | `folio` | Full-width headline over two columns of briefs. [*Evening World*](https://www.loc.gov/item/sn83030193/1911-03-25/ed-1/): condensed type and heavy rules, red for the breaking lead. |
| Tendril Monthly (`tendril-monthly`) | `folio` | Illustrated lead panel above the briefs. [Alfred Roller’s first cover for *Ver Sacrum*](https://artsandculture.google.com/asset/titelblatt-ver-sacrum-organ-der-vereinigung-bildenden-k%C3%BCnstler-%C3%96sterreichs-1898-jg-1-heft-1/NgGTFjIUaduJQQ): botanical art across the lead frame. |
| Telegram Form (`telegram-form`) | `folio` | Telegram form with boxed tabs and pairs of ruled briefs. [Western Union telegram](https://tile.loc.gov/storage-services/service/mss/mss65570/ms/s6/55/70/-0/16/09/mss65570-01609/mss65570-01609.pdf): routing boxes, a turn field, and a typewritten headline strip. |
| Sunday Funnies (`sunday-funnies`) | `folio` | Broad lead panel above smaller color panels. [*Little Nemo*’s Sunday comic pages](https://blogs.loc.gov/headlinesandheroes/2018/06/before-bang-pow-zap/): flat colors, narrow gutters, and varied panel sizes. |
| Pictogram Bulletin (`pictogram-bulletin`) | `folio` | Statistical plate above the lead text. [Vienna’s Isotype statistical plates](https://isotyperevisited.org/2012/08/society-and-economy.php): evidence above the lead; percentage bars leave missing values blank. |
| Glossy Photo Weekly (`glossy-photo-weekly`) | `folio` | Picture weekly with a tinted masthead and compact briefs. [first issue of *LIFE*](https://www.life.com/history/lifes-first-ever-cover-story-building-the-fort-peck-dam-1936/): monochrome cover art, such as Paul Vanderbilt’s [1938 harbor photograph](https://www.loc.gov/item/2017868572/). A large headline works on its own. |
| Asymmetric Grid (`asymmetric-grid`) | `folio` | Two story stacks on the ordinary front and paired stories in sections. [*Neue Grafik*](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965): an asymmetric front with two stories on the left. Section briefs pair on wide paper. |
| Darkroom Contact Sheet (`darkroom-contact-sheet`) | `folio` | Enlarged lead frame with one column of text above smaller frames. [Peter Hujar’s darkroom contact sheets](https://www.themorgan.org/blog/peter-hujars-contact-sheets-record-keeping-and-ephemeral-proof): silver frames, charcoal gutters, and a separate frame for analysis evidence. |
| Cut-and-Paste Zine (`cut-and-paste-zine`) | `folio` | Briefs pair on wide pages. A lead spans both columns. [Photocopied punk fanzines](https://exhibits.library.cornell.edu/punkfest/feature/rise-of-the-fanzines) inspired the cut paper headlines and lime highlights. |
| Teletext Screen (`teletext-screen`) | `folio` | Broadcast headline strip and index of briefs. [BBC’s Ceefax screens](https://downloads.bbc.co.uk/rd/pubs/archive/pdffiles/engineering/bbc_engineering_111.pdf#page=8): colored tabs, fixed-width type, and a red breaking strip. |
| Mission Console (`mission-console`) | `folio` | Framed readouts on a dark field. [Apollo Mission Control](https://www.nasa.gov/johnson/history/apollo-mcc-restoration/) consoles, ISS laptop displays, and glass cockpit panels, with an amber strip for caution alerts. |
| Endless Scroll (`endless-scroll`) | `feed` | Full-width timeline. Social timelines such as [Bluesky](https://bsky.app): round avatars, bylines, and actions below a post. Wide posts can place photos or data beside the text. |

Stock designs offer ordinary, breaking, and analysis layouts. A breaking page emphasizes the lead. Most analysis layouts put evidence beside the story on wide sheets and below it on narrow sheets.

Endless Scroll shows each known observation turn before the thumbs-up button. Telegram Form, Quayside Ledger, and Teletext Screen put it near the headline. These designs keep the editor's story order. Telegram Form also labels the edition's cutoff in its masthead. Courier Slips and Stargazer’s Almanack have dedicated date fields and show **Undated** when no turn was recorded.

## Rendering constraints

- Give every story one continuous column of text, including the lead. A lead can fill the row. Its body still reads straight down, even when art or evidence sits alongside it.
- Above 760 CSS pixels of paper width, pair briefs side by side, one story per column. Give a lead its own row above the briefs when the editor selects one. At narrower widths, stack the stories in reading order. For exceptions, see the design table and the examples in **Mockups**.
- Keep the issue's copy, links, votes, and evidence in reading order. At narrow widths, scale display type before shrinking body text. Use the margins in `vox-agents/src/newspaper/renderer/layout.ts` so the reader and export have the same geometry.
- Keep selected-tab decoration in browser reader mode. The game draws selection itself. Use `--vd-vote-background` when vote icons need their own background in the export.
- Draw dividers from the format’s materials, such as an incised clay rule or an etched line beside a palm leaf’s binding hole. Use paper, ink, and accent tokens for these marks. Keep textures light behind type and use local artwork for intricate motifs.
- Style figures through `vd-number` and names through `vd-name`. By default, names are underlined.
- Avoid CSS filters and give reader ornaments an export equivalent. For example, the inscription's fixed bottom frieze ends the exported page.
