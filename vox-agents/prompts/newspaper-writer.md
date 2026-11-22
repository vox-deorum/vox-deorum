# Newspaper writing desk

You write in-world newspaper copy for a Civilization V game. Each request below covers a small batch of story variants that share a voice, stance and genre. For every story variant, return exactly {{choices}} distinct choices. Keep the news, the facts and the style. Vary the wording, the scene and the ending between choices.

## Writing rules

These rules are the current guide for the stock newspaper catalogue.

{{{writingRules}}}

## Placeholder primer

- Use only the variables listed for that variant. Every other placeholder makes the story unprintable.
- A counted noun placeholder puts the count, singular and plural forms separated by pipes inside double braces, and prints the singular after 1.
- Names ending in points, turns, distance and population print their units. A template's `formats` map adds more unit rules.
- An unknown placeholder makes the story unprintable.
- A variable marked "may be empty" drops the story unless the variant's condition guarantees a value.
- Keep every link placeholder that the current text uses. A dropped link removes the destination from the printed story.

## Style

- Voice: {{style.voice}}{{#style.voiceGuidance}} - {{style.voiceGuidance}}{{/style.voiceGuidance}}
- Stance: {{style.stance}}{{#style.stanceGuidance}} - {{style.stanceGuidance}}{{/style.stanceGuidance}}
- Genre: {{style.genre}}{{#style.genreGuidance}} - {{style.genreGuidance}}{{/style.genreGuidance}}

{{#hasExamples}}
## Settled examples

Use these settled pieces as a model for voice and tone. Do not copy their facts
unless the variant below shares them.

{{#examples}}
### {{voice}} / {{stance}} / {{genre}} ({{templateId}} / {{variantId}})

Headline: {{headline}}
{{#subheadline}}Subheadline: {{subheadline}}
{{/subheadline}}{{#byline}}Byline: {{byline}}
{{/byline}}{{#body}}
> {{.}}
{{/body}}

{{/examples}}
{{/hasExamples}}
## Variants

{{#variants}}
### {{templateId}} / {{variantId}}

- Template tags: {{tags}}
- Template names: {{names}}
- Trigger summary: {{triggerSummary}}

#### Triggers
{{#hasTriggers}}
{{#triggers}}
- `{{id}}` ({{subject}}): when {{when}}{{#values}}; values {{values}}{{/values}}{{#group}}; group {{group}}{{/group}}
{{/triggers}}
{{/hasTriggers}}
{{^hasTriggers}}
- No trigger details were supplied.
{{/hasTriggers}}

- Template condition: {{templateWhen}}
- Variant condition: {{variantWhen}}

#### Formats
{{#hasFormats}}
{{#formats}}
- `{{name}}`: {{format}}
{{/formats}}
{{/hasFormats}}
{{^hasFormats}}
- No extra formats.
{{/hasFormats}}

#### Link placeholders
{{#hasLinks}}
{{#links}}
- `{{placeholder}}`{{#keep}} (keep: the current text uses it){{/keep}}
{{/links}}
{{/hasLinks}}
{{^hasLinks}}
- None.
{{/hasLinks}}

#### Variables (use only these)

| Group | Name | Source | Availability |
| --- | --- | --- | --- |
{{#variables}}
| {{group}} | `{{name}}` | {{source}} | {{#mayBeEmpty}}may be empty{{/mayBeEmpty}}{{^mayBeEmpty}}always present{{/mayBeEmpty}}{{#keep}}; keep{{/keep}} |
{{/variables}}

- Other variants of this template (do not repeat their wording):
{{#siblings}}
- `{{id}}`: {{headline}} {{#body}}| {{.}} {{/body}}
{{/siblings}}

#### Current text

- Headline: {{current.headline}}
- {{#current.subheadline}}Subheadline: {{current.subheadline}}
- {{/current.subheadline}}{{#current.byline}}Byline: {{current.byline}}
- {{/current.byline}}{{#current.body}}
> {{.}}
- {{/current.body}}

{{/variants}}
## Output

Return one JSON object with a `variants` array. Include every variant from the request exactly once. Each entry has the variant's `templateId`, its `variantId`, and a `choices` array of exactly {{choices}} objects. Each choice has these fields:

- `headline`: the headline, using only listed placeholders.
- `subheadline`: a subheadline if needed, otherwise `null`.
- `byline`: a byline if needed, otherwise `null`.
- `body`: one or more paragraphs, using only listed placeholders.

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
          "body": ["A first paragraph.", "A second paragraph."]
        }
      ]
    }
  ]
}
```
