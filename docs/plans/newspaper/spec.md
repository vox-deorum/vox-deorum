# Newspaper: feature specification

Status: conceptual draft. This document describes the feature we want. [research.md](research.md) records technology references, available data, and questions for the later technical design.

## 1. Goal

Help the player understand what is happening in their civilization and among their neighbors. As a campaign develops, especially in the late game, meaningful changes become scattered across many cities, civilizations, screens, and notifications. The newspaper brings those changes together into a readable account of the world.

An issue should reveal something worth noticing: a neighbor's growing cultural influence, a trading relationship becoming more important, cities recovering at different speeds, or several small developments that together signal a larger change. Coverage of other civilizations is valuable in its own right, as well as for its consequences at home.

**Story series are the backbone of the publication.** They follow developments across issues, helping the player recognize how the world is changing. Short standalone pieces bring variety and introduce subjects that may later grow into series.

The creative direction combines the historical atmosphere of Victoria 3 with the local character and occasional wit of SimCity 4. The publication evolves from oral accounts to chronicles, printed papers, broadcasts, and digital news as technology advances.

Success means the player can skim an issue, understand more of the world, and find something they want to investigate. Both scripted and LLM-assisted editions should achieve this.

## 2. The player experience

### 2.1 Reading an issue

Each civilization has its own publication, with a consistent identity and an archive. A discreet unread indicator announces a new issue. The player can open it when convenient.

A typical issue contains a lead story, updates from selected series, and a few short standalone pieces, around 200 to 400 words altogether. Early formats can be much shorter. The front page gives a quick overview; expanding an item reveals supporting facts, earlier installments, and links to relevant game screens.

Every item shows its subject, reporting period, and tags. The reader can browse the archive by date, civilization, city, or tag. Tags can also support sections such as **International News**, **Cultural News**, and **Commerce**.

In a busy late game, the publication groups related developments and highlights the most useful changes. A short international roundup can make several neighboring civilizations easier to follow. The overview should give the player more awareness within a manageable reading time.

### 2.2 Giving feedback

Every news item offers **upvote** and **downvote**, with the option to change or clear the vote.

- An upvote asks for more coverage like this.
- A downvote asks for less coverage like this.
- Leaving an item unrated has no effect.

Feedback guides future selection through the item's series, templates, and tags. For example, upvoting an installment about a neighbor's cultural rise encourages continued attention to that series and similar international and cultural stories. Downvoting several repetitive trade reports reduces their prominence.

For an ad hoc LLM story, its series and tags carry the preference into future selection. If its idea later becomes a reusable template, subsequent votes can also guide that template's priority. A merged item receives one vote, which informs its combined angle and related series.

A single vote is a small signal. The publication keeps a mix of subjects and occasionally tries less familiar ones. Explicit topic controls let the player choose stronger preferences or mute a topic. Votes belong to the receiving civilization's campaign and remain available in its archive.

### 2.3 Publication rhythm

Start with a check every five completed turns at Standard speed, adjusted for game speed. Publish when enough worthwhile material has accumulated. Quiet periods can produce shorter issues or skip an edition.

The player can adjust frequency, topic preferences, and LLM use. Generation happens in the background. Previously published editions remain readable while the background service is offline.

## 3. Stories, series, and editorial choices

### 3.1 The core concepts

| Concept | Role |
| --- | --- |
| News trigger | An observed event or comparison that makes a development worth considering. |
| News template | A reusable story angle, with trigger conditions, tags, and scripted variants. |
| News item | A published piece built from one or more templates, or an ad hoc angle. |
| Story series | A continuing subject followed through related items across issues. Its angle and templates can change as events unfold. |
| Short piece | A self-contained observation or brief that adds variety between series installments. |
| Issue | The editor's selection of new stories, series updates, and short pieces for one reporting period. |

The editorial loop is **observe developments → match story angles → revisit series → assemble an issue → learn from feedback**.

### 3.2 The life of a story series

A series follows a concrete subject, such as a neighbor's cultural rise, a growing trade dependency, or a region's recovery after war. It remembers the central question, places and civilizations involved, previous coverage, and latest developments.

| Stage | Editorial choice | Example: a growing trade dependency |
| --- | --- | --- |
| Start | Give a meaningful development a recognizable thread. A short piece can become the opening installment. | One neighbor now provides a large share of foreign trade earnings. |
| Continue | Publish a new installment when evidence advances the story, changes its direction, or reveals a consequence. | The relationship deepens, or diplomatic changes give the dependency new significance. |
| Fade | Reduce attention as developments slow or other subjects become more useful. A series can skip several issues. | The trade pattern stabilizes and there is little new to explain. |
| Close or return | Offer a closing assessment when there is a clear outcome; revisit an older series when new developments make it relevant. | Trade diversifies, or a later disruption brings the dependency back into focus. |

Series follow the observed game. Their pace and direction emerge from play. Fading can simply mean leaving the subject quiet; the archive keeps its history available for a later return.

Short pieces fill the space around these longer threads: a city's new specialty, a notable comparison, or a brief from a less-covered neighbor. They earn their place through an interesting observation. A quiet period can still produce a short issue.

### 3.3 News triggers

A trigger identifies a development that could contribute to a story. It can come from an in-game event, a comparison with past data, or a comparison between places or civilizations.

Each trigger carries the observation, affected subjects, time period, supporting facts, and one or more tags. A trigger becomes available when its condition is met. An ongoing condition can become relevant again after a meaningful change or a useful period of time.

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
- **Trigger conditions:** the required developments and how their subjects and reporting periods relate.
- **Tags:** one or more topics describing the resulting story.
- **Scripted variants:** alternative headlines and article text, with conditions for choosing them.
- **Series opportunities:** which subjects the angle can introduce or advance, and what might make a later installment worthwhile.

Variants can depend on technology, available evidence, the size or direction of a change, and earlier coverage. The same editorial idea can sound very different before Writing and after the Internet.

For example, a template about uneven prosperity combines improving national happiness with worsening local conditions during the same period. An early variant gives a short oral account of the affected towns. A printed variant becomes a provincial report. A digital variant can pair a concise article with a comparison of the cities over time.

Template matching also gives events context. A peace agreement and subsequent recovery in affected cities can support a story about the peace dividend. A change in a trading partner's relationships can combine with trade concentration to explain a developing dependency.

### 3.5 Merging templates into a story

Several matched templates may explain a development better together. The editor can merge their angles into one item with a shared question, supporting facts, and relevant tags.

For example, a trade-concentration template and a diplomatic-realignment template can become **“Our main market is moving into a new alliance.”** This brings economic and diplomatic evidence into one account and can advance the trade-dependency series.

Merging works when the subjects, time periods, and evidence support a useful connection. Common combinations have authored composite variants for scripted editions. An LLM editor can propose additional combinations and write them as a coherent piece.

One series may use different templates over its lifetime. Two series may also intersect in a shared installment, linked from both histories. It advances both series, with its vote shared equally between them. The issue presents that installment once, and later coverage can follow whichever threads remain interesting.

### 3.6 Tags and news sections

Triggers and templates both have tags. Trigger tags describe the underlying developments; template tags describe the editorial angle. A published item retains the tags relevant to its final story.

Start with a small shared vocabulary: domestic, international, cities, economy, trade, culture, science, society, religion, diplomacy, war, and recovery. Multiple tags let one item belong to several views. A story about a neighbor's cultural rise can appear under both International News and Cultural News.

Tags serve three purposes: organizing the reader's view, keeping an issue varied, and applying player preferences. A story appearing in several sections still occupies one place in the issue and receives one vote.

### 3.7 The editor: LLM or heuristics

The editor manages the publication over time. It decides which series to start, continue, fade, close, or revisit; which template angles to merge; and how to balance installments with short pieces. Both editorial modes receive the same observed triggers, matched templates, series history, and player preferences.

| Mode | Editorial choices | Writing |
| --- | --- | --- |
| Heuristic editor | Uses significance, novelty, elapsed time, series relevance, diversity, and player feedback to manage series and select items. Recognizes authored template combinations. | Uses conditional scripts and composite variants. |
| LLM editor | Interprets developments in the context of existing series, chooses their direction and prominence, connects angles, and assembles an issue. Can propose ad hoc templates from the supplied triggers. | Can use existing scripts or write new versions suited to the story and medium. |

The LLM has substantial editorial freedom within the available evidence and the player's topic controls. Algorithms supply factual comparisons and enforce the issue's publication budget. The heuristic editor provides the complete experience when LLMs are disabled or unavailable.

An ad hoc template can begin a series, contribute an installment, or supply a short piece. Its angle and supporting triggers remain recorded with the article. Later installments can use an authored template or another generated angle while keeping the same series identity. Useful generated ideas can subsequently be developed into reusable authored templates.

Series history and feedback carry across mode changes. General comparison and update scripts let the heuristic editor continue an LLM-originated series when new evidence supports an installment. A series can remain quiet until a suitable development appears.

## 4. What to cover

### 4.1 Editorial priorities

Prioritize stories that reveal a trend, contrast, connection, consequence, opportunity, or distinctive achievement. Existing notifications provide useful raw material; the newspaper adds context and helps the reader see patterns across them.

Domestic and international reporting are both core coverage. Selection considers developments within the civilization, among neighbors and trading partners, and across the wider known world. Local importance, international significance, novelty, and the player's interests all contribute to priority.

A good issue mixes places and subjects. War, the capital, or one large neighbor should leave room for cultural changes, provincial life, recoveries, and smaller civilizations. The mix follows the available stories rather than a fixed quota.

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

The publication's format and template variants evolve with the receiving civilization's research. The milestones below follow the checked-in VP tree; the media are proposed feature design. Writing is Classical in VP. Mass media is represented here through Radio and Telecommunications.

| Milestone | VP era | Presentation and editorial character |
| --- | --- | --- |
| Before Writing | Ancient / early Classical | Oral accounts: brief reports about settlements, encounters, and changes in local life. The archive presents them as remembered accounts. |
| Writing | Classical | Court chronicles or civic tablets: named places, recorded developments, and short comparisons. |
| Education | Medieval | Scholarly chronicles: correspondence, regional comparisons, and longer follow-ups. |
| Printing Press | Renaissance | Gazettes and broadsheets: recognizable news sections, merchant reports, and coverage of the known world. |
| Industrialization | Industrial | Mass-circulation papers: provincial reporting, industrial change, and statistical sidebars. |
| Radio | Modern | Broadcast bulletins: concise summaries, a national voice, and prominent international and cultural coverage. |
| Computers | Atomic | A data desk: clearer trends, longer comparisons, and supporting charts. |
| Telecommunications | Information | Network news: connected coverage of domestic and international developments. |
| Internet | Information | Digital editions: linked story histories and easy exploration of comparisons. |

These stages guide presentation and conditional scripts. Use the most advanced milestone the civilization has researched, including when research skips intermediate stages. Evidence access, feedback, and archive browsing are available throughout. A late-era start uses the appropriate format immediately.

Other technologies and institutions supply subjects and variant conditions: trade and banking, navigation and overseas contact, railways, corporations, archaeology, Great Works, and international institutions. The same template can gain new angles as those systems become relevant.

## 6. Knowledge and memory

The publication reports what its civilization can know at the reporting cutoff. Foreign coverage uses permitted observations, with dates for older intelligence. Comparisons use compatible measures and enough history to support the claim.

In the game-integrated version, the save holds the published archive and editorial memory: article text, tags, evidence summaries, contributing templates, series identities and status, votes, and topic preferences. MCP keeps a queryable copy for future generation. The offline version preserves the same publication history alongside its replay outputs.

Loading restores that campaign's publication history and preferences. Generation resumes from observations belonging to the loaded timeline. If historical evidence is unavailable, new comparisons build from the observations that remain valid. Old editions stay readable from the save.

The publication works for a human civilization independently of an LLM strategist. Its initial gameplay role is to inform and entertain. Systems such as propaganda, censorship, press ownership, or effects on happiness would be separate design work.

## 7. Develop against recorded games first

Existing MCP recordings provide the first development and evaluation environment. Replay a recorded game from one civilization's perspective, advancing the reporting cutoff a few turns at a time. At each check, the editor sees the observations available up to that point and its own publication history.

The first deliverable is a readable sequence of issues and a series history produced from those recordings. A simple local reading and feedback workflow lets us inspect installments, vote on items, and continue the replay with those preferences. Save the editorial choices with the output so we can understand why a series started, continued, or faded.

Start with domestic city contrasts, trade relationships, and independent developments among known foreign civilizations. Demonstrate a series starting, continuing, fading, and returning; a merged-template installment; and useful short pieces. Run both heuristic and LLM editors on the same recording segments to compare their coverage and continuity.

Recordings also let us try different publication intervals, technology-specific scripts, and feedback choices before building the game UI. Coverage depends on the fields and observation history each recording contains.

After the offline experience is useful, connect the same editorial loop to live play, game-save persistence, and the in-game reader. Artwork, audio, elaborate charts, and special editions can follow.

Evaluate the experience with these questions:

- Does a busy late-game issue help the player understand both home and neighboring civilizations?
- Do series make developments easier to follow across many turns?
- Do fading and returning series feel timely?
- Does merging templates reveal a useful connection in one coherent item?
- Do short pieces add worthwhile variety around the series?
- Do the same triggers support convincing early and late variants?
- Do votes gradually change coverage while preserving variety?
- Can tags support useful sections and archive searches?
- Can both editors sustain useful series, and where do their choices differ?
- Can a replay resume with its articles, series, and feedback intact?
- When integrated into the game, does saving and loading preserve that same continuity?

## 8. Choices for further iteration

| Choice | Starting proposal |
| --- | --- |
| Earliest experience | Short oral accounts before Writing, followed by written chronicles. |
| Publication frequency | Check every five Standard-speed turns; adjust to the amount of useful news. |
| Reading length | A brief overview with a few stories and expandable evidence. |
| Feedback scope | Campaign preferences for the receiving civilization, guided by item votes and explicit topic controls. |
| Editorial approach | LLM or heuristic management of series, template combinations, and issue selection. |
| Development sequence | Recorded games first, then live integration and the game UI. |
| Template catalogue | Begin with a small set spanning domestic life, relationships, and independent foreign developments. |

Next, choose recording segments and sketch representative series, short pieces, and template combinations. Use those examples to refine the editorial experience before choosing data structures, live scheduling, save integration, and UI details.
