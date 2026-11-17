# Science triggers

Science stories report eras, significant technologies, output changes, and changes in technology leadership. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/science.json`; authored variants are in `vox-agents/newspaper/templates/science.json`. Detection lives in `vox-agents/src/newspaper/editorial/developments/events.ts` and `developments/national.ts`.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `new-era`, `era` | A permitted `TeamSetEra` event for a domestic or known foreign team. Same-turn national observations may supply its era label. Multiple events for one team in the interval retain the latest era and all supporting references. | 1; 1 |
| `significant-technology`, `technology` | Receiver-team `TeamTechResearched` with positive `ChangeAmount`, or `TeamSetHasTech` with true `HasTech`, matches `identities`. Duplicate acquisition representations share one report. | 1; 1 |
| `science-shift`, `scienceOutput` | Domestic science per turn changes by at least `absolute: 10` and `relative: 0.25`; `window: 10`. | Absolute science-per-turn change; 40 |
| `technology-lead`, `technologyLead` | The leader set by technology count changes among at least two known major civilizations, including the receiver. Every known major needs usable current and earlier counts. `maxGap: 3` limits observation age; `absolute: 1` limits the spread between compared observation dates; `window: 15`. All durations are Standard turns. | 1; 1 |

## Evidence and repeats

The technology allowlist ships with Writing, Philosophy, Education, Printing Press, Scientific Theory, Industrialization, Electricity, Radio, Computers, Internet, and Future Tech. `tuning.identities` replaces that list. Match recorded localized names; callers supplying `technologyIdentities` can also match stable technology types. Unknown numeric IDs alone cannot provide an authored technology name.

Numeric era events use a same-turn recorded era label where available, otherwise the generic "a new era." Era and curated technology reports share a research series for the same civilization, so one issue selects at most one of those angles. Known technology comparisons do not establish a global ranking.

## Placeholders

| Family        | Useful factual placeholders                                  |
| ------------- | ------------------------------------------------------------ |
| Era           | `era`, `eventTurn`.                                          |
| Technology    | `technology`, `eventTurn`.                                   |
| Science shift | `output`, `previousOutput`, `change`, `direction`.           |
| Leadership    | `leaders`, `previousLeaders`, `technologies`, `knownMajors`. |
