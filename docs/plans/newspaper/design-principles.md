# Newspaper design principles

Proposed reading experience for designers and developers, based on [the feature specification](spec.md).

## Set a clear hierarchy and organize sections

Anchor the issue with a lead story and shorter pieces from varied places and subjects. Use type size, spacing, and editorial rules to show importance. Let the publication occupy most of the reading surface, with little surrounding interface.

Keep the reading surface uncluttered: masthead, stories, inline links, and quiet vote icons. Omit article tag chips, source rows, timestamps, issue numbers, and other metadata from the reading layout. The issue does not need an archive button; earlier reports remain reachable from relevant stories. Keep reporting sources, observation periods, and editorial metadata in the supporting record, reachable through a quiet story-level link. Include dates and attribution in the narrative when they help explain the news.

Keep the opening selection short enough to skim. Organize further coverage through named section tabs backed by story tags, such as **Military**, **Economics**, and **Foreign**. Use a compact, consistent navigation row with a clearly marked active section. Do not show page numbers, page totals, or previous/next-page controls. Section names can suit the publication's voice, such as **The Treasury** or **Letters Abroad**, while remaining easy to understand.

Choose sections to fit the issue's worthwhile coverage. A mixed **Headlines** selection can lead the issue; omit empty sections and avoid filler. A story can appear in several sections while keeping the same evidence, history, and vote. Section tabs provide navigation; individual stories do not need to display their tags.

## Build identity from civilization and era

Match composition, lettering, illustration, ornament, materials, and voice to a specific civilization and era. A civilization's style changes across ages, while neighbors can share a medium and retain distinct identities.

Choose art references for each civilization and era as its design is developed. Build character into the masthead, rules, borders, seals, paper edges, and restrained textures. Use illustrations as separate assets and keep all reading text selectable, scalable HTML.

Typography should distinguish the publications even with their illustrations hidden. Choose display and body faces together, then vary casing, weight, spacing, line length, paragraph rhythm, and composition. Keep decorative lettering in short display text; body text must remain comfortable to read. English-language faces evoke the medium and tone without claiming to reproduce historical writing systems.

The [HTML prototypes](prototypes/html/index.html) explore these directions:

| Publication | Typography and composition |
| --- | --- |
| Shang China | Marcellus capitals with measured spacing, Literata body text, squared bronze framing, and incised illustration. |
| Ancient Egypt | Monumental Cinzel headings, broad Alegreya body text, centered symmetry, and horizontal painted registers. |
| Heian Kyoto | Flowing Cormorant Garamond italics, lighter display weights, generous leading, and asymmetric letters beside a court painting. |
| Victorian | UnifrakturMaguntia masthead, high-contrast Bodoni Moda headlines, compact Libre Caslon Text paragraphs, engraved illustrations, and strong column rules. |
| Modern Twitter | Inter throughout, bold compact headlines, short paragraphs, circular avatars, and a single photographic feed. |

Bundle fonts with the prototypes so the intended lettering survives offline viewing. Use local fallback stacks, preserve font licenses, and check narrow screens after the intended faces have loaded. Illustrations support the account without competing with the text or introducing decorative writing that readers could mistake for meaningful content.

## Match the layout to the moment

Plan layout variants for three common situations:

- **Ordinary issue:** a balanced front page with a lead, series updates, and short pieces.
- **Breaking news:** one dominant story, a large headline, minimal surrounding material, and a direct link to the place or player affected. War declared on the reader calls for this treatment in the next published issue. Immediate special editions come later.
- **Review and analysis:** a calmer page for retrospectives, comparisons, and trends, with room for evidence and a longer view.

Keep each layout within its civilization and era's visual identity. Reserve breaking-news prominence for urgent developments.

Vary typographic emphasis within that identity: the Victorian breaking edition uses a full-width uppercase headline, while analysis uses a quieter mixed-case headline and a clearly labeled evidence table. Changing the story's urgency should not change the publication's masthead or interaction vocabulary.

## Look ahead to data-backed stories

Text reviews can use analysis layouts from the start. Mark templates LLM-only when they require bespoke written analysis; simple trend summaries can use authored text. Future templates can add graphs of city population or other changes over time. Plot recorded observations with clear dates and units, and preserve gaps. Graph rendering is deferred, while layouts should leave room for it.

## Lead the reader back into the world

Give each story a clear route to its subject: a city, a map location, a trade relationship, or a relevant game screen. Link the named subject directly in the headline or prose, such as **Akkad** or **Bristol's harbour**. Keep links in their narrative context, with a clear focus state and a destination-specific accessible name. Returning to the newspaper preserves the reading position.

Archived evidence should remain reachable even after the game state changes. If a destination no longer exists, say so briefly and keep the article readable. Link an earlier installment when that history explains the development, using a short descriptive link without a series metadata row or installment number.

## Keep feedback quiet and reversible

Each story offers a small, consistent way to ask for more or less similar coverage. Votes use icons with an accessible name and a tooltip, without visible counters. Show the selected preference through shape or outline as well as color, and let the player change or clear it. Leaving a story unrated requires no action.

Place feedback after the narrative, with enough space to select comfortably.

## Protect reading comfort

Use legible body text, strong contrast, comfortable line lengths, and clear paragraph spacing. Let long names and translated text wrap naturally. Adapt columns to the available space, and keep every story reachable through predictable scrolling within named sections. Preserve the reading position when switching sections. Mark the active tab with an underline, outline, or other shape as well as color.

Provide a meaningful reading order, visible keyboard focus, and controls that work without a pointer. Opening a supporting view moves focus appropriately; closing it returns the player to the originating action. Keep the newspaper easy to dismiss and resume.

Use motion only when it explains an interaction. A calm, stable reading surface keeps attention on the account and lets the player return to play at their own pace.
