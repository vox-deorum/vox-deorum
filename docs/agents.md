# Documentation guide

These instructions apply to the prose documentation under `docs/`. The repository-level [agents guide](../AGENTS.md) still applies, including its Documentation Rules: update docs in the same change that alters behavior, never create them proactively, and keep raw code out of pages.

The model page is [Command Value and Priorities](developers/civ5-dll/unit-ai/commands/value.md). It explains a dense set of formulas with one overview diagram, tables in place of paragraphs, and every term and example number labeled where it appears. When a rule below is unclear, see how that page does it.

## Write for a named reader

Every page should make its audience clear. Most pages belong to one of these:

| Page kind | Reader | Start with |
| --- | --- | --- |
| Player guides, `players/` | Here to play, not to read code. May be new to installing software, configuration files, terminals or API keys. | What the reader will be able to do. Introduce each concept before asking the reader to use it, and link a primary external source when it explains something better. |
| Developer guides, `developers/` | Has programming experience but no prior knowledge of this repository. | The subsystem's purpose, then where its code lives and how to work on it. |
| Architecture and protocol pages | Needs the system's rules. | What the system is. Build procedures belong in component guides and implementation sequencing in `plans/`. |

Do not assume the reader arrived from another page or knows a repository convention. State prerequisites where they first matter and link to the fuller explanation.

## Shape the page

Lead with the core concept and the big picture, then give details in the order they depend on each other. value.md follows this order:

| Part | Job | In value.md |
| --- | --- | --- |
| Opening sentence | What the concept is and why it matters. | Priority decides which fights get shared units first. |
| Overview diagram | How the parts combine, before any part is explained. | A tree from `Priority = θ × stake` down to each term. |
| Summary tables | The pipeline or lifecycle at a glance. | The stage table from raw value to queue priority, and the table of values fixed for the turn and values refreshed after each command. |
| Shared definitions | Symbols, scales and inputs used by several sections. | Shared values and scales, and running example inputs. |
| One section per concept | The rule, its parts, then worked examples. | Theater multiplier, fight priority, destroyed value, exposure and so on. |

Use a heading for every concept a reader may want to link to, and keep the heading stable once other pages link to it.

## Annotate in place

Explain a term or number where the reader meets it, inside the formula, table cell or sentence that uses it. Do not add a sentence after a table to say where a number came from. If a reader would have to ask "what is this 0.4?", label it.

| What needs explaining | Put it | Example from value.md |
| --- | --- | --- |
| A constant inside a calculation | A short label in parentheses right after the number. | `700 (F) × 0.4 (health share) × 30/100 (D_t / M) = 84` |
| A setting and its default | The default in parentheses beside the setting name. | `floor.theater` (0.2) |
| A new concept | Bold its name on first use, in the cell or sentence that defines it. | `i` (**importance**): `min(1, city value / Z_C)` |
| What a formula part means | A "Part" or "Term" table with a "Reads as" column. | `(1 − floor.theater)`, room above the floor, so `θ` tops out at 1. |
| A reason or exception | The same cell as the rule it qualifies. | Exposure is "counted in full: the search can also protect by moving our units away." |
| An edge case | One more row in the example table. | "The city with 20 local damage or less" scores 0. |
| Where an input comes from | A Source column. | City allowance `C` is 3, from setting `city.units`. |

Label a constant the first time it appears in a table. Later rows in the same table may repeat it bare, as the destroyed value examples do.

## Formulas and examples

Most developer pages explain rules with numbers. Make every number traceable:

1. **State the formula once**, inline in backticks, then break it down in a Part or Term table.
2. **Collect symbols** in a table with Symbol, Meaning, and Scale or range columns, so the reader knows what units each quantity carries.
3. **Fix one set of running example inputs** in a table with a Source column (supplied, a setting, or derived). Examples use these inputs unless their lead-in states others.
4. **Lay out each example as a table.** Use one row per case and one column per intermediate quantity, and put the result in the last column. Write each calculation with its labels, round only for display, and check every number with a scratch script before finishing.
5. **Use contrasting cases**: a case that scores 0, a typical case, and a case at the cap. value.md's theater examples run from a quiet cityless zone (0.2) to a battered enemy capital (0.97).

## Diagrams

Use Mermaid diagrams for flows, hierarchies and relationships that prose cannot define accurately without becoming long.

- Open a page with an overview diagram when it has several interacting parts. Add a smaller diagram inside a section that branches, like value.md's diagram of the terms each fight kind adds up.
- Keep node labels short: a name and one line of meaning, such as "Contest c, how likely the city changes hands".
- Let the heading or a single lead sentence carry the takeaway. The tables that follow give the detail.

## Keep prose short

Prose connects the tables; it does not repeat them.

- Open each section with one sentence on what the concept is for, then go to the formula or table.
- Use bullets for parallel facts, numbered lists for ordered work, and a short paragraph only when the ideas form one continuous explanation.
- Turn a note that follows a table into a row, a column or a cell annotation.
- Remove background that does not help the reader decide or act. Omit consequences that only restate the preceding fact. Keep the reason behind a constraint that would otherwise look arbitrary.
- Describe each concept by its purpose, behavior and relationships.
- Use the same term after its introduction instead of defining it again or switching synonyms.

When rewriting an existing page, compare the removed text with the replacement. Preserve product rules, safety warnings, exceptions and context the reader still needs. If that context makes the page cover two distinct jobs, split it into focused pages and cross-link them.

## Use shared terms and links

Use the same names as the product and the architecture documentation, especially these terms: **agent**, **strategist**, **spokesperson**, **session**, **recording**, **replay**, **event**, **turn**, **bridge**, **provider**, and **model**.

Link instead of duplicating:

| Content | Home |
| --- | --- |
| Player task instructions | `players/` |
| Developer procedures and component reference | `developers/`, one folder per component (`civ5-dll`, `civ5-mod`, `bridge-service`, `mcp-server`, `vox-agents`) |
| System-wide rules and data flow | [Architecture](developers/architecture.md) and [protocol](developers/protocol.md) |
| Build order and implementation status | `plans/` |
| Release changelogs | `versions/` |

Use relative links with descriptive link text, never "click here". Prefer stable, primary external sources such as the Node.js, TypeScript, npm, Model Context Protocol, and Civilization V Community Patch and Vox Populi documentation.

## Refer to code without pasting it

- Name the source file, function or setting in backticks, such as `CvTacticalOperationalValue.cpp` or `BuildThreats`, and describe what it does. Leave the deep implementation detail in the code and its TypeDoc reference.
- Formulas and short identifiers in backticks are fine; code blocks copied from source are not.
- Do not use line-number anchors, since they drift.
- When a command genuinely helps, fence it and give it a language.

## Before finishing

- Reread the page against this guide and the [model page](developers/civ5-dll/unit-ai/commands/value.md).
- Check that every term and example number is labeled where it appears.
- Recompute every worked number.
- Confirm every relative link and heading anchor resolves, including links from other pages to headings you renamed.
- Check that the page stays consistent with the [architecture](developers/architecture.md) overview and the [documentation index](README.md).
