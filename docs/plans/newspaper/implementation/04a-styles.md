# Plan 4a: narrative styles

**Status: technical plan.** First of three streams that give the newspaper its substance. This stream adds voice, stance and genre tags. [Plan 4b](04b-story-mining.md) finds story types independently, and [Plan 4c](04c-variant-drafting.md) drafts variants for the tags.

## Goal

Let stories carry a voice, a stance and a genre without hand-written rules on every variant, and keep selection deterministic and evidence-backed. Creative vocabulary, writing guidance and tuning values belong to the owner.

## Catalogue

`newspaper/styles.json` holds registered tag IDs for the three axes, optional owner guidance for each tag, and reusable positive rules. A rule names the tags it matches and the facts it reads. It may match one tag or several, so one condition can lift a family of voices without repeating the rule.

A variant either carries all three fields (`voice`, `stance`, `genre`) or none. Untagged variants are legacy and resolve to general, neutral and report only at use.

## Selection

Selection keeps its order. After story selection and presentation eligibility, the editor evaluates the existing evidence for the story and adjusts the seeded variant draw before it runs. A matching rule multiplies the weights of eligible variants that carry its tags. A tag with no matching evidence changes nothing; missing facts are not penalties. Factual gates stay in place, so a variant the evidence cannot support is still excluded.

Voices may differ between stories in one issue. Mixed voices are allowed, for example a foreign dispatch beside a local notice.

Repeated genres are damped within an issue. The nth earlier use of a genre multiplies later draws by 1/(1+0.25*n) in draw order: the first use is unaffected, the second is weighted 0.8 and the third 0.67.

## Audit and compatibility

The decision audit records each article's variant ID and displayed voice, stance and genre. A saved catalogue without `styles.json` replays with its original draws, because untagged variants use the legacy resolution and no rule can act without a style file.

## Tests

Mock tests under `tests/mock/newspaper/` cover rule odds in a controlled seeded draw, absent evidence leaving weights unchanged, repeat damping in draw order, old catalogue replay, and the displayed tags in the audit. A rule matching several tags is checked against each tag.

## Out of scope

Bulk drafting belongs to [Plan 4c](04c-variant-drafting.md), story types to [Plan 4b](04b-story-mining.md), and visual designs to the existing design catalogue.
