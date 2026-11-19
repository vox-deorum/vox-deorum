-- Extract city information from the game
-- Returns city data with visibility-based access control

local cities = {}

-- Helper function to calculate visibility between a player and a city
local function getCityVisibility(playerID, city)
  local cityOwnerID = city:GetOwner()
  local player = Players[playerID]

  if not player or not player:IsAlive() then
    return 0
  end

  -- Check if player owns the city
  if playerID == cityOwnerID then
    return 2  -- Full visibility (owner)
  end

  -- Check if players are on the same team
  local playerTeamID = player:GetTeam()
  local cityOwnerTeamID = Players[cityOwnerID]:GetTeam()

  if playerTeamID == cityOwnerTeamID then
    return 2  -- Full visibility (team member)
  end

  -- Check if player has a spy with established surveillance in this city
  -- Only applies to major civs (not city-states where spies are diplomats)
  local cityOwner = Players[cityOwnerID]
  if not cityOwner:IsMinorCiv() and city:HasSpy(playerID) then
    local spies = player:GetEspionageSpies()
    if spies then
      local cityX = city:GetX()
      local cityY = city:GetY()
      for _, spy in ipairs(spies) do
        -- Check if this spy is in this city and is not a diplomat
        if spy.CityX == cityX and spy.CityY == cityY and not spy.IsDiplomat then
          -- Check if surveillance is established
          if spy.EstablishedSurveillance then
            return 2  -- Full visibility (spy surveillance)
          end
        end
      end
    end
  end

  -- Check if city plot is revealed to the player
  local plot = city:Plot()
  if plot and plot:IsRevealed(playerTeamID, false) then
    return 1  -- Basic visibility (revealed)
  end

  return 0  -- Not visible
end

-- Helper function to get localized production name
local function getProductionName(city)
  if not city:IsProduction() then
    return nil
  end

  local productionName = ""
  if city:IsProductionUnit() then
    local unitID = city:GetProductionUnit()
    local unitInfo = GameInfo.Units[unitID]
    if unitInfo then
      productionName = Locale.ConvertTextKey(unitInfo.Description)
    end
  elseif city:IsProductionBuilding() then
    local buildingID = city:GetProductionBuilding()
    local buildingInfo = GameInfo.Buildings[buildingID]
    if buildingInfo then
      productionName = Locale.ConvertTextKey(buildingInfo.Description)
    end
  elseif city:IsProductionProject() then
    local projectID = city:GetProductionProject()
    local projectInfo = GameInfo.Projects[projectID]
    if projectInfo then
      productionName = Locale.ConvertTextKey(projectInfo.Description)
    end
  elseif city:IsProductionProcess() then
    local processID = city:GetProductionProcess()
    local processInfo = GameInfo.Processes[processID]
    if processInfo then
      productionName = Locale.ConvertTextKey(processInfo.Description)
    end
  end

  return productionName ~= "" and productionName or nil
end

-- Iterate through all players
for playerID = 0, GameDefines.MAX_CIV_PLAYERS do
  local player = Players[playerID]

  if player and player:IsAlive() and player:GetNumCities() > 0 then
    -- Iterate through all cities of this player
    for city in player:Cities() do
      -- Get owner name based on whether it's a major or minor civ
      local cityData = {
        Key = city:GetID(),  -- Use city ID as the key for MutableKnowledge
        Name = city:GetName(),
        X = city:GetX(),
        Y = city:GetY(),
        Population = city:GetPopulation(),
        MajorityReligion = nil,
        DefenseStrength = math.floor(city:GetStrengthValue() / 100),
        HitPoints = city:GetMaxHitPoints() - city:GetDamage(),  -- Calculate current HP
        MaxHitPoints = city:GetMaxHitPoints(),
        -- Basic status flags visible at level 1
        IsCapital = city:IsCapital() and 1 or 0,
        IsPuppet = city:IsPuppet() and 1 or 0,
        IsOccupied = city:IsOccupied() and 1 or 0,
        IsCoastal = city:IsCoastal(10) and 1 or 0  -- Near a water body of 10+ tiles
      }
      
      -- Use Civilization names
      if player:IsMinorCiv() then
        cityData["Owner"] = "City-States"
      elseif player:IsBarbarian() then
        cityData["Owner"] = "Barbarians"
      else 
        cityData["Owner"] = player:GetCivilizationShortDescription()
      end

      -- Get majority religion
      local majorityReligion = city:GetReligiousMajority()
      if majorityReligion and majorityReligion > 0 then
        local religionInfo = GameInfo.Religions[majorityReligion]
        if religionInfo then
          cityData.MajorityReligion = Locale.ConvertTextKey(religionInfo.Description)
        end
      end

      -- Add visibility level 2 fields (will be filtered based on visibility)
      cityData.FoodStored = city:GetFood()
      cityData.FoodPerTurn = city:FoodDifference()
      cityData.ProductionStored = city:GetProduction()
      cityData.ProductionPerTurn = city:GetCurrentProductionDifference(false, false)

      -- Get yield rates
      cityData.GoldPerTurn = city:GetYieldRate(GameInfoTypes.YIELD_GOLD)
      cityData.SciencePerTurn = city:GetYieldRate(GameInfoTypes.YIELD_SCIENCE)
      cityData.CulturePerTurn = city:GetJONSCulturePerTurn()
      cityData.FaithPerTurn = city:GetFaithPerTurn()
      cityData.TourismPerTurn = city:GetBaseTourism() / 100

      -- Get happiness
      cityData.HappinessDelta = city:getHappinessDelta()

      -- Collect every nonzero cause of unhappiness for the newspaper. The game applies
      -- its own population cap and handles resistance, razing and puppets separately.
      local unhappinessCauses = {
        { "Culture", city:GetUnhappinessFromYield(YieldTypes.YIELD_CULTURE) },
        { "Gold", city:GetUnhappinessFromYield(YieldTypes.YIELD_GOLD) },
        { "Science", city:GetUnhappinessFromYield(YieldTypes.YIELD_SCIENCE) },
        { "Distress", city:GetUnhappinessFromYield(YieldTypes.YIELD_FOOD) },
        { "Religion", city:GetUnhappinessFromReligiousUnrest() },
        { "Isolation", city:GetUnhappinessFromIsolation() },
        { "Famine", city:GetUnhappinessFromFamine() },
        { "PillagedTiles", city:GetUnhappinessFromPillagedTiles() },
        { "Buildings", city:GetUnhappinessFromBuildings() },
        { "Specialists", city:getUnhappinessFromSpecialists() }
      }
      local unhappinessSources = {}
      for _, cause in ipairs(unhappinessCauses) do
        if cause[2] ~= 0 then
          unhappinessSources[cause[1]] = cause[2]
        end
      end
      -- Keep the observed empty table so an all-zero city stays distinguishable from an unrecorded one.
      cityData.UnhappinessSources = unhappinessSources

      -- Additional city status flags (visible at level 2)
      cityData.RazingTurns = city:IsRazing() and city:GetRazingTurns() or 0
      cityData.ResistanceTurns = city:IsResistance() and city:GetResistanceTurns() or 0

      -- Building and wonder information
      cityData.BuildingCount = city:GetNumBuildings()

      -- Collect wonders and regular buildings separately
      local wonders = {}
      local buildings = {}

      for building in GameInfo.Buildings() do
        local buildingID = building.ID
        if city:IsHasBuilding(buildingID) then
          local buildingClass = GameInfo.BuildingClasses[building.BuildingClass]
          local buildingName = Locale.ConvertTextKey(building.Description)

          -- Check if it's a wonder (world or national)
          if buildingClass and (buildingClass.MaxGlobalInstances == 1 or buildingClass.MaxPlayerInstances == 1) then
            -- It's a wonder - add to wonders list (but not Palace)
            if building.BuildingClass ~= "BUILDINGCLASS_PALACE" then
              table.insert(wonders, buildingName)
            end
          else
            -- It's a regular building - add to buildings list
            table.insert(buildings, buildingName)
          end
        end
      end

      cityData.Wonders = wonders
      cityData.ImportantBuildings = buildings

      cityData.GreatWorkCount = city:GetNumGreatWorks()

      -- Current production
      cityData.CurrentProduction = getProductionName(city)
      cityData.ProductionTurnsLeft = city:GetProductionTurnsLeft()
      if cityData.ProductionTurnsLeft == 2147483647 then
        if cityData.CurrentProduction ~= nil then
          cityData.CurrentProduction = "Infinite Project: " .. cityData.CurrentProduction
        end
        cityData.ProductionStored = -1  -- Indicate no storage
        cityData.ProductionTurnsLeft = -1  -- Indicate indefinite production time
      end

      -- Add visibility information for each player
      for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local otherPlayer = Players[otherPlayerID]
        if otherPlayer and otherPlayer:IsEverAlive() then
          local fieldName = "Player" .. otherPlayerID
          cityData[fieldName] = getCityVisibility(otherPlayerID, city)
        end
      end

      -- Add to results
      table.insert(cities, cityData)
    end
  end
end

return cities