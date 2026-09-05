# FLAVOR_USE_NUKE

## Overview

`FLAVOR_USE_NUKE` is an AI personality flavor that controls how willing a civilization's leader is to use nuclear weapons during warfare. This flavor affects both the probability of launching nuclear strikes and how other civilizations perceive the nuclear threat posed by a leader.

Unlike `FLAVOR_NUKE` (which influences the production and acquisition of nuclear weapons), `FLAVOR_USE_NUKE` specifically controls the **willingness to actually deploy** those weapons in combat situations.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Conquerors: 9 (very aggressive nuclear users)
  - Coalitionists: 3 (defensive, reluctant to use nukes)
  - Diplomats: 4 (moderate restraint)
  - Expansionists: 4 (moderate restraint)

### Notable Leader Overrides

Some leaders have custom FLAVOR_USE_NUKE values that override their personality archetype defaults:

- **Genghis Khan:** 10 (maximum nuclear aggression)
- **Catherine:** 7 (more willing than typical expansionists)
- **Wu Zetian:** 7 (more willing than typical expansionists)
- **Suleiman:** 7 (more willing than typical expansionists)
- **Isabella:** 5 (slightly more cautious than other expansionists)

## Code References

### 1. Nuclear Strike Decision Logic (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 2226-2287)

**Function:** `CvMilitaryAI::DoNuke(PlayerTypes ePlayer)`

This function determines whether the AI will launch a nuclear attack against a specific opponent during wartime.

#### Automatic Nuclear Launch Conditions

Nuclear weapons will be launched **automatically** (bypassing flavor checks) in these situations:

- The AI is nearly defeated in war (`WAR_STATE_NEARLY_DEFEATED`)
- The enemy has immense military strength advantage (`STRENGTH_IMMENSE`)
- Nukes have already been exchanged between the civilizations

#### Probabilistic Nuclear Launch

When automatic conditions aren't met, the AI performs a **random roll against FLAVOR_USE_NUKE**:

```cpp
int iFlavorNuke = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_USE_NUKE"));
int iRoll = GC.getGame().randRangeExclusive(0, 10, ...);
if (iRoll <= iFlavorNuke)
{
    bLaunchNuke = true;
}
```

The roll occurs when any of these conditions are met:

- Enemy has powerful military strength OR AI is troubled in war
- Enemy has opinion rating of Enemy or worse
- AI is pursuing world conquest victory
- Enemy is close to any victory condition

**Interpretation:** With FLAVOR_USE_NUKE = 9, there's a 90% chance per turn of nuclear launch when conditions are met. With FLAVOR_USE_NUKE = 3, only a 30% chance.

### 2. Nuclear Threat Assessment (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 19589-19647)

**Function:** Diplomatic approach calculation (within major approach evaluation)

This code calculates how likely an opponent is to use nuclear weapons, which influences diplomatic relations and approach decisions.

#### Threat Level Calculation

```cpp
int iFlavorNuke = GET_PLAYER(ePlayer).GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_USE_NUKE"));
iHowLikelyAreTheyToNukeUs = iFlavorNuke * 10;
```

**Interpretation:** FLAVOR_USE_NUKE is converted to a percentage likelihood:

- FLAVOR_USE_NUKE = 9 → 90% likelihood they will use nukes
- FLAVOR_USE_NUKE = 3 → 30% likelihood they will use nukes
- FLAVOR_USE_NUKE = 10 → 100% likelihood (treated as certain)

#### Automatic 100% Threat Conditions

The threat assessment is automatically set to 100% when:

- Nukes have already been used by either civilization
- The opponent is nearly defeated or has immense military disadvantage (desperation scenario)

#### Impact on Diplomatic Approach

**When enemy has nukes and you don't** (`iHowLikelyAreTheyToNukeUs >= 60`):

- Increases AFRAID approach scores (become fearful of nuclear-armed opponent)

**When both civilizations have nukes** (`iHowLikelyAreTheyToNukeUs >= 30`):

- Increases GUARDED approach scores (mutual nuclear deterrence - "cold war" scenario)

**When you have nukes and they don't:**

- Increases WAR and HOSTILE approach scores if you want opportunistic attacks
- Creates aggressive posture from nuclear superiority

**After being nuked:**

- Dramatically increases WAR, HOSTILE, GUARDED, and AFRAID approaches
- Effect scales with number of times nuked (up to 10 maximum)

### 3. Policy Preference Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4988-4990)

**Function:** `CvPolicyAI::WeighPolicy(CvPlayer* pPlayer, PolicyTypes ePolicy)`

When evaluating social policies to adopt, the AI considers policy flavors and maps them to strategic interests.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_USE_NUKE" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NUKE")
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:** Policies that have FLAVOR_USE_NUKE values contribute to the policy's perceived value for **Conquest victory strategy**. Leaders with high FLAVOR_USE_NUKE will value policies that support aggressive military conquest more highly, as nuclear weapons are seen as tools for domination.

This links nuclear willingness directly to the AI's grand strategy preference for conquest over diplomatic, cultural, or scientific victories.

## Summary of Effects

### Nuclear Warfare Decisions

- **Direct probability multiplier** for nuclear strike authorization during war
- Creates a per-turn percentage chance (flavor × 10%) of launching nukes when strategic conditions are met
- Does not prevent automatic nuclear use in desperation scenarios
- Influences whether the AI will escalate to nuclear warfare before reaching defeat

### Opponent Threat Assessment

- **Enemy threat estimation** - how likely others perceive this leader to use nukes
- Affects whether opponents adopt AFRAID or GUARDED diplomatic approaches
- Creates "mutually assured destruction" dynamics when both sides have nukes and high use flavors
- Influences whether opponents will risk war against a nuclear-armed leader

### Strategic Policy Preferences

- Leaders with high FLAVOR_USE_NUKE value policies supporting **conquest victory**
- Reinforces aggressive grand strategy alignment
- Nuclear weapons viewed as instruments of domination rather than pure deterrence

## Design Philosophy

FLAVOR_USE_NUKE distinguishes between:

1. **Nuclear capability** (how many nukes to build - controlled by FLAVOR_NUKE)
2. **Nuclear doctrine** (willingness to use what you've built - controlled by FLAVOR_USE_NUKE)

This allows for differentiated AI personalities:

- **High NUKE, Low USE_NUKE:** Defensive deterrence (build arsenal, rarely use)
- **High NUKE, High USE_NUKE:** Aggressive nuclear power (build and willing to first strike)
- **Low NUKE, High USE_NUKE:** Opportunistic user (won't prioritize building many, but will use what's available)
- **Low NUKE, Low USE_NUKE:** Nuclear pacifist (minimal interest in nuclear warfare)

## Related Flavors

- **FLAVOR_NUKE:** Controls production priority and quantity of nuclear weapons
- **FLAVOR_OFFENSE:** General aggressive military behavior
- **FLAVOR_MILITARY_TRAINING:** Investment in military units overall

Both FLAVOR_USE_NUKE and FLAVOR_NUKE typically have similar values for most leaders to maintain personality consistency, but can diverge for nuanced behavior.
