# FLAVOR_AIR_CARRIER

## Overview

FLAVOR_AIR_CARRIER is an AI flavor that controls the AI's desire to build and maintain aircraft carriers in Civilization V. This flavor influences how the AI prioritizes carrier production, carrier-related technologies, and naval aviation strategies. Unlike FLAVOR_AIR which focuses on air units themselves, FLAVOR_AIR_CARRIER specifically governs the production of carrier vessels that serve as mobile air bases.

## Code References

### Military Strategy Triggers

**File**: `CvGameCoreDLL_Expansion2\CvMilitaryAI.cpp`

**Function**: `IsTestStrategy_NeedAirCarriers` (lines 4056-4060)

```cpp
bool MilitaryAIHelpers::IsTestStrategy_NeedAirCarriers(CvPlayer* pPlayer)
{
    return pPlayer->GetMilitaryAI()->HasAirforce() &&
           pPlayer->GetMilitaryAI()->GetNumFreeCarrier() == 0;
}
```

This function determines when the AI should trigger the "NEED_AIR_CARRIER" military strategy. The strategy activates when:

- The player has an active air force (air units like fighters and bombers)
- The player has no free carrier capacity remaining

### Strategy Flavor Modifiers

**File**: `(1) Community Patch\Database Changes\AI\CoreStrategyChanges.sql` (line 277)

```sql
('MILITARYAISTRATEGY_NEED_AIR_CARRIER', 'FLAVOR_AIR_CARRIER', 20)
```

When the "NEED_AIR_CARRIER" military strategy is active, the AI receives a +20 bonus to its FLAVOR_AIR_CARRIER value. This temporarily increases the AI's desire to build carriers when it needs them.

### Policy AI Integration

**File**: `CvGameCoreDLL_Expansion2\CvPolicyAI.cpp` (line 4920)

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIR" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_ANTIAIR" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIR_CARRIER" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIRLIFT" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_BOMBER" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_FIGHTER")
{
    iConquestValue += iFlavorValue;
}
```

FLAVOR_AIR_CARRIER is grouped with other air-related flavors when calculating the value of conquest-oriented policies and strategies. This means carrier-focused leaders will also value policies that support military conquest.

### Unit Flavor Values

**File**: `(2) Vox Populi\Database Changes\AI\UnitFlavorSweeps.sql` (lines 765-770)

```sql
-- Carrier
('UNIT_CARRIER', 'FLAVOR_AIR_CARRIER', 40),

-- Supercarrier
('UNIT_SUPERCARRIER', 'FLAVOR_AIR_CARRIER', 60),
('UNIT_SUPERCARRIER', 'FLAVOR_NAVAL_RECON', 40),
```

These values define how strongly each carrier unit type appeals to the AI based on its FLAVOR_AIR_CARRIER:

- **UNIT_CARRIER**: Has a flavor value of 40
- **UNIT_SUPERCARRIER**: Has a flavor value of 60 (stronger appeal)

The higher the AI's FLAVOR_AIR_CARRIER value, the more it prioritizes building these units.

### Technology Flavor Values

**File**: `(2) Vox Populi\Database Changes\AI\TechFlavorSweeps.sql` (line 374)

```sql
('TECH_COMPUTERS', 'FLAVOR_AIR_CARRIER', 10), -- Units: SpecForces, Carrier, Buildings: NationalIntelligence, Wonders: Bletchley, Ability: +1 TR, Yield: Artists +1C
```

The Computers technology has a FLAVOR_AIR_CARRIER value of 10, which means AIs with high AIR_CARRIER flavor will prioritize researching this technology. This makes sense as Computers unlocks the Carrier unit.

### Leader Flavor Values

**File**: `(2) Vox Populi\Database Changes\AI\LeaderFlavorSweeps.sql`

Default values for leaders (lines 45, 117, 191, 265):

```sql
('FLAVOR_AIR_CARRIER', 5),  -- Standard default
('FLAVOR_AIR_CARRIER', 5),  -- Repeated entries for different leader types
('FLAVOR_AIR_CARRIER', 4),
('FLAVOR_AIR_CARRIER', 4),
```

Specific leader adjustments (lines 350, 363, 380, 404, 426):

```sql
-- Dido (strong navy)
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_AIR_CARRIER' AND LeaderType = 'LEADER_DIDO';

-- Elizabeth (primary: domination)
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_AIR_CARRIER' AND LeaderType = 'LEADER_ELIZABETH';

-- Enrico Dandolo (naval-ish)
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_AIR_CARRIER' AND LeaderType = 'LEADER_ENRICO_DANDOLO';

-- Harald (naval-ish)
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_AIR_CARRIER' AND LeaderType = 'LEADER_HARALD';

-- Isabella (naval)
UPDATE Leader_Flavors SET Flavor = 5 WHERE FlavorType = 'FLAVOR_AIR_CARRIER' AND LeaderType = 'LEADER_ISABELLA';
```

Naval-focused leaders receive higher FLAVOR_AIR_CARRIER values, making them more likely to build carrier battle groups.

### Barbarian Leader

**File**: `(1) Community Patch\Database Changes\AI\CoreLeaderFlavorChanges.sql` (line 26)

```sql
('LEADER_BARBARIAN', 'FLAVOR_AIR_CARRIER', 0),
```

Barbarians have zero FLAVOR_AIR_CARRIER, preventing them from attempting to build carriers.

### Economic Strategy Modifiers

**File**: `(1) Community Patch\Database Changes\AI\CoreStrategyChanges.sql` (lines 104, 106)

```sql
('ECONOMICAISTRATEGY_TOO_MANY_UNITS', 'FLAVOR_AIR_CARRIER', -300),
('ECONOMICAISTRATEGY_LOSING_MONEY', 'FLAVOR_AIR_CARRIER', -300),
```

When the AI has too many units or is losing money, it receives a massive -300 penalty to FLAVOR_AIR_CARRIER, strongly discouraging carrier production during economic stress.

### War-Related Strategy Modifiers

**File**: `(1) Community Patch\Database Changes\AI\CoreStrategyChanges.sql` (lines 184, 194, 220, 246, 295, 302, 328, 354)

```sql
('MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL', 'FLAVOR_AIR_CARRIER', 60),  -- Repeated at line 295 with value 50
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_AIR_CARRIER', 40),                   -- Also at line 302
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_AIR_CARRIER', 40),            -- Also at line 328 with value 50
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_AIR_CARRIER', 30),             -- Also at line 354
```

These modifiers significantly increase FLAVOR_AIR_CARRIER during various war conditions, encouraging the AI to build carriers when engaged in military conflicts.

## AI Behavior Summary

### Aircraft Carrier Production

FLAVOR_AIR_CARRIER directly influences:

- **Unit production priority**: Higher values make UNIT_CARRIER and UNIT_SUPERCARRIER more likely to be built
- **Technology research**: Encourages research of Computers technology which unlocks carriers
- **Strategic triggers**: Activates "NEED_AIR_CARRIER" strategy when the AI has aircraft but no carrier capacity

### Naval Aviation Strategy

The flavor affects how the AI approaches naval aviation:

- **Carrier battle groups**: High values encourage building carriers to support air units at sea
- **Power projection**: Carriers enable the AI to project air power across oceans
- **Fleet composition**: Influences the ratio of carriers in the naval fleet

### Situational Modifiers

The effective FLAVOR_AIR_CARRIER value changes based on game conditions:

**Positive modifiers (increase carrier production)**:

- Empire defense is critical: +50 to +60
- At war: +40
- Winning wars: +40 to +50
- Losing wars: +30
- Need air carrier strategy active: +20

**Negative modifiers (decrease carrier production)**:

- Too many units: -300
- Losing money: -300

### Leader Personalities

Certain leaders have naturally higher FLAVOR_AIR_CARRIER values:

- **Dido**: 7 (strong naval tradition)
- **Elizabeth**: 7 (domination focus with naval power)
- **Enrico Dandolo**: 7 (Venice's naval heritage)
- **Harald**: 7 (Viking naval warfare)
- **Isabella**: 5 (Spanish naval exploration)

Most other leaders have values between 4-5, representing a moderate interest in carriers.

### Relationship to Other Flavors

FLAVOR_AIR_CARRIER works in conjunction with:

- **FLAVOR_AIR**: Must have air units to make carriers useful
- **FLAVOR_NAVAL**: General naval power complements carrier operations
- **FLAVOR_NAVAL_RECON**: Carriers also provide scouting capabilities
- **FLAVOR_OFFENSE/DEFENSE**: Military flavors that contextualize carrier usage

## Game Impact

An AI with high FLAVOR_AIR_CARRIER (7+) will:

1. Research Computers technology as a priority when available
2. Build Carrier and Supercarrier units when it has an air force
3. Trigger the NEED_AIR_CARRIER strategy when carriers are needed
4. Increase carrier production during wars, especially defensive wars
5. Value military policies that support conquest strategies

An AI with low FLAVOR_AIR_CARRIER (0-3) will:

1. Rarely build carriers even when air units are available
2. Deprioritize Computers technology
3. Not respond strongly to carrier needs
4. Focus naval resources on other ship types

## Related Flavors

- **FLAVOR_AIR**: Controls production of aircraft (fighters, bombers)
- **FLAVOR_NAVAL**: General naval unit production
- **FLAVOR_NAVAL_RECON**: Scouting and exploration ships
- **FLAVOR_OFFENSE**: Aggressive military strategies
- **FLAVOR_DEFENSE**: Defensive military priorities
