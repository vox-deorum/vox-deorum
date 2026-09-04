# Two-tier model defaults

> Split the global model default into two size aliases: `default` for reasoning-heavy work,
> `small` for reasoning-light work. `default` keeps exactly its current meaning and remains the one
> required `config.llms` entry; `small` is new and optional, falling back to `default`. No
> migration: every existing config already resolves correctly. Prerequisite for the
> [game setup wizard](session-wizard.md), which builds its model dropdown on this chain.

## Why

Every agent without an explicit `llms` entry lands on the one global `default`
([`getModelConfig`](../../vox-agents/src/utils/models/models.ts)), and both wizards inherit that
assumption. But the agent fleet is deliberately two-speed. The staffed strategist exists precisely
so cheap advisers summarize in parallel and one strong model decides; the briefers and librarian
already run at `reasoningTier: "low"`. With a single default, either the advisers burn a frontier
model on summarization or the strategist thinks with a small one. The "≈4× cost" label the game
wizard showed for the staffed style was a symptom of the same gap: with routine-model advisers,
staffed play costs roughly what simple play costs, plus cheap briefings.

## Design

### One new alias

`small` joins the reserved `config.llms` names beside `default`, `embedder`, and `summarizer`.
Each is an ordinary entry — a string alias or a literal definition.

- **`default`** — the main model: strategy decisions, negotiation, player-facing dialogue.
  Required, exactly as today.
- **`small`** — the routine model: summarization, report triage, keyword extraction, retrieval.
  Optional; when defined nowhere, small-size agents fall back to `default` — which is precisely
  what they do today, so a config without `small` changes nothing.

In player-facing copy these are the **main model** and the **routine model**; `default`/`small`
stay config vocabulary.

### Every agent declares its size

A new property on [`VoxAgent`](../../vox-agents/src/infra/vox-agent.ts), beside (and orthogonal to)
`reasoningTier`, which remains the *effort* applied within whatever model is chosen:

```ts
/** Which size alias this agent resolves to when it has no explicit llms entry. */
public modelSize: 'default' | 'small' = 'default';
```

The base value is `default` so an uncategorized future agent is never quietly downgraded; light
agents opt in to `small`. Set once on base classes where the whole family is light:

| Agent | Size | Why |
| --- | --- | --- |
| `simple-strategist`, `-briefed`, `-staffed`, `-learned` | default | the decision maker each style exists to serve |
| `negotiator` | default | deal terms need hard reasoning (already `reasoningTier: "high"`) |
| `diplomat` | default | the civilization's negotiating voice in player-facing dialogue |
| `talkative-telepathist` | default | multi-tool analysis over the telemetry record (base tier `high`) |
| `simple-briefer`, `specialized-briefer` (via `Briefer`) | small | summarize reports into briefings (already `low`) |
| `diplomatic-analyst` (via `Analyst`) | small | triages and relays diplomatic reports |
| `keyword-librarian` (via `Librarian`) | small | generates search keywords (already `low`) |
| `spokesperson` | small | recites known status with tact; no hard reasoning |
| `summarizer` | small | bulk historical summarization |
| `episode-retriever` | small | archive retrieval |
| `null-` / `none-` / `human-strategist` | — | programmatic, never call an LLM (the inherited flag is inert) |
| `oracle` | — | replays the model recorded in telemetry |

### Resolution order

A shared selector picks the *reference*; the existing `getModelConfig` then resolves it with its
recursive alias and model-ID logic, completely unchanged. Its parameter default, required-key
error, and unknown-reference fallback already point at `default`. Explicit agent assignments are
checked at both scopes before size aliases, which preserves existing configuration behavior. A
small agent only falls back to the main model after both `small` scopes are absent:

```
first defined key wins (small-size agent):
  1. seat llms:    agent name
  2. global llms:  agent name
  3. seat llms:    small
  4. global llms:  small
  5. fallback:     seat `default`, then global `default`

first defined key wins (default-size agent):
  1. seat llms:    agent name
  2. global llms:  agent name
  3. fallback:     seat `default`, then global `default`
```

```ts
getModelConfig(selectModelReference(this.name, this.modelSize, overrides), this.reasoningTier, overrides)
```

The explicit-override guarantees, stated as invariants:

1. **An explicit agent-name entry always beats a size alias**, at both scopes — research configs
   like [`2026-staff-standard.json`](../../vox-agents/configs/colm/2026-staff-standard.json), which
   pin `simple-briefer` and `simple-strategist-staffed` per seat, keep their exact models.
2. **A config without `small` resolves exactly as today.** The key keeps its meaning, the chain
   ends where it always ended, and no migration or rename is involved.
3. **A seat `default` does not capture small agents while `small` is configured anywhere.** The
   size lookup at both scopes precedes the fallback, so a wizard-pinned seat model drives the
   seat's strategist while its staffed advisers keep the global routine model. Pinning a whole
   seat to one model is explicit: `llms: { default: X, small: X }`.
4. **The wizards never rewrite explicit entries.** They only set the aliases and the model
   definitions they name.

`selectModelReference` lives in
[`resolution.ts`](../../vox-agents/src/utils/models/resolution.ts) and is re-exported by
`models.ts`, so runtime selection and preflight verification share one implementation and cannot
disagree on the selected reference (callers pass the agent's `modelSize` — the registry is not
imported there, to avoid the cycle documented in `resolve-negotiator.ts`). `ensureModelsResolved`
preflight additionally verifies the global and per-seat `small` values when defined, so a typo in
the alias fails before launch, not mid-game.

The `summarizer` lookups outside `VoxAgent.getModel` go through `summarizerModelReference` /
`summarizerModelName` in [`summarizer.ts`](../../vox-agents/src/telepathist/summarizer.ts) (used by
[`phase-preparation.ts`](../../vox-agents/src/telepathist/preparation/phase-preparation.ts),
[`turn-preparation.ts`](../../vox-agents/src/telepathist/preparation/turn-preparation.ts), and the
archivist prep preflight), which call the selector with the Summarizer's own size, so an explicit
`summarizer` entry still wins and an unset one falls `summarizer → small → default`.

A side effect worth keeping: because the selector picks a defined key before `getModelConfig` runs,
agent names without entries no longer take the "Unknown model configuration, falling back to
'default'" warning path.

### Rule-based size defaults per provider

A new table in [`rules.ts`](../../vox-agents/src/utils/models/rules.ts), beside `modelRules`,
matched against the *discovered* catalog (first match in catalog order wins):

| Provider | Main (`default`) | Routine (`small`) |
| --- | --- | --- |
| `codex` | first name matching `/terra/i` | first name matching `/luna/i` |
| `claude-code` | `sonnet` | `haiku` |
| `synthetic` | `syn:large:text` | `syn:small:text` |
| everything else | no rule — the player's pick serves both | |

`recommendTierModels(provider, models)` returns `{ default?, small? }` from the catalog; the
discovery route includes it in the response as `recommendedTiers`, so the recommendation is
computed server-side next to the other model rules and no credential logic moves. The synthetic
IDs are service-side aliases that should always be listed; the rule matches the catalog rather
than assuming, so if they are ever absent the provider simply degrades to no-rule behavior.
Model size and reasoning effort remain separate: every discovered GPT-5.6 model, including Luna,
is recommended with high reasoning effort by default.

### Model setup wizard

[`SetupWizard.vue`](../../vox-agents/ui/src/components/config/SetupWizard.vue) keeps its exact
four steps and its single model list — no second picker:

- The models step preselects the recommended main model when present, so codex, Claude Code, and
  Synthetic setups are Next-Next-Next. The player can still pick any other model as the main one.
- Saving writes the aliases and their definitions:

```json
"llms": {
  "codex/gpt-5.6-terra": { "provider": "codex", "name": "gpt-5.6-terra", "options": { … } },
  "codex/gpt-5.6-luna":  { "provider": "codex", "name": "gpt-5.6-luna", "options": { … } },
  "default": "codex/gpt-5.6-terra",
  "small": "codex/gpt-5.6-luna"
}
```

- With no rule (or no rule match), the wizard writes only `default` — exactly what it writes
  today.
- The existing curated-definition merge (`selectedModelDefinition`) applies to both written
  definitions.
- The confirm step names both: *Main AI: gpt-5.6-terra · Routine AI: gpt-5.6-luna (summaries and
  reports)*. Overriding the routine model is a Settings edit (`llms.small`), not a wizard step —
  the wizard stays one choice.

### Game setup wizard

Covered in [session-wizard.md](session-wizard.md): the step-3 model dropdown pins the resolved
`default` model as "My default", and an explicit choice writes `llms: { default: "<id>" }` per
agentic seat — so a staffed seat's advisers keep the global routine model, which is the point of
the style. The style options carry no cost multipliers.

## Implementation

| File | Change |
| --- | --- |
| [`src/infra/vox-agent.ts`](../../vox-agents/src/infra/vox-agent.ts) | `modelSize: 'default' \| 'small' = 'default'` beside `reasoningTier`; `getModel` resolves through `selectModelReference` |
| [`src/utils/models/models.ts`](../../vox-agents/src/utils/models/models.ts) | re-exports `selectModelReference`; `getModelConfig` untouched |
| [`src/utils/models/resolution.ts`](../../vox-agents/src/utils/models/resolution.ts) | `selectModelReference(name, size, overrides)` — the chain above, shared by runtime and preflight; `ensureModelsResolved` ids include defined `small` at both scopes |
| [`src/utils/models/rules.ts`](../../vox-agents/src/utils/models/rules.ts) | `tierRules` + `recommendTierModels(provider, models)` |
| [`src/web/routes/config.ts`](../../vox-agents/src/web/routes/config.ts) | discovery response gains `recommendedTiers` |
| [`src/types/api.ts`](../../vox-agents/src/types/api.ts) | `recommendedTiers?: { default?: string; small?: string }` on the discovery response |
| [`src/briefer/briefer.ts`](../../vox-agents/src/briefer/briefer.ts), [`src/analyst/analyst.ts`](../../vox-agents/src/analyst/analyst.ts), [`src/librarian/librarian.ts`](../../vox-agents/src/librarian/librarian.ts) | `modelSize = 'small'` on the base classes |
| [`src/envoy/agents/spokesperson.ts`](../../vox-agents/src/envoy/agents/spokesperson.ts), [`src/telepathist/summarizer.ts`](../../vox-agents/src/telepathist/summarizer.ts), [`src/telepathist/episode-retriever.ts`](../../vox-agents/src/telepathist/episode-retriever.ts) | `modelSize = 'small'` |
| [`src/telepathist/preparation/phase-preparation.ts`](../../vox-agents/src/telepathist/preparation/phase-preparation.ts), [`turn-preparation.ts`](../../vox-agents/src/telepathist/preparation/turn-preparation.ts) | summarizer model lookups use `summarizerModelName` from `summarizer.ts` |
| [`ui/src/components/config/SetupWizard.vue`](../../vox-agents/ui/src/components/config/SetupWizard.vue) | preselect the recommended main model; save `default` (+ `small` when recommended) as above; confirm copy names both |
| `ui/src/api/client.ts`, `ui/src/utils/types.ts` | `recommendedTiers` in the typed discovery response |

## Tests

- Selection chain: agent-name entries beat size aliases at both scopes; a small agent uses global
  `small` over a seat `default`, and falls back to seat then global `default` when `small` is
  defined nowhere; a default-size and a small-size agent in the same seat diverge correctly; a
  config without `small` resolves every agent exactly as before this change.
- `recommendTierModels`: codex, claude-code, and synthetic catalogs yield the expected pairs; an
  unknown provider or unmatched catalog yields none.
- Discovery route: `recommendedTiers` present exactly when a rule matches.
- `SetupWizard.test.ts`: rule providers preselect the main model and save both aliases; no-rule
  providers save only `default`; existing explicit `llms` entries survive a re-run untouched.
- Preflight: a dangling `small` alias fails `ensureModelsResolved`; defined ones verify.
- Summarizer label resolution: explicit `summarizer` entry wins; unset falls to `small`, then
  `default`.

## Open questions

1. **Judgment calls in the size table.** `spokesperson` as `small` and `diplomat` as `default` are
   the debatable rows — both are player-facing voices. Flip either with a one-line change.
2. **Synthetic alias IDs.** Confirm `syn:large:text` / `syn:small:text` actually appear in
   `https://api.synthetic.new/openai/v1/models`; the rule tolerates absence but the recommendation
   then vanishes for synthetic.
3. **Routine-model visibility.** The wizard shows the routine model only on the confirm step and
   offers no picker for it. If players ask for one, it belongs in Settings first.
