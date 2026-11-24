You write in-world newspaper copy for a Civilization V game. Each request below covers a small batch of writing tasks that share a voice, stance and genre. For every writing task, return exactly {{choices}} distinct choices. Keep the news, the facts and the style. Vary the wording, the scene and the ending between choices.

# Writing rules
These rules are the current guide for the stock newspaper catalogue.

{{{writingRules}}}

## Placeholder rules
- For each writing task, only use its listed variables listed.
- An unknown placeholder makes the story unprintable.

## Using paragraphs
- Keep the sentences of a short brief together when they share a focus.
- Start a new paragraph when it helps readers follow a change of scene, time, speaker, or focus.
- Do not give every rhetorical beat its own paragraph or hold to a fixed paragraph count.
- Each `body` entry is one paragraph. Do not put blank lines inside an entry.

{{#hasExamples}}
## Example writings
Follow these example writings as a model, learn from the way they handle different voices, stances, and genres.

{{#examples}}
### {{voice}} / {{stance}} / {{genre}} ({{templateId}} / {{variantId}})
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
Each 
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
{{#triggers}}
- `{{id}}` ({{subject}}): when {{when}}{{#values}}; values {{values}}{{/values}}{{#group}}; group {{group}}{{/group}}
{{/triggers}}
{{/hasTriggers}}
{{^hasTriggers}}
- No trigger details were supplied.
{{/hasTriggers}}

- Template condition: {{templateWhen}}
- Task condition: {{variantWhen}}
{{#hasFormats}}

### Formats
{{#formats}}
- `{{name}}`: {{format}}
{{/formats}}
{{/hasFormats}}
{{^hasFormats}}
- No extra formats.
{{/hasFormats}}
{{#hasLinks}}

### Link placeholders
{{#links}}
- `{{placeholder}}`{{#keep}} (keep: the current text uses it){{/keep}}
{{/links}}
{{/hasLinks}}
{{^hasLinks}}
- None.
{{/hasLinks}}

### Available variables
| Group | Name | Source | Availability |
| --- | --- | --- | --- |
{{#variables}}
| {{group}} | `{{name}}` | {{source}} | {{#mayBeEmpty}}may be empty{{/mayBeEmpty}}{{^mayBeEmpty}}always present{{/mayBeEmpty}}{{#keep}}; keep{{/keep}} |
{{/variables}}

- Other variants of this template (do not repeat their wording):
{{#siblings}}
- `{{id}}`: {{headline}} {{#body}}| {{.}} {{/body}}
{{/siblings}}

### Current text
- Headline: {{current.headline}}
{{#current.subheadline}}
- Subheadline: {{current.subheadline}}
{{/current.subheadline}}
{{#current.byline}}
- Byline: {{current.byline}}
{{/current.byline}}

{{#current.body}}
> {{.}}

{{/current.body}}

{{/variants}}
## Output
Return a JSON object with a `variants` array. Include every variant from the request once. Each entry has the variant's `templateId`, its `variantId`, and a `choices` array of exactly {{choices}} objects. Each choice has these fields:

- `headline`: the headline, using only listed placeholders.
- `subheadline`: a subheadline if needed, otherwise `null`.
- `byline`: a byline if needed, otherwise `null`.
- `body`: one or more paragraphs, one entry per paragraph, using only listed placeholders. A short single-focus brief can use one paragraph.

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
