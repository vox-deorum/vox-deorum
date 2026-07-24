# Updating the Codex proxy

This guide is for developers updating the managed `codex-openai-proxy` release used by vox-agents. Vox Deorum launches an exact version through `npx` on the first Codex request. The proxy is not a workspace dependency, so an update changes the source pin and its version-specific tests and documentation without running `npm install`.

The current pin is `codex-openai-proxy@0.1.0-rc.5`, which bundles `@openai/codex@0.145.0`.

## Check the release

Inspect the npm dist-tags and publication history before choosing a version:

```bash
npm view codex-openai-proxy dist-tags time --json
npm view codex-openai-proxy@<version> version dependencies --json
```

Do not assume the `latest` tag identifies the newest prerelease. Check tags such as `next`, then query the exact candidate to confirm its bundled `@openai/codex` version.

Review the candidate's release notes and command help for changes to:

- the `serve` arguments and duration syntax;
- the `/health` and `/ready` responses;
- request policy fields such as sandbox, web search, and tool choice;
- streamed `tool_calls`, `tool_results`, errors, and diagnostic records.

These are integration contracts. A compatible dependency update needs only the version edits below. A contract change also needs adapter code and captured response fixtures updated in the same change.

## Update the repository

1. Change `codexProxyVersion` in `vox-agents/src/utils/models/providers/codex-proxy.ts`.
2. Update the exact default-command assertion in `vox-agents/tests/mock/utils/providers/codex-proxy.test.ts`.
3. If the activity contract changed, update `codex.ts`, `codex-response.ts`, and their tests under `vox-agents/tests/mock/utils/providers/`.
4. Update the pinned proxy and bundled Codex CLI versions in the player configuration and troubleshooting guides.
5. Update version-specific descriptions in the vox-agents developer overview and source comments.
6. Search for the old release to catch remaining operational references:

```bash
rg "codex-openai-proxy@|Codex rc\.|Proxy rc\.|proxy.*rc\." vox-agents docs
```

Implementation plans record the contract used when a feature was designed. Leave those historical version references intact unless the plan is still active and the update changes its intended implementation.

## Verify the update

Run the focused proxy and response-adapter tests from the repository root:

```bash
npm run test --workspace=vox-agents -- tests/mock/utils/providers/codex-proxy.test.ts tests/mock/utils/providers/codex.test.ts
npm run type-check --workspace=vox-agents
```

For a contract-changing release, add focused fixtures for every changed request or response shape. Then start the exact package in the foreground with the command from the player troubleshooting guide. Confirm readiness, authentication, a normal Codex response, provider-executed tool activity, cancellation, and clean shutdown before merging.
