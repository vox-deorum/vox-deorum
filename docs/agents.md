# Documentation guide

These instructions apply to the prose documentation under `docs/`. The repository-level [agents guide](../agents.md) still applies, including its Documentation Rules: update docs in the same change that alters behavior, never create them proactively, and keep raw code out of pages.

## Write for a named reader

Every page should make its audience clear. Documentation here serves two audiences, and most pages belong to one of them.

- Player guides under `players/` assume the reader is here to play, not to read code. They may be new to installing software, editing configuration files, working in a terminal, or managing API keys. Introduce a concept before asking the reader to use it, and link to a primary external source when one explains it better than we can.
- Developer guides under `developers/` assume programming experience, but not prior knowledge of this repository. Start with the purpose of the subsystem, then explain where its code lives and how to work on it.
- Architecture and protocol pages describe what the system is and the rules it follows. Keep build procedures in the component guides and implementation sequencing in `plans/`.

Do not assume the reader arrived from another page or already knows a repository convention. State prerequisites and important assumptions where they first matter, then link to the fuller explanation.

## Present concepts clearly

Bring the page's core concept forward. Put its purpose, prerequisites, and most common path near the top, then introduce supporting concepts before details that depend on them. For all mentioned concepts, highlight each when it first appears, usually with bold text, and either define it there or link directly to its authoritative definition. Use the same term consistently after that introduction instead of defining it again. Describe each concept affirmatively through its purpose, behavior, and relationships.

Give every explanation a useful job. Remove background that does not help the reader make a decision or complete a task. Omit consequences that merely restate an obvious result of the preceding fact. Keep rationale when it explains a constraint that would otherwise look arbitrary, such as why a build step must run before another.

Choose the format that defines or explains the material most efficiently:

- Use bullets for parallel facts and numbered lists for ordered work.
- Use tables for comparisons, mappings, and repeated fields.
- Use small diagrams for flows, hierarchies, and relationships that prose cannot define accurately without becoming long or difficult to follow. Explain the takeaway near the diagram.
- Use a short paragraph when the ideas form one continuous explanation.

When rewriting an existing page, compare the removed text with the replacement. Preserve product rules, safety warnings, exceptions, and context that the intended reader still needs. If that context makes the page cover two distinct jobs, split it into focused pages and cross-link them rather than deleting it.

## Use shared terms and links

Use the same names as the product and the architecture documentation, especially these terms: **agent**, **strategist**, **spokesperson**, **session**, **recording**, **replay**, **event**, **turn**, **bridge**, **provider**, and **model**.

Link instead of duplicating:

- Player task instructions belong under `players/`.
- Developer procedures and component reference belong under `developers/`, with one folder per component (`civ5-dll`, `civ5-mod`, `bridge-service`, `mcp-server`, `vox-agents`).
- System-wide rules and data flow belong in [architecture](developers/architecture.md) and [protocol](developers/protocol.md).
- Build order and implementation status belong under `plans/`.
- Release changelogs belong under `versions/`.

Use relative links between pages in `docs/`. When referring to source code, name the file or directory by its repository path rather than linking to a specific line, since line anchors drift. Prefer stable, primary external sources such as the Node.js, TypeScript, npm, Model Context Protocol, and Civilization V Community Patch and Vox Populi documentation.

## Keep Markdown readable

- Write natural, direct sentences in plain prose.
- Describe behavior and name the source file instead of pasting raw code; keep the deep implementation detail in the code and its TypeDoc reference.
- When a command or short snippet genuinely helps, fence it and give it a language.
- Use headings to make long pages scannable.
- Avoid long runs of one-sentence bullets when a short paragraph reads better.
- Add descriptive link text. Avoid "click here."
- Do not use line-number anchors.

Before finishing, reread the page against this guide, confirm every relative link resolves, and check that it stays consistent with the [architecture](developers/architecture.md) overview and the [documentation index](README.md).
