-- Get-Game-Settings Lua Script
-- Retrieves static game metadata that doesn't change during gameplay
-- Helper function to get localized text from GameInfo
local function getLocalizedGameInfo(category, id)
    local info = GameInfo[category] and GameInfo[category][id]
    if info then
        if info.Description then
            return Locale.ConvertTextKey(info.Description)
        elseif info.Type then
            return info.Type
        end
    end
    return "Unknown"
end

-- Get game speed
local gameSpeedID = Game.GetGameSpeedType()
local gameSpeed = getLocalizedGameInfo("GameSpeeds", gameSpeedID)

-- Get map size
local map = Map
local mapSizeID = map.GetWorldSize()
local mapSize = getLocalizedGameInfo("Worlds", mapSizeID)

-- Get map type (from map script name if available)
local mapType = Game:GetMapScriptName()

-- Get difficulty
local difficultyID = Game.GetHandicapType()
local difficulty = getLocalizedGameInfo("HandicapInfos", difficultyID)

-- Get start era
local startEraID = Game.GetStartEra()
local startEra = getLocalizedGameInfo("Eras", startEraID)

-- Get max turns
local maxTurns = Game.GetMaxTurns()

-- Get enabled victory types
local victoryTypes = {}
for row in GameInfo.Victories() do
    if Game.IsVictoryValid(row.ID) then
        local victoryName = Locale.ConvertTextKey(row.Description)
        table.insert(victoryTypes, victoryName)
    end
end

-- Build metadata
local metadata = {
    GameSpeed = gameSpeed,
    MapType = mapType,
    MapSize = mapSize,
    Difficulty = difficulty,
    StartEra = startEra,
    MaxTurns = maxTurns,
    VictoryTypes = victoryTypes
}

-- Training cost provides a stable speed multiplier independently of localized speed names.
local speedInfo = GameInfo.GameSpeeds[gameSpeedID]
if speedInfo and type(speedInfo.TrainPercent) == "number" and speedInfo.TrainPercent > 0 then
    metadata.GameSpeedMultiplier = speedInfo.TrainPercent / 100
end

-- Read the live player's display identity, including custom names and multiplayer nicknames.
if playerID and playerID >= 0 then
    local success, identity = pcall(function()
        local player = Players[playerID]
        if not player then return nil end
        local civilization = GameInfo.Civilizations[player:GetCivilizationType()]
        if not civilization then return nil end
        return {
            Name = player:GetCivilizationShortDescription(),
            Leader = player:GetName(),
            PlayerID = playerID,
            Type = civilization.Type
        }
    end)
    if success then metadata.YouAre = identity end
end

return metadata