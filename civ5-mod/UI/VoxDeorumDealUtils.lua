-- Reusable data helpers for Vox Deorum DealPayload v1 screens.

VoxDeorumDealUtils = VoxDeorumDealUtils or {}

local delimiter = "!@#$%^!"
local delimiterPattern = string.gsub(delimiter, "(%W)", "%%%1")
local itemFields = { "fromPlayerID", "toPlayerID", "itemType", "amount", "duration", "resourceID", "quantity", "cityID", "thirdPartyTeamID", "techID", "resolutionID", "voteChoice", "numVotes", "repeal" }
local promiseFields = { "promiserID", "recipientID", "promiseType", "targetPlayerID", "duration" }
local symmetricItems = { DEFENSIVE_PACT = true, RESEARCH_AGREEMENT = true, PEACE_TREATY = true, DECLARATION_OF_FRIENDSHIP = true }
local knownPromises = { MILITARY = true, EXPANSION = true, BORDER = true, NO_DIGGING = true, COOP_WAR = true }
local knownItems = {
	GOLD = true, GOLD_PER_TURN = true, MAPS = true, RESOURCES = true, CITIES = true, OPEN_BORDERS = true,
	DEFENSIVE_PACT = true, RESEARCH_AGREEMENT = true, PEACE_TREATY = true, THIRD_PARTY_PEACE = true,
	THIRD_PARTY_WAR = true, ALLOW_EMBASSY = true, DECLARATION_OF_FRIENDSHIP = true, VOTE_COMMITMENT = true,
	TECHS = true, VASSALAGE = true, VASSALAGE_REVOKE = true,
}
local promiseDurationGetters = { MILITARY = "GetMilitaryPromiseDuration", EXPANSION = "GetExpansionPromiseDuration", BORDER = "GetBorderPromiseDuration" }

-- Return a deep data-only copy that preserves shared table references.
function VoxDeorumDealUtils.DeepCopy(value, seen)
	if type(value) ~= "table" then return value end
	seen = seen or {}
	if seen[value] ~= nil then return seen[value] end
	local copy = {}
	seen[value] = copy
	for key, child in pairs(value) do copy[VoxDeorumDealUtils.DeepCopy(key, seen)] = VoxDeorumDealUtils.DeepCopy(child, seen) end
	return copy
end

-- Read the standard deal duration through a guarded game binding.
function VoxDeorumDealUtils.DefaultDealDuration(game)
	game = game or Game
	if game == nil or type(game.GetDealDuration) ~= "function" then return nil end
	local ok, value = pcall(game.GetDealDuration)
	return ok and value or nil
end

-- Return the fixed live duration for one ordinary item type.
function VoxDeorumDealUtils.DurationForItem(itemType, game)
	game = game or Game
	local fallback = VoxDeorumDealUtils.DefaultDealDuration(game)
	if itemType == "PEACE_TREATY" or itemType == "THIRD_PARTY_PEACE" then
		if game ~= nil and type(game.GetPeaceDuration) == "function" then
			local ok, value = pcall(game.GetPeaceDuration)
			if ok then return value end
		end
		return fallback
	elseif itemType == "DECLARATION_OF_FRIENDSHIP" then
		if game ~= nil and type(game.GetRelationshipDuration) == "function" then
			local ok, value = pcall(game.GetRelationshipDuration)
			if ok then return value end
		end
		return fallback
	elseif itemType == "GOLD_PER_TURN" or itemType == "RESOURCES" or itemType == "OPEN_BORDERS" or itemType == "DEFENSIVE_PACT" or itemType == "RESEARCH_AGREEMENT" then
		return fallback
	end
	return nil
end

-- Return the fixed live duration for one authorable promise type.
function VoxDeorumDealUtils.DurationForPromise(promiseType, game, gameDefines)
	game, gameDefines = game or Game, gameDefines or GameDefines
	if promiseType == "COOP_WAR" then return gameDefines and gameDefines.COOP_WAR_SOON_COUNTER or nil end
	local getter = promiseDurationGetters[promiseType]
	if getter ~= nil and game ~= nil and type(game[getter]) == "function" then
		local ok, value = pcall(game[getter])
		if ok then return value end
	end
	return nil
end

-- Build a stable scalar key from a declared field list.
function VoxDeorumDealUtils.StableKey(entry, fields)
	local values = {}
	for _, field in ipairs(fields) do values[#values + 1] = field .. "=" .. tostring(entry[field]) end
	return table.concat(values, "|")
end

-- Keep canonical item fields and stamp its fixed live duration.
function VoxDeorumDealUtils.NormalizeItem(item, game)
	local out = {}
	for _, field in ipairs(itemFields) do if item[field] ~= nil then out[field] = item[field] end end
	local duration = VoxDeorumDealUtils.DurationForItem(out.itemType, game)
	if duration ~= nil then out.duration = duration else out.duration = nil end
	return out
end

-- Keep canonical promise fields and stamp its fixed live duration.
function VoxDeorumDealUtils.NormalizePromise(promise, game, gameDefines)
	local out = {}
	for _, field in ipairs(promiseFields) do if promise[field] ~= nil then out[field] = promise[field] end end
	local duration = VoxDeorumDealUtils.DurationForPromise(out.promiseType, game, gameDefines)
	if duration ~= nil then out.duration = duration else out.duration = nil end
	return out
end

-- Normalize, symmetrize, and sort an ordinary item array.
function VoxDeorumDealUtils.NormalizeItems(items, game)
	local out = {}
	for _, item in ipairs(items or {}) do out[#out + 1] = VoxDeorumDealUtils.NormalizeItem(item, game) end
	local originalCount = #out
	for index = 1, originalCount do
		local item = out[index]
		if symmetricItems[item.itemType] then
			local found = false
			for _, candidate in ipairs(out) do
				if candidate.itemType == item.itemType and candidate.fromPlayerID == item.toPlayerID and candidate.toPlayerID == item.fromPlayerID then found = true break end
			end
			if not found then
				local twin = VoxDeorumDealUtils.DeepCopy(item)
				twin.fromPlayerID, twin.toPlayerID = item.toPlayerID, item.fromPlayerID
				out[#out + 1] = twin
			end
		end
	end
	-- Sort items by every canonical discriminator.
	table.sort(out, function(a, b) return VoxDeorumDealUtils.StableKey(a, itemFields) < VoxDeorumDealUtils.StableKey(b, itemFields) end)
	return out
end

-- Normalize, symmetrize, and sort a promise array.
function VoxDeorumDealUtils.NormalizePromises(promises, game, gameDefines)
	local out = {}
	for _, promise in ipairs(promises or {}) do out[#out + 1] = VoxDeorumDealUtils.NormalizePromise(promise, game, gameDefines) end
	local originalCount = #out
	for index = 1, originalCount do
		local promise = out[index]
		if promise.promiseType == "COOP_WAR" then
			local found = false
			for _, candidate in ipairs(out) do
				if candidate.promiseType == "COOP_WAR" and candidate.promiserID == promise.recipientID and candidate.recipientID == promise.promiserID and candidate.targetPlayerID == promise.targetPlayerID then found = true break end
			end
			if not found then
				local twin = VoxDeorumDealUtils.DeepCopy(promise)
				twin.promiserID, twin.recipientID = promise.recipientID, promise.promiserID
				out[#out + 1] = twin
			end
		end
	end
	-- Sort promises by every canonical discriminator.
	table.sort(out, function(a, b) return VoxDeorumDealUtils.StableKey(a, promiseFields) < VoxDeorumDealUtils.StableKey(b, promiseFields) end)
	return out
end

-- Return a stable ordinary-item scratch fingerprint.
function VoxDeorumDealUtils.ItemFingerprint(items, game)
	local keys = {}
	for _, item in ipairs(VoxDeorumDealUtils.NormalizeItems(items, game)) do keys[#keys + 1] = VoxDeorumDealUtils.StableKey(item, itemFields) end
	return table.concat(keys, "\n")
end

-- Return a stable full semantic fingerprint for Accept protection.
function VoxDeorumDealUtils.SemanticFingerprint(items, promises, game, gameDefines)
	local keys = { VoxDeorumDealUtils.ItemFingerprint(items, game), "PROMISES" }
	for _, promise in ipairs(VoxDeorumDealUtils.NormalizePromises(promises, game, gameDefines)) do keys[#keys + 1] = VoxDeorumDealUtils.StableKey(promise, promiseFields) end
	return table.concat(keys, "\n")
end

-- Return whether one ID identifies a living major civilization in the supplied game tables.
function VoxDeorumDealUtils.IsLivingMajor(playerID, players, gameDefines)
	players, gameDefines = players or Players, gameDefines or GameDefines
	if not VoxDeorumDealUtils.IsInteger(playerID) or type(gameDefines) ~= "table" or playerID < 0 or playerID >= gameDefines.MAX_MAJOR_CIVS then return false end
	local player = players and players[playerID] or nil
	return player ~= nil and player:IsAlive() and not player:IsMinorCiv() and not player:IsBarbarian()
end

-- Return whether a value is a finite Lua integer.
local function isInteger(value)
	return type(value) == "number" and value == value and value % 1 == 0
end

-- Return whether a table is a dense one-based array.
local function isArray(value)
	if type(value) ~= "table" then return false end
	local count = 0
	for key, _ in pairs(value) do if not isInteger(key) or key < 1 then return false else count = count + 1 end end
	return count == #value
end

-- Return whether two IDs form one valid directed principal pair.
local function isPairDirection(fromPlayerID, toPlayerID, actorID, counterpartID)
	return (fromPlayerID == actorID and toPlayerID == counterpartID) or (fromPlayerID == counterpartID and toPlayerID == actorID)
end

-- Validate one ordinary term's DealPayload v1 fields.
local function validateItem(item, actorID, counterpartID)
	if type(item) ~= "table" or not knownItems[item.itemType] then return false end
	if not isInteger(item.fromPlayerID) or not isInteger(item.toPlayerID) or not isPairDirection(item.fromPlayerID, item.toPlayerID, actorID, counterpartID) then return false end
	if item.duration ~= nil and not isInteger(item.duration) then return false end
	if item.name ~= nil and type(item.name) ~= "string" then return false end
	local kind = item.itemType
	if kind == "GOLD" or kind == "GOLD_PER_TURN" then return isInteger(item.amount) end
	if kind == "RESOURCES" then return isInteger(item.resourceID) and isInteger(item.quantity) end
	if kind == "CITIES" then return isInteger(item.cityID) end
	if kind == "THIRD_PARTY_PEACE" or kind == "THIRD_PARTY_WAR" then return isInteger(item.thirdPartyTeamID) end
	if kind == "TECHS" then return isInteger(item.techID) end
	if kind == "VOTE_COMMITMENT" then return isInteger(item.resolutionID) and isInteger(item.voteChoice) and isInteger(item.numVotes) and (item.repeal == nil or type(item.repeal) == "boolean") end
	return true
end

-- Validate one promise term's DealPayload v1 fields.
local function validatePromise(promise, actorID, counterpartID)
	if type(promise) ~= "table" or not knownPromises[promise.promiseType] then return false end
	if not isInteger(promise.promiserID) or not isInteger(promise.recipientID) or not isPairDirection(promise.promiserID, promise.recipientID, actorID, counterpartID) then return false end
	if promise.duration ~= nil and not isInteger(promise.duration) then return false end
	if promise.promiseType == "COOP_WAR" then return isInteger(promise.targetPlayerID) end
	return promise.targetPlayerID == nil
end

-- Validate a complete DealPayload v1 before normalization or game calls.
function VoxDeorumDealUtils.ValidatePayload(deal, actorID, counterpartID)
	if type(deal) ~= "table" or deal.version ~= 1 or not isArray(deal.items) or not isArray(deal.promises) then return false end
	if deal.message ~= nil and type(deal.message) ~= "string" then return false end
	if deal.rationale ~= nil and type(deal.rationale) ~= "string" then return false end
	for _, item in ipairs(deal.items) do if not validateItem(item, actorID, counterpartID) then return false end end
	for _, promise in ipairs(deal.promises) do if not validatePromise(promise, actorID, counterpartID) then return false end end
	return true
end

-- Remove only the exact named-pipe delimiter while preserving author whitespace.
function VoxDeorumDealUtils.StripDelimiter(text)
	return string.gsub(tostring(text or ""), delimiterPattern, "")
end

-- Remove the named-pipe delimiter and trim a message for serialization.
function VoxDeorumDealUtils.SanitizeMessage(text)
	local clean = VoxDeorumDealUtils.StripDelimiter(text)
	clean = string.gsub(clean, "^%s+", "")
	clean = string.gsub(clean, "%s+$", "")
	return clean
end

VoxDeorumDealUtils.ItemFields = itemFields
VoxDeorumDealUtils.PromiseFields = promiseFields
VoxDeorumDealUtils.SymmetricItems = symmetricItems
VoxDeorumDealUtils.IsInteger = isInteger
