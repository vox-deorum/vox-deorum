# Newspaper: feature specification

Status: conceptual draft. This document describes the feature we want. [research.md](research.md) records technology references, available data, and questions for the later technical design.

## 1. Goal

Make the game more fun by giving the player useful information, memorable stories, and practical hints, especially while they are learning. As a campaign develops, meaningful changes become scattered across cities, civilizations, screens, and notifications. The newspaper brings them together and helps the player understand why they matter and what they might do next.

An issue should reveal something worth noticing: a neighbor's growing cultural influence, a trading relationship becoming more important, cities recovering at different speeds, or several small developments that together signal a larger change. A hint can connect that observation to a game mechanic and a useful next step, such as reviewing routes when one partner supplies most foreign trade income. Coverage of other civilizations is valuable in its own right, as well as for its consequences at home.

The newspaper can extend game mechanics by supplying information beyond existing screens or visibility rules. Some information leakage is acceptable when a concrete reporting source or gameplay rule explains it, such as merchants bringing news from a trading partner's city. Judge these extensions by how much they improve play and help players learn.

**Story series are the backbone of the publication.** They follow developments across issues, helping the player recognize how the world is changing. Short standalone pieces bring variety and introduce subjects that may later grow into series.

The creative direction combines the historical atmosphere of Victoria 3 with the local character and occasional wit of SimCity 4. The publication evolves from oral accounts to chronicles, printed papers, broadcasts, and digital news as technology advances.

Success means the player enjoys skimming an issue, learns something useful, and finds an opportunity or next step worth investigating. Both scripted and LLM-assisted editions should achieve this.

## 2. The player experience

### 2.1 Reading an issue

Each civilization has its own publication, with a consistent identity and an archive. A discreet unread indicator announces a new issue. The player can open it when convenient.

A typical front page contains a lead story, updates from selected series, and a few short standalone pieces, around 200 to 400 words altogether. Early or quiet editions can be much shorter. The front page gives a quick overview of the most important news; opening an item reveals supporting facts, earlier installments, and links to relevant game screens.

The narrative identifies each item's subject. Its supporting record provides the reporting period and tags. The reader can browse the archive by date, civilization, city, or tag. Tags can also support sections such as **International News**, **Cultural News**, and **Commerce**.

An issue can span multiple pages. Page count adapts to the amount of worthwhile news and the space its stories need. A quiet issue may fit on one page; a busy late-game issue can add pages for international roundups, local reports, and longer analysis. Group related developments, keep the most important items on the front page, and provide clear navigation to the rest. Extra pages should earn their place through useful coverage. Each visual design expresses pages in its own medium, such as tablets, broadsheet pages, or digital sections.

### 2.2 Giving feedback

Every news item offers **upvote** and **downvote**, with the option to change or clear the vote.

- An upvote asks for more coverage like this.
- A downvote asks for less coverage like this.
- Leaving an item unrated has no effect.

A vote adjusts selection weights for future items sharing the rated item's series or tags. For example, upvoting an installment about a neighbor's cultural rise encourages continued attention to that series and similar international and cultural stories. Downvoting several repetitive trade reports reduces their prominence.

A single vote is a small signal, and the publication keeps a mix of subjects. Votes belong to the receiving civilization's campaign and remain available in its archive. Stronger controls, such as muting a topic, can come later.

### 2.3 Publication rhythm

Start with a check every five completed turns at Standard speed, adjusted for game speed. Publish when enough worthwhile material has accumulated. Quiet periods can produce shorter issues or skip an edition.

The player can adjust frequency and LLM use. Generation happens in the background. Previously published editions remain readable while the background service is offline.

## 3. Stories, series, and editorial choices

### 3.1 The core concepts

| Concept | Role |
| --- | --- |
| News trigger | An observed event or comparison that makes a development worth considering. |
| Condition | A requirement about the receiving civilization or the game, such as a researched technology, an adopted policy, or being one of certain civilizations. Triggers, templates, story variants, visual designs, and layout variants all use the same conditions. |
| News template | A reusable story angle, with required triggers, conditions, tags, writing mode, and weighted variants. Future templates can also request graphs. |
| Variant | One way to tell a template's story, with its own conditions and weight. |
| Visual design | The civilization and era's presentation style, including typography, imagery, and reading style. Each design has conditions, a weight, and layout variants for different editorial needs. |
| Layout variant | An arrangement within a visual design, such as a regular front page, breaking-news lead, or analysis page. Conditions and weights determine its use. |
| News item | A published piece built from one or more templates, or an ad hoc angle. It carries an importance value and one or more series keys. |
| Series key | A label for the subject an item covers, such as a trade partner, a city, or a neighbor's culture. |
| Story series | All items that share a series key. Its importance grows with each new item and fades with time. |
| Short piece | A brief item, often the first under its series key, that adds variety between longer installments. |
| Issue | The editor's selection of stories for one reporting period, presented in a chosen visual design across an adaptive number of pages. |

**Conditions** are one shared vocabulary. A trigger, a template, a story variant, a visual design, or a layout variant can each list conditions, and it is available only while all of them hold. Examples:

- has researched a technology, or has yet to research it
- has adopted a policy or opened a policy branch
- is one of a named set of civilizations
- is in a given era, or follows a given religion or ideology
- includes an urgent event affecting the reader, or has enough historical observations for a review

Because every level uses the same conditions, a requirement sits wherever it is most natural. A trigger about ideological pressure requires an ideology. A template about press barons requires Printing Press. A variant written in a civilization's own voice requires that civilization. A visual design for bamboo slips requires Writing and an early era.

The editorial loop is **observe developments → match story angles → weigh candidates and their series → choose a visual design and layouts → arrange pages → learn from feedback**.

### 3.2 The life of a story series

Every item carries an **importance** value and one or more **series keys**. A series key names a concrete subject: a neighbor's cultural rise, the trade relationship with one partner, a region recovering after war. Templates derive keys from the subjects of their triggers, so the same subject produces the same key in later issues. An LLM editor assigns keys to its ad hoc items in the same way.

A series is the set of items sharing a key, and a few simple rules give it a life:

- The first item published under a new key starts a series. Until another item joins, it reads as a short piece.
- Each item adds its importance to every series it belongs to, so a series grows when a second item arrives and keeps growing as the subject develops.
- Series importance fades with time, so a quiet subject gradually leaves the front page.
- Series importance adds to the selection weight of every candidate item carrying that key. Active subjects therefore attract follow-ups, and a faded one returns when a new development is important enough on its own.

| Stage | What happens | Example: a growing trade dependency |
| --- | --- | --- |
| Start | An item appears under a new key. | One neighbor now provides a large share of foreign trade earnings. |
| Grow | Further items share the key and raise the series' importance, making follow-ups more likely. | The relationship deepens, or diplomatic changes give the dependency new significance. |
| Fade | No new items arrive and importance declines. The series can skip several issues. | The trade pattern stabilizes and there is little new to explain. |
| Return | A later item with the same key lifts the series again and links to its history. | A later disruption brings the dependency back into focus. |

An item with several keys belongs to several series. A story about the main trading partner joining a new alliance carries both the trade-dependency key and the alliance key. It is printed once, contributes its importance to both series, and appears in both histories.

Series follow the observed game, and their pace and direction emerge from play. The archive keeps every series' history available. Short pieces fill the space around the longer threads: a city's new specialty, a notable comparison, or a brief from a less-covered neighbor. A quiet period can still produce a short issue.

### 3.3 News triggers

A trigger identifies a development that could contribute to a story. It can come from an in-game event, a comparison with past data, or a comparison between places or civilizations.

Each trigger carries the observation, affected subjects, time period, supporting facts, and one or more tags. A trigger fires when its shared conditions hold and its development is observed. An ongoing development can become relevant again after a meaningful change or a useful period of time.

| Example trigger | What it detects | Possible tags |
| --- | --- | --- |
| Happiness improves | National happiness rises meaningfully over a reporting period | domestic, society |
| Local happiness falls | One or more cities' local happiness declines over a reporting period | domestic, society, cities |
| Trade concentrates | An increasing share of route income comes from one partner | economy, trade, international |
| Neighbor gains cultural weight | Comparable visible measures show a neighbor's cultural influence growing | international, culture |
| Diplomatic relationships shift | Observed alliances or relationships change within the known world | international, diplomacy |
| A city recovers | Population or output recovers after an earlier disruption | cities, recovery, economy |

Thresholds and comparison periods will need tuning. The conceptual requirement is to detect changes that are significant enough to help explain the game.

### 3.4 News templates

A news template defines an editorial idea: which triggers make it relevant, how they fit together, and how to tell the story. It can match one trigger or a combination of triggers.

Each template has:

- **A story angle:** what the reader should learn.
- **Required triggers:** the developments it needs and how their subjects and reporting periods relate.
- **Conditions:** shared conditions that must hold for the template to apply at all.
- **Writing mode:** scripted-capable or LLM-only. An LLM-only template requires generation during play and is eligible only when that is available.
- **Tags:** one or more topics describing the resulting story.
- **Variants:** alternative headlines and article text, each with its own conditions and weight.
- **Series keys:** the subjects the resulting item belongs to, derived from its triggers.
- **Importance:** how much the resulting item matters, scaled by the size of the change.
- **Future graph support:** optional measures, subjects, and reporting periods for a graph, with the observations needed to support it.

A variant is configured in two parts:

| Part | Purpose | Example |
| --- | --- | --- |
| Conditions | Decide whether the variant is eligible at all. | Requires Printing Press; only for Venice and Portugal. |
| Weight | A base value plus adjustments, each tied to a condition, that decide how likely an eligible variant is. | Base 10; add 90 before Writing; add 50 for civilizations following Tradition. |

Weight adjustments use the same shared conditions, and can also respond to the story itself: available evidence, the size or direction of the change, and earlier coverage. The editor chooses among eligible variants in proportion to their weights, so wording styles overlap during transitions and the prose stays varied. The same editorial idea can sound very different before Writing and after the Internet, or in two different civilizations.

Authored variants are written ahead of time, often with LLM help, while the LLM editor writes new ones during play. Templates with authored text can support either editorial mode. Mark templates **LLM-only** when their angle needs a bespoke written interpretation, such as a review connecting several phases of a city's growth to earlier coverage. LLM assistance during authoring alone does not make a template LLM-only.

For example, a template about uneven prosperity combines improving national happiness with worsening local conditions during the same period. An early variant gives a short oral account of the affected towns. A printed variant becomes a provincial report. A digital variant can pair a concise article with a comparison of the cities over time.

Template matching also gives events context. A peace agreement and subsequent recovery in affected cities can support a story about the peace dividend. A change in a trading partner's relationships can combine with trade concentration to explain a developing dependency.

Graph support is a later extension. A city-population template could pair a trend graph with a review of growth, decline, and recovery across several issues. Other templates could compare trade income or cultural influence over time. Graphs use recorded observations with clear subjects, dates, and units; gaps remain visible. Scripted templates can summarize simple trends, while LLM-only templates can develop richer review and analysis pieces from the same evidence. LLMs write the interpretation; the observations supply the plotted values. The initial catalogue should work without graphs.

### 3.5 Visual designs

A **visual design** decides how an issue looks and reads: page shape, typography, ornament, imagery, and interaction style. Match the art styles of the specific civilization and era through composition, lettering, illustration techniques, materials, and motifs. Proposed directions include Babylonian reliefs and cylinder-seal imagery, Renaissance Venetian woodcuts and print typography, industrial British engravings, and contemporary Japanese editorial illustration. A civilization's visual language changes over time; research references for each design as it is developed.

Story variants choose the wording of an item. Layout variants arrange the selected content within the publication's visual identity. The text, series, evidence, tags, votes, and archive browsing remain available under every design, and votes and supporting links stay easy to find.

A design uses the same configuration rules as a variant:

| Part | Purpose | Example |
| --- | --- | --- |
| Conditions | Decide whether the design is eligible at all. | Requires Writing; only for China. |
| Weight | A base value plus adjustments, each tied to a condition, that decide how likely an eligible design is. | Base 10; add 90 in the Classical and Medieval eras; subtract 10 after Printing Press. |

The editor chooses one design per issue from the eligible designs with positive weight, in proportion to their weights. A zero weight removes a design from consideration even when its conditions hold. Several designs can coexist in one era, and different civilizations can use different designs at the same time. As research and circumstances change, weights shift and a publication can move to another design.

Within that design, choose layout variants for the front page and subsequent pages using the same conditions and weights. A declaration of war against the reader calls for a breaking-news front page with a dominant headline and immediate consequences in the next published issue. Text reviews can use an analysis layout from the start; future population reviews can add a graph. Urgency determines the required prominence; weights choose among suitable layouts. These variants retain the civilization and era's art direction and work across different page counts. Immediate special editions outside the regular publication checks remain later work.

The [newspaper design principles](design-principles.md) guide narrative, visual hierarchy, civilization and era identity, and navigation. Further directions could include Chinese bamboo slips and a Korean short-video feed.

Visual design and editorial selection are separate choices. The editor picks stories from the same triggers, templates, series, and votes, then arranges them across pages in suitable layouts. Published issues keep their design, layout choices, and page order in the archive, while later editions can adopt a new design without breaking series or reading history.

### 3.6 Merging templates into a story

Several matched templates may explain a development better together. The editor can merge their angles into one item with a shared question, supporting facts, and relevant tags.

For example, a trade-concentration template and a diplomatic-realignment template can become **“Our main market is moving into a new alliance.”** This brings economic and diplomatic evidence into one account and can advance the trade-dependency series.

Merging works when the subjects, time periods, and evidence support a useful connection. Common combinations have authored composite variants for scripted editions. An LLM editor can propose additional combinations and write them as a coherent piece.

A merged item keeps the series keys of its contributing templates, so it advances each of those series at once. One series may also use different templates over its lifetime, since only the key connects its items.

### 3.7 Tags and news sections

Triggers and templates both have tags. Trigger tags describe the underlying developments; template tags describe the editorial angle. A published item retains the tags relevant to its final story.

Start with a small shared vocabulary: domestic, international, cities, economy, trade, culture, science, society, religion, diplomacy, war, and recovery. Multiple tags let one item belong to several views. A story about a neighbor's cultural rise can appear under both International News and Cultural News.

Tags serve three purposes: organizing the reader's view, keeping an issue varied, and applying player preferences. A story appearing in several sections still occupies one place in the issue and receives one vote.

Present sections as named tabs, such as Military, Economics, and Foreign, with names adapted to the publication's voice. These tabs replace numbered-page navigation. Omit article tags, metadata rows, and a standalone archive control from the reading surface; keep sources, observation periods, and editorial details in the supporting record. Earlier reports remain reachable through story links. Dates and attribution can remain in the narrative when they explain the story. The design principles define the visual treatment, including distinct typography and composition for each civilization and era.

### 3.8 The editor: LLM or heuristics

The editor assembles each issue. It chooses which candidate items to publish, which template angles to merge, how to balance installments with short pieces, and how to present them across pages. Both editorial modes receive the same observed triggers, series history, player feedback, and eligible visual designs. Template eligibility also depends on writing mode and available evidence.

Each candidate has a **selection weight**: its own importance, plus the importance of its series, adjusted by novelty, variety within the issue, and votes.

Use those priorities to place the most useful stories on the front page and group further coverage into additional pages. Immediate threats to the reader, such as a declaration of war, take front-page priority regardless of topic votes or an older series' accumulated weight. Page count follows worthwhile coverage and readability, with the front-page reading target kept short.

| Mode | Editorial choices | Writing |
| --- | --- | --- |
| Heuristic editor | Fills the issue with the highest-weighted candidates. Recognizes authored template combinations. | Picks among authored variants by weight, including composite variants. |
| LLM editor | Takes the weights as guidance, interprets developments in the context of existing series, connects angles, and assembles an issue. Can propose ad hoc templates from the supplied triggers. | Can use authored variants or write new ones suited to the story and visual design. |

The LLM has substantial editorial freedom within the available evidence, and the facts it reports come from the supplied triggers. Algorithms supply factual comparisons and help keep each page readable. The heuristic editor provides the core reading, series, and feedback experience when LLMs are disabled or unavailable. It skips LLM-only templates and can cover the same development through an eligible scripted template. If generation fails, omit the unfinished item and assemble the issue from available content.

An ad hoc item receives series keys and an importance value like any other, so it can start a series, join one, or stand as a short piece. Its angle and supporting triggers remain recorded with the article. Useful generated ideas can subsequently be developed into reusable authored templates.

Series history and feedback carry across mode changes. Because a series is defined by its key, the heuristic editor continues an LLM-originated series whenever an authored template produces an item with the same key.

## 4. What to cover

### 4.1 Editorial priorities

Prioritize stories that reveal a trend, contrast, connection, consequence, opportunity, or distinctive achievement. Existing notifications provide useful raw material; the newspaper adds context and helps the reader see patterns across them.

Where useful, explain the relevant mechanic and suggest a concrete next step, especially for newer players. For example, a report on stalled city growth can point to the observed food shortage and link to the city screen. Hints should follow the evidence, describe options, and leave the decision to the player.

Domestic and international reporting are both core coverage. Selection considers developments within the civilization, among neighbors and trading partners, and across the wider known world. Local importance, international significance, novelty, and the player's interests all contribute to priority.

A good issue mixes places and subjects. War, the capital, or one large neighbor should leave room for cultural changes, provincial life, recoveries, and smaller civilizations. The mix follows the available stories.

### 4.2 Candidate story families

These are content ideas to develop into triggers and templates. The first implementation will choose a small set after checking the available evidence.

| Family | Interesting questions | Possible trigger combinations |
| --- | --- | --- |
| Provincial life | Which cities are thriving or falling behind? | National growth + contrasting city trends |
| Living conditions | Who benefits when national conditions improve? | Happiness change + local differences; needs data can explain the causes |
| Trade and dependency | Which relationships increasingly sustain the economy? | Route-income concentration + changes involving the partner |
| Opportunity | Which useful capacity has remained idle? | Unused trade capacity + persistent economic need |
| Regional specialties | Where are new centers of production, science, or culture forming? | Changing city shares + sustained growth or a relevant milestone |
| Faith and society | How is the religious geography changing? | Visible majority changes across cities or borders |
| Cultural exchange | Which neighbors are gaining influence, and where do cultural relationships deepen? | Visible cultural trends + known contact or exchange |
| International affairs | How are neighboring powers and diplomatic groups changing? | Comparable civilization trends + observed relationship changes |
| City-states and Congress | Which smaller powers or coalition shifts deserve attention? | Known alliances + relevant resources, proposals, or voting strength |
| War and recovery | What are the continuing effects of conflict and peace? | Known conflict history + population, ownership, or output changes |
| Infrastructure and resources | Where has expansion created a bottleneck? | Growth + observed connections, capacity, or resource constraints |
| Retrospectives | What became of a place or development covered earlier? | Earlier story + recovery, reversal, or a new consequence |

International stories can stand on their own. A neighbor's emergence as a cultural center or a shifting balance among known powers can be interesting before it has an immediate domestic effect. Where evidence is limited, the article describes the visible change and identifies the period observed.

### 4.3 Voice

Use era-appropriate language, local character, and restrained humor. Facts come from game observations; interpretation should be recognizable as interpretation. Earlier issues keep their original text and can be linked from later follow-ups.

## 5. Evolution with technology

The publication's visual design and template variants evolve with the receiving civilization's research. The milestones below follow the checked-in VP tree; the media are proposed feature design. Writing is Classical in VP. Mass media is represented here through Radio.

| Milestone | VP era | Presentation and editorial character |
| --- | --- | --- |
| Before Writing | Ancient / early Classical | Oral accounts: brief reports about settlements, encounters, and changes in local life. The archive presents them as remembered accounts. |
| Writing | Classical | Court chronicles, clay tablets, or bamboo slips: named places, recorded developments, and short comparisons. |
| Education | Medieval | Scholarly chronicles: correspondence, regional comparisons, and longer follow-ups. |
| Printing Press | Renaissance | Gazettes and broadsheets: recognizable news sections, merchant reports, and coverage of the known world. |
| Industrialization | Industrial | Mass-circulation papers: provincial reporting, industrial change, and statistical sidebars. |
| Radio | Modern | Broadcast bulletins: concise summaries, a national voice, and prominent international and cultural coverage. |
| Computers | Atomic | A data desk: clearer trends, longer comparisons, and supporting charts. |
| Internet | Information | Digital editions: connected domestic and international coverage, linked story histories, and easy exploration of comparisons. Feed designs can range from short posts to portrait story cards with prominent captions. |

The table describes the prevailing media. Several visual designs can be eligible at the same time. Clay tablets and bamboo slips can coexist in an early written era, and an Information-era civilization can receive a Twitter-style short-post feed or a TikTok-style portrait feed. The latter can present illustrated text cards; moving images and audio remain later possibilities.

These stages guide visual design and variant weights. Each milestone raises the weight of designs for its medium, so older designs thin out gradually and research that skips a stage needs no special handling. Evidence access, feedback, and archive browsing are available throughout. A late-era start uses the appropriate designs immediately.

Other technologies and institutions supply subjects, variant conditions, and visual design conditions: trade and banking, navigation and overseas contact, railways, corporations, archaeology, Great Works, and international institutions. The same template can gain new angles as those systems become relevant.

## 6. Knowledge and memory

The publication uses reporting rules chosen for enjoyable, useful gameplay. It can reveal facts beyond existing screens and visibility rules when a concrete source or mechanic justifies that access. For example, an active trade route could report civilian growth in its destination city, giving commerce an additional informational benefit. Modest leakage is acceptable under these rules. Each extension should explain what the source reveals and why that helps play.

Foreign coverage starts with three sources:

- **Direct access:** what the civilization sees or takes part in itself.
- **Trade routes:** a route with another nation brings news from there, usually about the destination city.
- **Spies and diplomats:** an agent stationed in a foreign city brings news from it, with more detail as the agent's strength grows.

The later technical design will define the facts and periods each source grants. Apply those rules when preparing evidence for either editor, including any deliberate extensions to existing visibility. Newly learned history can support a retrospective if the source justifies it. Facts still need recorded support, and replay uses only evidence available by its reporting cutoff. Older intelligence carries its date; comparisons use compatible measures and enough history to support the claim.

In the game-integrated version, the save holds the published archive and editorial memory: article text, tags, evidence summaries and reporting sources, contributing templates, series keys and importance, votes, and each issue's visual design, layout variants, and page order. Future graph content must preserve its plotted observations too. MCP keeps a queryable copy for future generation. The offline version preserves the same publication history alongside its replay outputs.

Loading restores that campaign's publication history and preferences. Generation resumes from observations belonging to the loaded timeline. If historical evidence is unavailable, new comparisons build from the observations that remain valid. Old editions stay readable from the save.

The publication works for a human civilization independently of an LLM strategist. Its initial gameplay role is to inform and entertain. Systems such as propaganda, censorship, press ownership, or effects on happiness would be separate design work.

## 7. Develop against recorded games first

The per-game knowledge stores that the MCP server already keeps serve as **recordings** and provide the first development and evaluation environment. Replay a recorded game from one civilization's perspective, advancing the reporting cutoff a few turns at a time. At each check, the editor sees the observations available up to that point and its own publication history.

The first deliverable is a readable sequence of issues and a series history produced from those recordings. A simple local reading and feedback workflow lets us inspect installments, vote on items, and continue the replay with those preferences. Save the editorial choices with the output so we can understand why a series started, continued, or faded.

Start with domestic city contrasts, trade relationships, and independent developments among known foreign civilizations. Demonstrate a series starting, continuing, fading, and returning; a merged-template installment; and useful short pieces. Run both heuristic and LLM editors on the same recording segments to compare their coverage and continuity.

Recordings also let us try different publication intervals, variant and visual design weights, and feedback choices before building the game UI. Coverage depends on the fields and observation history each recording contains.

After the offline experience is useful, connect the same editorial loop to live play, game-save persistence, and the in-game reader. Graph rendering and graph-based review templates are later work. Richer artwork, audio, and immediate special editions can follow; the design direction already includes civilization- and era-specific art, layout variants, and adaptive pages.

Evaluate the experience with these questions:

- Does a busy late-game issue help the player understand both home and neighboring civilizations?
- Do hints teach a useful mechanic or suggest a worthwhile next step, especially for newer players?
- Does extra information have a concrete reporting reason and make play more enjoyable?
- Does page count adapt to quiet and busy periods while keeping the most important news easy to skim?
- Do series make developments easier to follow across many turns?
- Do fading and returning series feel timely?
- Does merging templates reveal a useful connection in one coherent item?
- Do short pieces add worthwhile variety around the series?
- Do the same triggers support convincing early and late variants?
- Do designs reflect the art of their civilization and era, with suitable layouts for ordinary and breaking news?
- Does each published issue keep its design, layouts, and page order while stories, votes, and archive stay readable?
- Do votes gradually change coverage while preserving variety?
- Can tags support useful sections and archive searches?
- Can both editors sustain useful series, and where do their choices differ?
- Does disabling or losing LLM generation leave a useful issue while skipping LLM-only templates?
- Can a replay resume with its articles, series, and feedback intact?
- When integrated into the game, does saving and loading preserve that same continuity?

## 8. Choices for further iteration

| Choice | Starting proposal |
| --- | --- |
| Earliest experience | Short oral accounts before Writing, followed by written chronicles. |
| Publication frequency | Check every five Standard-speed turns; adjust to the amount of useful news. |
| Reading length | A front page of roughly three to six items in 200 to 400 words, shorter when quiet; add pages as worthwhile coverage grows. |
| Series | Items share series keys; series importance grows with each item, fades with time, and raises the weight of follow-ups. |
| Conditions | One shared vocabulary (technology, policy, civilization, era, and similar) used by triggers, templates, story variants, visual designs, and layout variants. |
| Variants | Eligible by conditions, weighted by a base value plus conditional adjustments, and chosen in proportion to weight. |
| Visual designs | Art direction specific to the civilization and era; choose an eligible design by weight, then suitable layout variants for ordinary, breaking, or analysis coverage. |
| Feedback scope | Item votes that adjust future selection weights through shared series and tags for the receiving civilization's campaign. Topic controls come later. |
| Foreign knowledge | Direct access, trade routes, and spies or diplomats, with concrete reporting rules that can extend existing visibility for gameplay value. |
| Editorial approach | LLM or heuristic selection by weight, with template combinations; explicitly mark LLM-only templates and skip them when generation is unavailable. |
| Future graphs | Templates can request evidence-backed trends and comparisons for review or analysis; graph rendering follows the initial text experience. |
| Language | English first; other languages once the catalogue settles. |
| Development sequence | Recorded games first, then live integration and the game UI. |
| Template catalogue | Begin with a small set spanning domestic life, relationships, and independent foreign developments. |

Next, choose recording segments and sketch representative series, short pieces, template combinations, and visual designs. Use those examples to refine the editorial experience before choosing data structures, live scheduling, save integration, and UI details.
