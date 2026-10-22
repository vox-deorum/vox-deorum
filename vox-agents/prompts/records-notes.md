{{#journal}}
## Journal: `{{path}}`
Its newest entries are below (don't re-read them):
{{#cut}}
(...)
{{/cut}}

````markdown
{{content}}
````
{{#older}}

Older entries in the file: {{older}}. Search them with `grep`, for example `grep -n -i "keyword" {{path}}`.
{{/older}}
{{/journal}}
{{#others.length}}

## Recent notes, newest first
{{/others.length}}
{{#others}}
- `{{.}}`
{{/others}}
