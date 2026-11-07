# Unit AI: Operation Stages

**Operation stages** record a persistent operation's progress from setup to finish or abort. This guide follows the state sequences for standard military operations, escorted civilians, nuclear attacks, and carrier groups. [Military organization](organization.md) explains formation membership and recruitment; [operation lifecycle](lifecycle.md) explains shared completion, abort, and handoff rules. See the [operations overview](overview.md) for campaign targets and civilian mission behavior.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvAIOperation.cpp`, `CvArmyAI.cpp`, `CvTacticalAI.cpp`, `CvMilitaryAI.cpp`, `CvHomelandAI.cpp`, and `CvUnit.cpp`.

## Lifecycle overview

An **operation stage** records campaign progress. The army carries a matching movement state: waiting for reinforcements, gathering, moving, or at the destination. An **initial reserve scan** runs once when the army is created. **Recruiting** repeats the reserve scan each operation turn. **Direct assignments and replacements**, such as the initial civilian or a replacement escort, do not depend on Recruiting.

### Standard military operations

Land, naval, combined, pillage, defense, rapid-response, and naval-superiority operations use the same stage sequence.

```mermaid
flowchart LR
    S[Set target,<br/>muster, and army goal] --> Q{Required slots<br/>open?}
    Q -->|yes| R[Recruiting<br/>initial reserve scan, then reserve scan each turn]
    Q -->|no| M0[Moving<br/>initial reserve scan once for optional slots]
    R -->|enough formation strength| G[Gathering<br/>assemble at muster]
    G -->|all members within tolerance| M[Moving<br/>advance toward army goal]
    M0 --> D{Deployment<br/>condition met?}
    M --> D
    D -->|yes| F[Finished]
    D -->|no| M
    R -->|abort| A[Aborted]
    G -->|abort| A
    M0 -->|abort| A
    M -->|abort| A
    F --> L[Release members]
    A --> L
```

Recruiting ends when the formation has enough strength, even if required slots remain open. Gathering ends when every member is within the operation's muster tolerance. Standard military operations finish at deployment range. They do not use the operation's At Target stage.

### Escorted civilian operations

Civilian operations assign their civilian before setup. They use an At Target stage because arriving and performing the civilian mission can be separate events.

```mermaid
flowchart LR
    I[Assign civilian<br/>to slot 0] --> S[Set target and muster;<br/>run initial escort reserve scan]
    S -->|escort still needed| R[Recruiting escorts<br/>reserve scan each turn]
    S -->|no required escort| M[Moving]
    R -->|enough strength,<br/>or target reachable this turn| G[Gathering]
    G -->|formation close to civilian| M
    M -->|civilian reaches target| T[At Target<br/>try mission]
    T -->|mission not ready| T
    T -->|mission succeeds| F[Finished]
    M -. acquire or replace escort .-> M
    R -->|abort| A[Aborted]
    G -->|abort| A
    M -->|abort| A
    T -->|abort| A
    F --> L[Release members]
    A --> L
```

While Moving, an unescorted civilian can acquire a suitable defender on its route, and a blocked escort can be replaced. These direct assignments do not return the operation to Recruiting.

### Nuclear attacks

Nuclear attacks use a specialized setup path and skip Gathering, Moving, and At Target.

```mermaid
flowchart LR
    S[Choose target and<br/>nuclear-unit muster plot] --> R[Specialized setup assignment<br/>unassigned nuclear unit on muster plot]
    R -->|unit can move and strike| N[Fire nuclear mission]
    N --> F[Finished]
    R -->|launch unavailable during setup| A[End without firing<br/>on next operation pass]
    F --> L[Release member]
    A --> L
```

The normal path recruits and fires during setup. Nuclear armies have no ordinary movement phase, so an operation that cannot launch does not wait and retry through Gathering or Moving.

### Carrier groups

Carrier groups use the standard Recruiting and Gathering transitions, but remain in Moving while they patrol and retarget.

```mermaid
flowchart LR
    C[Assign carrier<br/>to slot 0] --> R[Recruiting escorts<br/>initial reserve scan, then reserve scan each turn]
    R -->|enough formation strength| G[Gathering]
    G -->|within muster tolerance| M[Moving and patrolling]
    M -->|retarget| M
    R -->|abort| A[Aborted]
    G -->|abort| A
    M -->|abort or carrier lost| A
    A --> L[Release members]
```

Carrier groups have no successful Finished transition. They remain in Moving until an abort or carrier loss releases the formation. Carried aircraft are not formation members and rebase independently.

[Operation completion, abort, and cleanup](lifecycle.md#completion-abort-and-cleanup) defines the terminal checks shared by these lifecycles and summarizes each family's finish and abort conditions.
