# Overview

The `CityBoughtPlot` event is triggered when a city acquires a new plot of land through various acquisition methods in Civilization V. This encompasses both direct gold purchases and cultural border expansion, making it a central event for tracking territorial growth and city development.

# Event Triggers

This event is triggered in multiple contexts when a city gains control of a new plot:

**Gold-based purchases:**

- **Direct tile purchase**: Player manually purchases a tile using gold via the city interface
- **Automated building purchases**: Buildings automatically purchase plots using gold when criteria are met
- **Strategic purchases**: AI or automated systems purchase tiles for strategic purposes

**Culture-based acquisitions:**

- **Cultural border expansion**: Natural border growth when a city accumulates enough culture points
- **Culture level increases**: Automatic plot acquisition when cultural thresholds are reached
- **Forced cultural expansion**: When specific buildings or policies force cultural plot acquisition

**Special acquisition contexts:**

- **Free plot acquisition**: When plots are acquired at zero cost due to cultural overflow, automatic building purchases, or special mechanics

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city acquiring the plot |
| `cityID` | integer | The unique identifier of the city acquiring the plot |
| `plotX` | integer | The X coordinate of the plot being acquired |
| `plotY` | integer | The Y coordinate of the plot being acquired |
| `bGold` | boolean | True if the plot was purchased with gold, false otherwise |
| `bFaithCulture` | boolean | True if the plot was acquired via cultural expansion, false if via gold purchase |

# Event Details

The CityBoughtPlot event serves as a comprehensive tracker for all forms of territorial expansion, providing insight into how civilizations grow their borders and develop their cities. The boolean parameters distinguish between different acquisition methods, enabling targeted responses to specific expansion types.

**Acquisition methods:**

- **Gold purchases**: Direct player spending or automated building purchases using treasury funds
- **Cultural expansion**: Natural border growth through accumulated culture points exceeding thresholds
- **Free acquisition**: Cultural overflow or special mechanics providing zero-cost plots

**Strategic implications:**

- **Resource access**: Plot acquisition often targets valuable resources for exploitation
- **Defensive positioning**: Strategic purchases may secure chokepoints or defensive terrain
- **Economic expansion**: Acquiring high-yield tiles for improved city productivity
- **Cultural dominance**: Border expansion can influence cultural victory conditions

**Multiple trigger scenarios:** The event has three distinct call sites in the code:

1. **Cultural border expansion** (lines 17331, 17378): `bGold=false, bFaithCulture=true`
2. **Gold-based purchases** (line 28522): `bGold=bWithGold, bFaithCulture=false`
   - Note: `bGold` can be `false` even in gold purchase path if cultural overflow provides a discount

**Related mechanics:**

- Cultural level increases trigger automatic plot selection and acquisition
- Building effects can provide free plot purchases or reduced costs
- Policy and building effects can provide plot purchase discounts or free acquisitions
- Distance limitations apply based on city size and civilization bonuses

# Technical Details

**Source Locations**:

- `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 17331 (cultural expansion)
- `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 17378 (cultural expansion alternate path)
- `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 28522 (gold purchase)

**Function Contexts**:

- `CvCity::DoJONSCultureLevelIncrease()` for cultural border expansion
- `CvCity::BuyPlot(int iPlotX, int iPlotY, bool bAutomaticPurchaseFromBuilding)` for gold purchases

**Script System Integration**:

- **Modern**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityBoughtPlot` when available
- **Legacy**: Falls back to `LuaSupport::CallHook` for backward compatibility

**Preconditions**:

- City must be valid and have a proper owner
- Plot must be within acquisition range based on city mechanics
- Sufficient resources (gold/faith/culture) must be available for the acquisition method
- Plot must not already be owned by the acquiring player

**Event Flow**:

1. Plot acquisition initiated through various game mechanics
2. Cost calculations and validation performed based on acquisition type
3. Plot ownership transferred to the acquiring city
4. Appropriate boolean flags set based on acquisition method
5. Event invoked with city coordinates, plot coordinates, and method flags
6. Additional processing (achievements, instant yields, notifications) executed
7. UI updates and player notifications sent as appropriate

**Parameter Combinations**:

- `bGold=true, bFaithCulture=false`: Direct gold purchase or automated building purchase
- `bGold=false, bFaithCulture=true`: Cultural border expansion through accumulated culture
- `bGold=false, bFaithCulture=false`: Gold purchase path with cultural overflow discount (special case)
