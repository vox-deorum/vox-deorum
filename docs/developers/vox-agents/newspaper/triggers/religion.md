# Religion triggers

Religion stories report pantheons, religion milestones, city conversions, and changes in a national majority religion. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/religion.json`; authored variants are in `vox-agents/newspaper/templates/religion.json`. Detection lives in `vox-agents/src/newspaper/editorial/event-developments.ts`, `national-developments.ts`, and `development-facts.ts`.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `religion-pantheon`, `religionMilestone` | `stage: PantheonFounded`; domestic or permitted foreign event. Can use a generic pantheon label. | 1; 1 |
| `religion-founded`, `religionMilestone` | `stage: ReligionFounded` with a recorded religion name. | 1; 1 |
| `religion-enhanced`, `religionMilestone` | `stage: ReligionEnhanced` with a recorded religion name. | 1; 1 |
| `religion-reformed`, `religionMilestone` | `stage: ReligionReformed` with a recorded religion name. | 1; 1 |
| `city-conversions`, `cityReligion` | `CityConvertsReligion` names a different majority from a known earlier city snapshot or preceding event at the same coordinates and owner. Bundles confirmed changes by owner; `window: 15` bounds snapshot lookback. | Number of distinct changed cities; 4 |
| `national-religion`, `nationalReligion` | Domestic `MajorityReligion` changes between known text identities in comparable national observations. | 1; 1 |

## Evidence and repeats

Religion milestones cover permitted domestic and foreign subjects. The report's `domestic` or `international` tag follows the subject.

`CityConvertsReligion` also fires for follower-count changes. A first event without an earlier majority establishes a baseline; repeated events naming that same majority do not count as conversions. Capture or uncertain lifecycle evidence prevents a comparison from proving a majority change; same-turn ordering uses timestamps, with ties treated conservatively. A reversal requires an observed return to a previously seen majority within the available sequence.

Religion milestone fingerprints use the development's identity, so later representations cannot republish a milestone. Confirmed majority reversals can supply later developments.

## Placeholders

| Family | Useful factual placeholders |
| --- | --- |
| Milestones | `religion`, `eventTurn`. |
| Conversions | `conversions` (distinct changed cities), `changes` (majority transitions), `religions` (observed new majorities), `reversals` (cities returning to an earlier majority). |
| National majority | `religion`, `previousReligion`. |
