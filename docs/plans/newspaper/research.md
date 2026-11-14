# Newspaper research

Research supporting [the feature specification](spec.md), checked against the repository and local recordings on 13 November 2026. The findings are split into three parts. Each distinguishes existing behavior, proposed newspaper behavior, and questions that need a prototype.

| Part | Main finding |
| --- | --- |
| [UI and runtime images](research-ui.md) | The existing Lua/XML UI can support articles, archives, votes, and simple charts. Changing an existing texture during play is supported. Loading a newly generated image file during play remains unverified. |
| [MCP stored data and recorded games](research-data.md) | Local stores already contain long histories suitable for offline evaluation. They hold change records and some live-query snapshots, with gaps in lifecycle, observation timing, and structured identifiers. |
| [Visibility and foreign reporting](research-visibility.md) | Stored visibility and live tool filtering provide useful precedents. The spec's trade and graded espionage reporting require an explicit newspaper policy and additional provenance. |

The strongest starting material is domestic city comparisons, the receiving civilization's trade relationships, and cultural or diplomatic developments among civilizations it has met. A sampled French campaign contains a useful trade series: Morocco's share of France's positive outgoing-route gold rises from about 70% at turn 225 to 83% at turn 250, then falls to 49% at turn 275. This is a share of route income, with the calculation and limitations explained in the data research.

The next design should settle the reporting cutoff and permitted evidence before choosing triggers. Offline replay needs to preserve articles, series, votes, preferences, and each issue's chosen presentation. The [offline evaluation checklist](research-data.md) identifies the remaining demonstrations, including a series returning after fading, a merged installment, continuity across editor modes, and generation failure. Live scheduling, save restoration, and the in-game reader follow that evaluation, as specified in the feature document.

This research changes documentation only. It does not implement the newspaper or claim that runtime image loading, save restoration, or foreign reporting has been tested in the game.
