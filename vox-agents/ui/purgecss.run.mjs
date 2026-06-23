// Runner for PurgeCSS over the UI *source* (see purgecss.config.cjs).
//
// Two modes:
//   node ./purgecss.run.mjs          -> REPORT only. Lists removable selectors
//                                       per source file. Touches nothing.
//   node ./purgecss.run.mjs --apply  -> Rewrites src/styles/*.css and the
//                                       affected .vue <style> blocks in place.
//
// The CLI can't load an absolute Windows config path, so we drive the API here.
import { createRequire } from 'node:module'
import { readFile, writeFile, glob } from 'node:fs/promises'
import { PurgeCSS } from 'purgecss'

const require = createRequire(import.meta.url)
const config = require('./purgecss.config.cjs')
const APPLY = process.argv.includes('--apply')

// Resolve content + css file lists.
const expand = async (patterns) => {
  const out = []
  for (const p of patterns) for await (const f of glob(p)) out.push(f)
  return out
}
const content = await expand(config.content)
const cssFiles = await expand(config.cssGlobs)
const vueFiles = (await expand(['./src/**/*.vue']))

// Pull the inner CSS out of a .vue <style> block, dropping @import lines (the
// imported shared files are cleaned on their own).
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/i
function extractVueStyle(src) {
  const m = src.match(STYLE_RE)
  if (!m) return null
  const inner = m[1]
  const body = inner.replace(/^\s*@import[^;]*;\s*$/gim, '').trim()
  return { whole: m[0], inner, body }
}

// Build the CSS targets: shared stylesheets + substantive .vue inline blocks.
const targets = []
for (const file of cssFiles) targets.push({ kind: 'css', file, raw: await readFile(file, 'utf8') })
for (const file of vueFiles) {
  const src = await readFile(file, 'utf8')
  const ex = extractVueStyle(src)
  if (ex && ex.body) targets.push({ kind: 'vue', file, raw: ex.body, src, ex })
}

const purge = new PurgeCSS()
let totalRemoved = 0
const edits = []

for (const t of targets) {
  const [res] = await purge.purge({
    content,
    css: [{ raw: t.raw, name: t.file }],
    safelist: config.safelist,
    rejected: true,
  })
  // Never report :deep()/:slotted()/::v-deep selectors: their inner targets
  // live in child or library components and aren't in the static content, so
  // the scanner can't judge them. (Their non-deep prefix being unused is the
  // real signal — handle those by hand if you want them gone.)
  const removed = (res.rejected ?? []).filter(
    (sel) => !/:deep\(|:slotted\(|::v-deep|>>>|\/deep\//.test(sel),
  )
  if (removed.length === 0) continue
  totalRemoved += removed.length
  const before = Buffer.byteLength(t.raw)
  const after = Buffer.byteLength(res.css)
  console.log(`\n${t.file}  (${t.kind})`)
  console.log(`  ${before} -> ${after} bytes, ${removed.length} selector(s) removable:`)
  for (const sel of removed) console.log(`    - ${sel}`)
  edits.push({ ...t, purged: res.css })
}

console.log(`\n${'='.repeat(60)}`)
console.log(`${edits.length} file(s) with dead CSS, ${totalRemoved} removable selector(s) total.`)

if (!APPLY) {
  console.log('\nReport only — no files changed. Re-run with --apply to rewrite source.')
} else {
  for (const e of edits) {
    if (e.kind === 'css') {
      await writeFile(e.file, e.purged)
    } else {
      // Splice the purged rules back into the <style> block, keeping its
      // @import lines (which we excluded from purging) intact.
      const imports = (e.ex.inner.match(/^\s*@import[^;]*;\s*$/gim) || []).join('\n')
      const newInner = `${imports ? imports + '\n' : ''}${e.purged}`.replace(/^\n+/, '')
      const open = e.ex.whole.match(/<style\b[^>]*>/i)[0]
      const newBlock = `${open}\n${newInner}\n</style>`
      await writeFile(e.file, e.src.replace(e.ex.whole, newBlock))
    }
    console.log(`  rewrote ${e.file}`)
  }
  console.log('\nApplied. Review with `git diff` and rebuild to verify.')
}
