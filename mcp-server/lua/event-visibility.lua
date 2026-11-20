local visibilityFlags = {}
local maxMajorCivs = ${MaxMajorCivs} - 1
local extraPayloads
local currentEventType

-- Helper function to get player's civilization name
local function getPlayerCivName(player)
  if not player then return nil end

  if player:IsMinorCiv() then
    return "City-State " .. player:GetName()
  elseif player:IsBarbarian() then
    return "Barbarians"
  else
    return player:GetCivilizationShortDescription()
  end
end

-- Helper function to format a DealMade item using the same wording as player summaries
local function formatDealItem(itemType, data1, data2, data3, fromPlayer, toPlayer)
  if itemType == TradeableItems.TRADE_ITEM_GOLD then
    return string.format("%d Gold", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_GOLD_PER_TURN then
    return string.format("%d Gold per Turn", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_MAPS then
    return "World Map"

  elseif itemType == TradeableItems.TRADE_ITEM_RESOURCES then
    local resource = GameInfo.Resources[data1]
    if resource then
      local resourceName = Locale.ConvertTextKey(resource.Description)
      return string.format("%d %s", data2, resourceName)
    end
    return string.format("%d Resource (ID: %d)", data2, data1)

  elseif itemType == TradeableItems.TRADE_ITEM_CITIES then
    local plot = Map.GetPlot(data1, data2)
    if plot then
      local city = plot:GetPlotCity()
      if city then
        return string.format("City of %s", city:GetName())
      end
    end
    return string.format("City at (%d, %d)", data1, data2)

  elseif itemType == TradeableItems.TRADE_ITEM_OPEN_BORDERS then
    return "Open Borders"

  elseif itemType == TradeableItems.TRADE_ITEM_DEFENSIVE_PACT then
    return "Defensive Pact"

  elseif itemType == TradeableItems.TRADE_ITEM_RESEARCH_AGREEMENT then
    local cost = Game.GetResearchAgreementCost(fromPlayer, toPlayer)
    return string.format("Research Agreement (%d Gold)", cost)

  elseif itemType == TradeableItems.TRADE_ITEM_PEACE_TREATY then
    return "Peace Treaty"

  elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_PEACE then
    local teamName = "Unknown"
    if data1 and Teams[data1] then
      local team = Teams[data1]
      local leaderID = team:GetLeaderID()
      if leaderID >= 0 then
        local leader = Players[leaderID]
        if leader then
          teamName = getPlayerCivName(leader)
        end
      end
    end
    return string.format("Make Peace with %s", teamName)

  elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_WAR then
    local teamName = "Unknown"
    if data1 and Teams[data1] then
      local team = Teams[data1]
      local leaderID = team:GetLeaderID()
      if leaderID >= 0 then
        local leader = Players[leaderID]
        if leader then
          teamName = getPlayerCivName(leader)
        end
      end
    end
    return string.format("Declare War on %s", teamName)

  elseif itemType == TradeableItems.TRADE_ITEM_ALLOW_EMBASSY then
    return "Embassy"

  elseif itemType == TradeableItems.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP then
    return "Declaration of Friendship"

  elseif itemType == TradeableItems.TRADE_ITEM_VOTE_COMMITMENT then
    return "Vote Commitment (World Congress)"

  elseif itemType == TradeableItems.TRADE_ITEM_TECHS then
    local tech = GameInfo.Technologies[data1]
    if tech then
      local techName = Locale.ConvertTextKey(tech.Description)
      return string.format("Technology: %s", techName)
    end
    return string.format("Technology (ID: %d)", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE then
    return "Vassalage"

  elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE_REVOKE then
    return "End Vassalage"

  else
    return string.format("Unknown Item (Type: %d)", itemType or -1)
  end
end

local function shapeDealMadePayload(payload)
  if currentEventType ~= "DealMade" or type(payload.TradedItems) ~= "table" then
    return
  end

  local fromPlayerID = payload.FromPlayerID
  local toPlayerID = payload.ToPlayerID
  if fromPlayerID == nil or toPlayerID == nil then
    return
  end

  local fromGives = {}
  local toGives = {}
  local turnsRemaining = -1

  for _, item in ipairs(payload.TradedItems) do
    if type(item) == "table" then
      local itemFromPlayerID = item.FromPlayerID
      local itemToPlayerID = itemFromPlayerID == fromPlayerID and toPlayerID or fromPlayerID
      local itemStr = formatDealItem(item.ItemType, item.Data1, item.Data2, item.Data3, itemFromPlayerID, itemToPlayerID)

      if itemFromPlayerID == fromPlayerID then
        table.insert(fromGives, itemStr)
      elseif itemFromPlayerID == toPlayerID then
        table.insert(toGives, itemStr)
      end

      if turnsRemaining == -1 and item.Duration and item.Duration > 0 then
        turnsRemaining = item.Duration
      end
    end
  end

  extraPayloads["FromGives"] = fromGives
  extraPayloads["ToGives"] = toGives
  extraPayloads["TurnsRemaining"] = turnsRemaining
end

-- IdeologyAdopted also fires when a branch is locked again (the old ideology in a switch); flag it so the store drops it
local function flagLockedBranch(payload)
  if currentEventType ~= "IdeologyAdopted" then
    return
  end

  local player = Players[payload.PlayerID]
  if player and not player:IsPolicyBranchUnlocked(payload.BranchType) then
    extraPayloads["BranchLocked"] = true
  end
end

-- Whitelist of events that should be propagated to met players with reduced visibility
local eventsToMetPlayers = {"CircumnavigatedGlobe", "CapitalChanged",
  "NuclearDetonation", "PantheonFounded", "IdeologyAdopted", "IdeologySwitched", "PlayerAnarchy", "PlayerGoldenAge", "PlayerLiberated",
  "ReligionFounded", "ReligionReformed", "ReligionEnhanced", "StateReligionAdopted", "StateReligionChanged",
  "DeclareWar", "MakePeace", "DealMade"}

-- Whitelist of tile events that should be propagated to players who have revealed but not visible tiles
local tileEventsToRevealedPlayers = {"CityCreated", "CityConvertsReligion", "CityPuppeted", "CityRazed", "CityCaptureComplete",
  "NuclearDetonation"}

-- Helper function to add an extra payload
local function addPayload(key, value)
  if key ~= nil then 
    extraPayloads[string.sub(key, 1, -3)] = value
  end
end

-- Helper function to mark player as able to see the event
local function setVisible(playerID, value)
  -- For visibility, we only care about major civs
  if playerID <= ${MaxMajorCivs} and visibilityFlags[playerID + 1] < value then
    visibilityFlags[playerID + 1] = value
  end
end

-- Helper function to propagate visibility to all civs that have met a given team
local function addMetTeam(teamID, value)
  if teamID < 0 then return end
  for otherID = 0, maxMajorCivs do
    local otherPlayer = Players[otherID]
    if otherPlayer and otherPlayer:IsAlive() then
      local otherTeam = Teams[otherPlayer:GetTeam()]
      if otherTeam and otherTeam:IsHasMet(teamID) then
        setVisible(otherID, value)
      end
    end
  end
end

-- Helper function to add team-based visibility
local function addTeam(teamID, value, key)
  if teamID < 0 then return end

  -- All team players should have the same visibility
  local metadata = {}
  for otherID = 0, maxMajorCivs do
    local otherPlayer = Players[otherID]
    if otherPlayer and otherPlayer:GetTeam() == teamID then
      metadata["Player_" .. otherID] = otherPlayer:GetName()
      setVisible(otherID, value)
    end
  end

  -- Add to the extra payload
  addPayload(key, metadata)

  -- Check if this event type should be propagated to met players
  local propagateToMet = false
  for _, eventPattern in ipairs(eventsToMetPlayers) do
    if currentEventType == eventPattern then
      propagateToMet = true
      break
    end
  end

  -- If whitelisted, propagate to met players with reduced visibility
  if propagateToMet then
    addMetTeam(teamID, math.min(1, value - 1))
  end
end

-- Helper function to add player-based visibility
local function addPlayer(playerID, value, key)
  -- Check if player exists
  local player = Players[playerID]
  if not player or player:IsMinorCiv() then return end

  -- Team members can see each other's events
  addTeam(player:GetTeam(), value)

  -- Get the succinct metadata for the player
  if key ~= nil then
    local metadata = {}
    metadata["Name"] = player:GetName()
    metadata["Civilization"] = getPlayerCivName(player)
    addPayload(key, metadata)
  end
end

-- Helper function to handle plot-based visibility
local function addPlotVisibility(plotX, plotY, value, key)
  if plotX < 0 or plotY < 0 then return end
  
  local plot = Map.GetPlot(plotX, plotY)
  if not plot then return end
  
  -- Check if this event type should be propagated to players with revealed tiles
  local propagateToRevealed = false
  for _, eventPattern in ipairs(tileEventsToRevealedPlayers) do
    if currentEventType == eventPattern then
      propagateToRevealed = true
      break
    end
  end
  
  -- Check visibility for all players
  -- Except for TileRevealed, which doesn't make sense
  if currentEventType ~= "TileRevealed" then
    for playerID = 0, maxMajorCivs do
      local player = Players[playerID]
      local teamID = player:GetTeam()
      -- Check if plot is revealed to this team
      if player:IsAlive() and plot:IsRevealed(teamID) then
        if plot:IsVisible(teamID) then
          setVisible(playerID, value)
        elseif propagateToRevealed then
          setVisible(playerID, math.min(1, value - 1))  -- Reduced visibility if revealed but not visible
        end
      end
    end
  end
  
  -- Get the succinct metadata for the player
  if key ~= nil then
    local metadata = {}

    -- Try to get its owner
    local owner = Players[plot:GetOwner()]
    if owner ~= nil then
      metadata["Owner"] = getPlayerCivName(owner)
      -- City
      local city = plot:GetPlotCity()
      if city ~= nil then
        metadata["City"] = city:GetName()
        metadata["CityID"] = city:GetID()
        metadata["Population"] = city:GetPopulation()
        metadata["ReligionID"] = city:GetReligiousMajority()
      end
    end

    -- Terrain
    metadata["PlotType"] = plot:GetPlotType()
    metadata["IsRiver"] = plot:IsRiver()
    metadata["ResourceType"] = plot:GetResourceType(-1)
    metadata["RouteType"] = plot:GetRouteType()
    metadata["TerrainType"] = plot:GetTerrainType()
    metadata["FeatureType"] = plot:GetFeatureType()
    metadata["ImprovementType"] = plot:GetImprovementType()

    addPayload(key, metadata)
  end
end

-- Helper function to add unit-based visibility and record names on great person life events
local function addUnit(unitID, value, key, nameOwnerID)
  -- Check if the unit exists
  if unitID < 0 then return end

  -- Unit IDs are local to a player. Get the name and the event's visibility before
  -- the generic unit lookup can add visibility from a different owner's unit.
  local greatPerson, greatPersonVisibility
  local owner = nameOwnerID ~= nil and Players[nameOwnerID]
  local namedUnit = owner and owner:GetUnitByID(unitID)
  if namedUnit and namedUnit:IsGreatPerson() and namedUnit:HasName() then
    greatPerson = namedUnit:GetNameNoDesc()
    greatPersonVisibility = {}
    for i, level in ipairs(visibilityFlags) do
      greatPersonVisibility[i] = level
    end
  end

  -- Find the unit's owner by checking all players
  local unit = nil
  for playerID = 0, GameDefines.MAX_PLAYERS - 1 do
    local player = Players[playerID]
    if player and player:IsAlive() then
      unit = player:GetUnitByID(unitID)
      if unit ~= nil then
        break
      end
    end
  end

  -- Check if unit is visible to other players based on plot visibility
  if unit == nil then return end
  local plotX = unit:GetX()
  local plotY = unit:GetY()
  addPlotVisibility(plotX, plotY, value)

  -- Get unit metadata
  if key ~= nil then
    local metadata = {}
    metadata["UnitType"] = unit:GetUnitType()
    metadata["AIType"] = unit:GetUnitAIType()
    if unit:GetMaxHitPoints() ~= unit:GetCurrHitPoints() then
      metadata["Health"] = math.floor(unit:GetCurrHitPoints() / unit:GetMaxHitPoints() * 100) .. "%"
    end
    metadata["Level"] = unit:GetLevel()

    metadata["GreatPerson"] = greatPerson
    metadata["GreatPersonVisibility"] = greatPersonVisibility
    addPayload(key, metadata)
  end
end

-- Helper function to add city-based visibility
local function addCity(cityID, value, key)
  -- Check if the city exists
  if cityID < 0 then return end

  -- Find the city's owner by checking all players
  local city = nil
  for playerID = 0, GameDefines.MAX_PLAYERS - 1 do
    local player = Players[playerID]
    if player and player:IsAlive() then
      city = player:GetCityByID(cityID)
      if city ~= nil then
        break
      end
    end
  end
  
  -- Check if city is visible to other players based on plot visibility
  if city == nil then return end
  local plotX = city:GetX()
  local plotY = city:GetY()
  addPlotVisibility(plotX, plotY, value)

  -- Get city metadata
  if key ~= nil then
    local metadata = {}
    metadata["Name"] = city:GetName()
    metadata["Population"] = city:GetPopulation()
    if city:GetDamage() ~= 0 then
      metadata["Health"] = 1 - math.ceil(city:GetDamage() / city:GetMaxHitPoints() * 100) .. "%"
    end
    addPayload(key, metadata)
  end
end

Game.RegisterFunction("${Name}", function(${Arguments})
  -- Initialize visibility flags for all players
  for i = 1, maxMajorCivs + 1 do
    visibilityFlags[i] = 0
  end
  extraPayloads = {}
  currentEventType = eventType
  shapeDealMadePayload(payload)
  flagLockedBranch(payload)

  -- Analyze visibility based on event type and payload
  for key, value in pairs(payload) do
    -- Check for player-related fields in payload
    if (string.match(key, "PlayerID$") or string.match(key, "OwnerID$")) then
      addPlayer(value, 2, key)
    end
    
    -- Check for team-related fields in payload
    if string.match(key, "TeamID$") then
      addTeam(value, 2, key)
    end
    
    -- Handle plot coordinates for visibility
    if string.match(key, "X$") then
      local plotY = payload[string.sub(key, 1, -2) .. "Y"]
      if plotY then
        addPlotVisibility(value, plotY, 2, key .. "$")
      end
    end
  end

  -- Names for the paper belong to the unit that was born, used or killed.
  local nameOwnerID = nil
  if eventType == "UnitCreated" or eventType == "GreatPersonExpended" then
    nameOwnerID = payload.PlayerID
  elseif eventType == "UnitPrekill" then
    nameOwnerID = payload.OwnerID
  end

  -- A second round for units/cities
  for key, value in pairs(payload) do
    -- Check for unit-related fields in payload
    if string.match(key, "UnitID$") then
      addUnit(value, 2, key, key == "UnitID" and nameOwnerID or nil)
    end
    
    -- Check for city-related fields in payload
    if string.match(key, "CityID$") then
      addCity(value, 2, key)
    end
  end

  -- World Congress outcomes are public records for every major civ, so mark them
  -- after enrichment has supplied the proposer label and any other event metadata.
  if currentEventType == "ResolutionResult" then
    for playerID = 0, maxMajorCivs do
      setVisible(playerID, 2)
    end
  end

  return extraPayloads, visibilityFlags
end)

return true
