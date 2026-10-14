## Latest note: `{{latest.path}}`
Its current text is below (don't re-read the file):

````markdown
{{latest.content}}
````
{{#earlier.length}}

Earlier notes, newest first:
{{/earlier.length}}
{{#earlier}}
- `{{.}}`
{{/earlier}}
