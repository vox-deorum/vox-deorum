# Overview

The `CityFlipped` event is triggered when a city revolts and changes ownership due to unhappiness in Civilization V. This event represents a critical failure in city management where extreme unhappiness has led to a complete loss of control, with the city either becoming independent, reverting to a former owner, or being transferred to another civilization through rebellion.

# Event Triggers

This event is triggered when the `DoCityRevolt()` function is called on a player and successfully identifies a city that will flip to another player or become independent.

**Specific trigger conditions:**

- **Extreme unhappiness**: A city has reached critical levels of unhappiness that trigger revolt mechanisms
- **Valid recipient**: The system has identified a valid recipient for the revolting city (original owner, free city, or another player)
- **Revolt execution**: The actual city flip/revolt process is about to begin
- **Unhappiest city**: The city selected is the most unhappy city belonging to the player

**Related mechanics that can trigger city revolts:**

- Prolonged periods of negative happiness leading to revolt countdowns
- Loss of luxury resources causing widespread unhappiness in cities
- Occupation unhappiness that exceeds manageable levels
- Cultural pressure from nearby foreign cities with strong influence
- Religious unrest and ideological pressure from opposing civilizations
- Economic collapse leading to citizen dissatisfaction
- War-related unhappiness and occupation penalties

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `cityID` | integer | The ID of the city that is flipping/revolting (converted from `pMostUnhappyCity` pointer) |
| `recipientID` | integer | The player ID of the recipient who will receive the city (`eRecipient`) |
| `originalOwnerID` | integer | The player ID of the current owner who is losing the city (`pMostUnhappyCity->getOwner()`) |

# Event Details

City flipping represents one of the most severe consequences of poor city management and happiness control in Civilization V. When cities become extremely unhappy and remain so for extended periods, they can revolt and change ownership, representing a complete breakdown of governmental control and citizen loyalty.

**City revolt mechanics:**

- **Unhappiness threshold**: Cities must reach and maintain critical unhappiness levels to be eligible for revolt
- **Recipient determination**: The system identifies the most appropriate new owner for the revolting city
- **Original owner preference**: Former owners of cities are often preferred recipients for revolts
- **Free city option**: Cities may become independent free cities if no suitable recipient exists
- **Revolution mechanics**: Some revolts can trigger broader revolutionary movements

**Recipient priority system:**

- **Original owners**: Cities often prefer to revert to their original civilization
- **Cultural influence**: Nearby civilizations with strong cultural pressure may receive revolting cities
- **Religious affinity**: Cities may flip to civilizations sharing their dominant religion
- **Free city status**: Cities become independent if no suitable recipient is available
- **Dead civilizations**: Former civilizations may be resurrected through city revolts

**Revolt consequences:**

- **Immediate ownership transfer**: The city changes hands immediately upon revolt execution
- **Population effects**: City population may be affected by the revolutionary period
- **Building preservation**: Most buildings typically survive the ownership change
- **Diplomatic impact**: City revolts can affect diplomatic relationships between civilizations
- **Strategic implications**: Loss of key cities can significantly impact empire development

**Prevention and mitigation:**

- **Happiness management**: Maintaining positive happiness prevents revolt conditions
- **Luxury resource access**: Ensuring adequate luxury resources reduces unhappiness
- **Building infrastructure**: Happiness-providing buildings help stabilize cities
- **Policy choices**: Social policies can provide happiness bonuses to prevent revolts
- **Military presence**: Garrisoned units may help suppress revolutionary sentiments

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 20513

**Function Context**: Called within `CvPlayer::DoCityRevolt()`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityFlipped`

**Preconditions**:

- Player must have at least one city (to identify most unhappy city)
- `pMostUnhappyCity` must be a valid city pointer (not NULL)
- `eRecipient` must be a valid player type (not NO_PLAYER)
- City must meet unhappiness thresholds for revolt eligibility

**Event Flow**:

1. `DoCityRevolt` is called as part of unhappiness processing
2. System identifies the most unhappy city via `GetMostUnhappyCity()`
3. System determines the most appropriate recipient via `GetMostUnhappyCityRecipient()`
4. If both city and recipient are valid, `GAMEEVENT_CityFlipped` is invoked immediately
5. System checks if recipient civilization is alive or needs to be resurrected
6. City ownership transfer process begins based on recipient status
7. Free city creation occurs if recipient is not alive and has never existed
8. Revolution mechanics may trigger if recipient is a dead but former civilization
9. Notification systems inform players of the city revolt
10. Logging occurs if enabled for debugging and analysis

**Recipient handling logic:**

- **Living recipients**: Direct city transfer to the recipient civilization
- **Dead but former recipients**: May trigger civilization resurrection through revolution
- **Never-existed recipients**: City becomes a free city under independent control
- **Free city creation**: Special independent player is created to govern the city

**Related Events**:

- Various unhappiness and loyalty-related events that may precede city revolts
- Diplomatic events that may be triggered by city ownership changes
- Revolution-related events when dead civilizations are resurrected through revolt
