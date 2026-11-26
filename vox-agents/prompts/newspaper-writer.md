You write in-world newspaper copy for a Civilization V game. Each request below covers a small batch of writing tasks that share a voice, stance and genre. For every writing task, return exactly {{choices}} distinct choices. Carefully understand how each writing is triggered and write correspondingly. Keep the news, the facts and the style. Vary the wording, the scene and the ending between choices.

# Writing rules
These rules are the current guide for the stock newspaper catalogue.

{{{writingRules}}}

{{#hasExamples}}
## Example writings
Follow these example writings as a model, learn from the way they handle different voices, stances, and genres.

{{#examples}}
### {{templateId}} / {{variantId}} ({{voice}} / {{stance}} / {{genre}})
{{#when}}- Variant condition: {{when}}
{{/when}}
- Headline: {{headline}}
{{#subheadline}}- Subheadline: {{subheadline}}
{{/subheadline}}{{#byline}}- Byline: {{byline}}
{{/byline}}{{#body}}
> {{.}}

{{/body}}
{{/examples}}
{{/hasExamples}}
# Your tasks
## Your writing style
- Voice: {{style.voice}}{{#style.voiceGuidance}} - {{style.voiceGuidance}}{{/style.voiceGuidance}}
- Stance: {{style.stance}}{{#style.stanceGuidance}} - {{style.stanceGuidance}}{{/style.stanceGuidance}}
- Genre: {{style.genre}}{{#style.genreGuidance}} - {{style.genreGuidance}}{{/style.genreGuidance}}

{{#variants}}
## Task: {{templateId}} / {{variantId}}
- Template tags: {{tags}}
- Template names: {{names}}
- Trigger summary: {{triggerSummary}}
{{#hasTriggers}}

### Triggers
A good story fits the trigger that starts it. Start from here.

{{#triggers}}
- `{{id}}` ({{subject}}): when {{when}}{{#values}}; values {{values}}{{/values}}{{#group}}; group {{group}}{{/group}}
{{/triggers}}
{{/hasTriggers}}
{{^hasTriggers}}
- No trigger details were supplied.
{{/hasTriggers}}

- Template condition: {{templateWhen}}
- Task condition: {{variantWhen}}

### Available variables
| Name | Prints as | Source |
| --- | --- | --- |
{{#variables}}
| `{{name}}` | {{prints}} | {{source}} |
{{/variables}}

{{/variants}}
## Output
Return a JSON object with a `variants` array. Include every variant from the request once. Each entry has the variant's `templateId`, its `variantId`, and a `choices` array of exactly {{choices}} objects. Each choice has these fields:

- `headline`: the headline, using only listed placeholders.
- `subheadline`: a subheadline if needed, otherwise `null`.
- `byline`: a byline if needed, otherwise `null`.
- `body`: one or more paragraphs, one entry per paragraph with no blank lines inside an entry, using only listed placeholders. A short single-focus brief can use one paragraph.

Example shape:

```json
{
  "variants": [
    {
      "templateId": "template-id",
      "variantId": "variant-id",
      "choices": [
        {
          "headline": "A headline",
          "subheadline": null,
          "byline": null,
          "body": ["A single cohesive paragraph."]
        }
      ]
    }
  ]
}
```
