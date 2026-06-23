// PurgeCSS configuration for cleaning dead CSS out of the UI *source*.
//
// Targets our own source styles only:
//   - src/styles/*.css          (shared stylesheets, @import-ed by components)
//   - <style> blocks in .vue     (inline component rules; @import lines ignored)
// primeflex / primevue / primeicons (node_modules) are intentionally NOT touched.
//
// Content = the whole app source. A selector used by ANY component is kept, so
// this only flags rules that NO component references (= truly dead). That's the
// safe, conservative scope for editing source files.
//
// Driven by purgecss.run.mjs (the CLI can't load an absolute Windows config path).
module.exports = {
  content: ['./index.html', './src/**/*.vue', './src/**/*.ts'],

  // The CSS sources cleaned by the runner.
  cssGlobs: ['./src/styles/*.css'],

  // Classes that are real but never appear literally in our templates, so the
  // static scanner can't see them. Without these the report produces false
  // positives:
  //   p-* / pi-*  PrimeVue + primeicons render these at runtime.
  //   msg-*       built dynamically, e.g. :class="`msg msg-${role}`".
  //   vjs-*       vue-json-pretty's runtime classes (targeted via :deep).
  //   h5 / h6     emitted by marked()-rendered markdown injected with v-html.
  safelist: {
    standard: [/^p-/, /^pi-/, /^pi$/, /^msg-/, /^vjs-/, 'h5', 'h6', 'html', 'body'],
    deep: [/^p-/, /^pi-/, /^vjs-/],
    greedy: [/^p-/],
  },
}
