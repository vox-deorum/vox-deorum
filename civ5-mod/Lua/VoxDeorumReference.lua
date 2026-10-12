-- Vox Deorum game reference: registers a bridge-callable function that returns the game's own player-agnostic tooltips for units, buildings, and technologies.
--
-- The includes resolve to the Community Patch overrides, the same tooltip code EUI screens use.
-- Registration waits for LuaEvents.VoxDeorumReferenceRegister, which the MCP server fires before
-- it asks for tooltips. Registering at context load would reach the DLL before its connection
-- service starts and crash the game.

include("InfoTooltipInclude")
include("TechHelpInclude")

-- Each kind's database table and its general-info tooltip builder.
local TOOLTIP_KINDS = {
	unit = {
		table = "Units",
		build = function(id) return GetHelpTextForUnit(id, true, nil, true, true) end,
	},
	building = {
		table = "Buildings",
		build = function(id) return GetHelpTextForBuilding(id, true, nil, false, nil, true) end,
	},
	technology = {
		table = "Technologies",
		build = function(id) return GetHelpTextForTech(id, true) end,
	},
}

-- Return a map from each requested type to its tooltip; unknown types and failed builds are left out.
local function referenceTooltips(kind, types)
	local spec = TOOLTIP_KINDS[kind]
	local tooltips = {}
	if spec == nil or type(types) ~= "table" then return tooltips end
	for _, typeName in ipairs(types) do
		local row = GameInfo[spec.table][typeName]
		if row ~= nil then
			local ok, text = pcall(spec.build, row.ID)
			if ok and type(text) == "string" and text ~= "" then
				tooltips[typeName] = Locale.ConvertTextKey(text)
			elseif not ok then
				print("[VoxDeorumReference] Tooltip failed for " .. tostring(typeName) .. ": " .. tostring(text))
			end
		end
	end
	return tooltips
end

-- Register the tooltip function with the DLL; repeat calls replace the earlier registration.
local function registerTooltips()
	if Game == nil or type(Game.RegisterFunction) ~= "function" then
		print("[VoxDeorumReference] Game.RegisterFunction is unavailable")
		return
	end
	local ok, errorMessage = pcall(Game.RegisterFunction, "VoxDeorumReferenceTooltips", referenceTooltips)
	if not ok then
		print("[VoxDeorumReference] Registration failed: " .. tostring(errorMessage))
	end
end

LuaEvents.VoxDeorumReferenceRegister.Add(registerTooltips)
