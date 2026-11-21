# Newspaper designs

A newspaper design decides how an issue looks: colors, fonts, ornaments, decoration and page labels. The stories and their information stay the same in every design. This page records the design principles and the three stock designs. The [renderer guide](renderer.md) covers the presentation contract, export and testing; the [editorial guide](editorial.md#pages-and-designs) covers when each design is chosen.

## Principles

1. **Content is fixed; decoration varies.** Every design shows the same elements: the masthead title and optional motto, section tabs, headline, deck, byline, prose, the earlier-report link, votes and the evidence table. A design adds no text of its own, such as dates, prices, volume numbers or a "Breaking" label. Emphasis comes from scale, color, rules, frames, ornaments and initials.
2. **Keep text short.** Today's amount of text is the ceiling. A richer design adds decoration, not words.
3. **Decoration grows with age.** The ancient design is the most decorated, the Victorian design uses period print ornament, and the modern design stays clean but has a strong identity.
4. **Base each design on real-world references.** Name the sources (see the table below) and take concrete devices from them, such as a frame shape, a rule style or a type choice.
5. **Decoration frames the content.** Place ornaments at the edges of the sheet rather than between the masthead and the stories. For example, the ancient design runs a Greek key frieze along the top and bottom of the sheet and uses smaller margins, so it gains decoration and reading space at once.
6. **An ornament is its own divider.** Where an ornament separates parts of the page, it does the job alone. Do not wrap it in extra rules or padding. The ancient design's Greek key frieze is the pattern itself with no lines above or below, and the ivy leaf between briefs stands without flanking rules. Every rule and margin spends space that the ornament already marks.
7. **Draw decoration from color tokens.** Frames, friezes, dividers and initials are CSS pseudo-elements with inline SVG masks filled with the paper, ink and accent colors. They follow a design's colors and add no asset loads. Use image assets only for artwork that cannot be drawn this way, such as illustrations or the Victorian scrollwork.
8. **Figures are styled.** The reader wraps every number in article text in a `vd-number` span, and each design gives figures their own treatment.
9. **Tintable designs derive their palette from one color.** The feed family computes its whole palette from the accent color, so a civilization's color can restyle it. Derived colors must stay legible for any input, from near black to pale yellow: text colors darken pale tints and text on a solid fill switches between white and ink. Alert red is reserved for breaking pages and is never tinted.
10. **Narrow papers drop crowding ornament first.** As the paper narrows, designs shrink or remove side ornaments (dovetail handles, medallions, column hairlines, inner frame lines) and scale display type down before touching reading text.

## Families and designs

A renderer family is a layout structure that several designs can share. A design is one variant of a family, with its own tokens, fonts, assets and page labels. Add a new look as a design first, and add a family only for a new structure.

| Family | Structure | Stock design | Real-world references |
| --- | --- | --- | --- |
| `inscription` | Framed, centred notice board | `oral-accounts`, Accounts of the Settlements (ancient) | The Roman *Acta Diurna* notice board, painted election notices at Pompeii (red and black), Trajan's Column capitals (Cinzel), the *tabula ansata* panel for the masthead, Greek key friezes, and the *hedera* ivy leaf as divider |
| `broadsheet` | Ruled multi-column print page | `victorian`, The Civic Chronicle (Classical era onward) | *The Illustrated London News* and *Harper's Weekly* mastheads with medallion ears, *The Times* Oxford rules, printers' factotum initials and fleurons, and *Le Petit Journal* for the breaking edition |
| `feed` | Single timeline column of posts | `wire`, The Civic Wire (Modern era onward) | Social timelines such as Bluesky: a centred post column between hairlines, round avatars, the byline as the post header, an action row of votes, and one brand tint |

Each family has three front-page layouts. Ordinary pages lead with one story followed by briefs. Breaking pages enlarge and frame the lead: a framed proclamation, a headline between heavy bars, or a pinned alert post. Analysis pages pair the lead with the evidence table, set as a carved tally, a ledger or a data card.

## Rendering constraints

Designs must keep these rules so the browser reader and the game texture match:

- Horizontal page margins come from the family's layout defaults in `src/newspaper/renderer/layout.ts`, because export measures content at that width. Change the default there rather than overriding horizontal page padding in CSS.
- Decoration on the selected tab is limited to reader mode, because the game draws the selected tab itself.
- Avoid CSS `filter`, which makes export paints nondeterministic.
- A reader-only decoration needs an export counterpart. The ancient design's bottom frieze stays fixed under the scrolling page in the browser; exported pages end with the same frieze instead.

## Add or change a design

1. Add or edit the design JSON in `vox-agents/newspaper/designs/`, choosing its family, tokens, fonts, assets, layouts and page labels.
2. Keep family styles in `vox-agents/newspaper/src/reader/families/<family>.css`, scoped to the family's `data-design` value.
3. Put design-owned artwork in `newspaper/public/assets/designs/<design id>/` and register it as described in the [asset notes](editorial.md#design-assets).
4. Check every layout at wide and narrow widths, and for the feed family with several tints, in the preview (`npm run newspaper:preview -w vox-agents`).
