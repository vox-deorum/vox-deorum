-- Get a military report with units by type and tactical zones with unit assignments
-- Also saves tactical zone information to TacticalZones table
local pPlayer = Players[playerID]
local ourTeam = pPlayer:GetTeam()

-- Units organized by AIType
local units = {}

-- Track which unit types we've already added to prevent duplicates
local seenUnitTypes = {}

-- Tactical zones with unit assignments
local tacticalZones = {}

-- Default AI types of zero-strength units that still support combat (generals, admirals, siege towers)
local supportAITypes = {
  UNITAI_GENERAL = true,
  UNITAI_ADMIRAL = true,
  UNITAI_CITY_SPECIAL = true
}

-- Whether a unit is hidden from our team, including cargo carried by a hidden transport (e.g. nukes on a submarine)
local function isHiddenFromUs(pUnit)
  if pUnit:IsInvisible(ourTeam, false) then return true end
  if pUnit:IsCargo() then
    local pTransport = pUnit:GetTransportUnit()
    if pTransport and pTransport:IsInvisible(ourTeam, false) then return true end
  end
  return false
end

-- Get tactical zones for the player
local numZones = pPlayer:GetNumTacticalZones()
for i = 0, numZones - 1 do
  local zone = pPlayer:GetTacticalZone(i)
  if zone then
    -- Save zone with Units field for report
    zone.Units = {}
    tacticalZones[zone.ZoneID] = zone
  end
end

-- Add a default zone for units not in any tactical zone
if (not tacticalZones[0]) then
  tacticalZones[0] = {
    ZoneID = 0,
    Territory = "None",
    Dominance = "None",
    Domain = "None",
    Units = {}
  }
end

-- Iterate through all players to find their units
for iPlayerLoop = 0, GameDefines.MAX_PLAYERS - 1 do
  local pLoopPlayer = Players[iPlayerLoop]

  -- Check if this player exists and has units
  if pLoopPlayer and pLoopPlayer:IsAlive() then
    local civName = nil

    -- Iterate through all units of this player
    for pUnit in pLoopPlayer:Units() do
      local pPlot = pUnit:GetPlot()

      -- Check if the unit's plot is visible and the unit is not invisible to us
      if pPlot and pPlot:IsVisible(ourTeam, false) and not isHiddenFromUs(pUnit) then
        -- Get civilization name lazily (only when we find a visible unit)
        if not civName then
          if pLoopPlayer:IsMinorCiv() then
            civName = "City-State " .. pLoopPlayer:GetName()
          elseif pLoopPlayer:IsBarbarian() then
            civName = "Barbarians"
          else
            civName = pLoopPlayer:GetCivilizationShortDescription()
          end
        end

        -- Get unit details
        local aiType = pUnit:GetUnitAIType()
        local unitType = pUnit:GetUnitType()
        local combatStrength = pUnit:GetBaseCombatStrength()
        local rangedStrength = pUnit:GetBaseRangedCombatStrength()
        -- Nukes and support units have no combat strength, so check the unit info too
        local unitInfo = GameInfo.Units[unitType]
        local nukeLevel = unitInfo and unitInfo.NukeDamageLevel or -1
        local isSupport = unitInfo and supportAITypes[unitInfo.DefaultUnitAI] or false
        local isMilitaryUnit = (combatStrength > 0 or rangedStrength > 0 or nukeLevel > 0 or isSupport)

        if isMilitaryUnit then
          -- Add unit type to Units table (organized by AIType) - only once per unit type
          if not seenUnitTypes[unitType] then
            seenUnitTypes[unitType] = true
            if not units[aiType] then
              units[aiType] = {}
            end
            units[aiType][unitType] = {}
            if combatStrength > 0 then
              units[aiType][unitType].Strength = combatStrength
            end
            if rangedStrength > 0 then
              units[aiType][unitType].RangedStrength = rangedStrength
            end
            if nukeLevel > 0 then
              units[aiType][unitType].NukeDamageLevel = nukeLevel
            end
            if isSupport then
              units[aiType][unitType].Support = true
            end
          end

          -- Find which zone this unit belongs to
          local zoneID = pUnit:GetTacticalZoneID(playerID)
          if zoneID == -1 then
            zoneID = 0 -- Default zone for unassigned units
          end
          local zone = tacticalZones[zoneID]

          -- Initialize nested tables if needed (organized by Country only)
          if not zone.Units[civName] then
            zone.Units[civName] = {}
          end

          -- Increment count for this unit type
          zone.Units[civName][unitType] = (zone.Units[civName][unitType] or 0) + 1
        end
      end
    end
  end
end

-- Filter out zones without units
local filteredZones = {}
for zoneID, zone in pairs(tacticalZones) do
  if next(zone.Units) then
    filteredZones[zoneID] = zone
  end
end

-- Return units and filtered tactical zones
return {units, filteredZones}