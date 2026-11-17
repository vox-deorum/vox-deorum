# Diplomacy triggers

Diplomacy stories report first contact and structured deals with other players. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/diplomacy.json`; authored variants are in `vox-agents/newspaper/templates/diplomacy.json`. Detection lives in `vox-agents/src/newspaper/editorial/event-developments.ts`, with shared relationship parsing in `mcp-server/src/diplomacy/relationships.ts` and deal visibility in `mcp-server/src/newspaper/projection.ts`.

Both shipped triggers use `threshold: 1`. Their supported tuning fields are listed below.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `first-contact`, `firstContact` | `TeamMeet` involves the receiver's team and an identifiable other team. Repeated representations of that team's meeting share one report. | 1; 1 |
| `deal`, `deal` | A receiver deal has permitted structured terms naming a consequential treaty or material gold transfer. Gold needs `absolute: 50` and `relative: 0.25` of treasury; gold per turn needs `reserve: 10` and the same fraction of absolute income. Economic comparisons need a national observation no more than `maxGap: 5` Standard turns before the event. | Number of qualifying structured terms; 4 |

## Evidence and repeats

Consequential treaty types are `OpenBorders`, `DefensivePact`, `ResearchAgreement`, `DeclarationOfFriendship`, `Vassalage`, and `VassalageRevoke`. One deal can contain both treaty and economic terms. Each source deal is assessed separately; deals with the same partner compete within one exchange series.

Unavailable private terms suppress this detector; the presence of a `DealMade` event alone is insufficient. MCP's [deal-term visibility rules](../replay.md#source-and-http-ownership) remain the authority.

## Placeholders

| Family  | Useful factual placeholders               |
| ------- | ----------------------------------------- |
| Contact | `partners`, `eventTurn`.                  |
| Deal    | `terms`, `significantTerms`, `eventTurn`. |
