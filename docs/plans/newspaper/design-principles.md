# Newspaper design principles

This guide helps designers and developers shape the proposed newspaper's layout, visual identity, and interactions. It builds on [the feature specification](spec.md).

## Make each issue easy to skim

Lead with one main story, followed by shorter pieces from varied places and subjects. Use type size, spacing, and dividing rules to show importance. Give the publication most of the screen, with little surrounding interface.

Keep the reading layout focused on the masthead, page tabs, stories, inline links, and quiet vote icons. Include dates and attribution in the prose when they help explain the news. Stories carry no tags, sources, observation periods, timestamps, issue numbers, or other metadata; their only links lead to places, civilizations, game screens, and earlier reports.

## Organize coverage into pages

Each page is one section tab. Keep the front page short enough to skim. A mixed **Headlines** front page leads the issue, with further coverage on pages such as **Military**, **Economics**, and **Foreign**.

- Pages come from predefined, configurable page definitions that select stories by tag. A page appears only when it has enough content; omit empty pages and filler.
- One story can appear on several pages with the same history and vote; keep the tags out of the story layout.
- Use a compact, consistent tab row. Mark the active tab with an underline, outline, or other shape as well as color.
- Give pages clear names that suit the publication's voice, such as **The Treasury** or **Letters Abroad**.
- Keep every story reachable through predictable scrolling within its page. Omit page numbers, page totals, and previous/next-page controls. Preserve the reading position when switching pages.

The archive sits outside the publication, in the surrounding game UI, and uses one standard interface style for every publication. Keep an archive control out of the newspaper's own design; opening an archived issue shows it in its original design.

## Build identity from civilization and era

Match composition, lettering, illustration, ornament, materials, and voice to a specific civilization and era. Let a civilization's style evolve across ages; neighbors can share a medium and retain distinct identities. Choose art references as each design develops.

### Typography and composition

Each publication should remain recognizable with its illustrations hidden. Choose display and body faces together, then vary casing, weight, spacing, line length, paragraph rhythm, and composition. Reserve decorative lettering for short display text and keep body text comfortable to read. English-language faces should evoke the medium and tone without claiming to reproduce historical writing systems.

The [HTML prototypes](prototypes/html/index.html) explore five directions:

| Publication | Typography and composition |
| --- | --- |
| Shang China | Marcellus capitals with measured spacing, Literata body text, squared bronze framing, and incised illustration. |
| Ancient Egypt | Monumental Cinzel headings, broad Alegreya body text, centered symmetry, and horizontal painted registers. |
| Heian Kyoto | Flowing Cormorant Garamond italics, lighter display weights, generous leading, and asymmetric letters beside a court painting. |
| Victorian | UnifrakturMaguntia masthead, high-contrast Bodoni Moda headlines, compact Libre Caslon Text paragraphs, engraved illustrations, and strong column rules. |
| Modern Twitter | Inter throughout, bold compact headlines, short paragraphs, circular avatars, and a single photographic feed. |

Bundle fonts with the prototypes for offline viewing. Use local fallback stacks, preserve font licenses, and check narrow screens after the intended faces load. Keep reading text selectable, scalable HTML.

### Illustration and ornament

Build character into the masthead, dividing rules, borders, seals, paper edges, and restrained textures. Keep illustrations as separate assets that support the account. Avoid decorative writing that readers could mistake for meaningful content.

Use local SVG ornaments for historical editions so they stay crisp at every size:

- **Shang China:** angular bronze patterns.
- **Ancient Egypt:** lotus and solar forms.
- **Heian Kyoto:** asymmetric flowering branches.
- **Victorian:** engraved scrollwork.

Repeat the motif in the masthead and closing rule, including breaking and analysis layouts. Keep ornaments clear of text and controls, scale them to the available width, and hide purely decorative images from assistive technology. Keep the Modern Twitter feed plain, without these ornaments.

## Match the layout to the moment

Provide three layout variants within each civilization and era's visual identity:

- **Ordinary issue:** a balanced front page with a lead, series updates, and short pieces.
- **Breaking news:** one dominant story, a large headline, minimal surrounding material, and a direct link to the affected place or player. A declaration of war against the reader gets this treatment when an issue covers it. Immediate special editions come later.
- **Review and analysis:** a calmer page for retrospectives, comparisons, and trends, with room for evidence and a longer view.

Reserve breaking-news prominence for urgent developments. Vary emphasis while keeping the masthead and controls consistent: the Victorian breaking edition uses a full-width uppercase headline; its analysis edition uses a quieter mixed-case headline and a clearly labeled evidence table.

## Support analysis and future graphs

Text reviews can use analysis layouts from the start. Mark templates **LLM-only** when they need bespoke written analysis; simple trend summaries can use authored text.

Leave room for future graphs of city population or other changes over time. Plot recorded observations with clear dates and units, and preserve gaps. Graph rendering is deferred.

## Lead the reader back into the world

Link each story to its subject: a city, map location, trade relationship, or relevant game screen. Link the named subject in the headline or prose, such as **Akkad** or **Bristol's harbour**. Give links a visible focus state and an accessible name that identifies the destination. Preserve the reading position when the player returns.

Keep archived issues readable as the game changes. If a destination no longer exists, say so briefly and keep the article readable. When an earlier installment helps explain a development, add a short descriptive link. Omit series metadata rows and installment numbers.

## Keep feedback quiet and reversible

Place small, consistent vote icons after each story, with enough space to select comfortably. An upvote asks for more similar coverage; a downvote asks for less. Leaving a story unrated requires no action.

Give each icon an accessible name and tooltip, without visible counters. Show the selected preference through shape or outline as well as color. Let the player change or clear it.

## Protect reading comfort

Use legible body text, strong contrast, comfortable line lengths, and clear paragraph spacing. Let long names and translated text wrap naturally, and adapt columns to the available space.

Provide a meaningful reading order, visible keyboard focus, and controls that work without a pointer. Move focus into secondary views, such as the archive, when they open; return it to the originating control when they close. Make the newspaper easy to dismiss and resume.

Use motion only to explain an interaction. Keep the reading surface calm and stable so the player can return to play at their own pace.
