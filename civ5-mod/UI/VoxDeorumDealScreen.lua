-- Vox Deorum wrapper for the native VP deal editor.

include("VoxDeorumSeat")
include("VoxDeorumDealUtils")
include("InstanceManager")
include("TradeLogic")

if Events.ClearDiplomacyTradeTable.Remove ~= nil and type(DoClearDeal) == "function" then Events.ClearDiplomacyTradeTable.Remove(DoClearDeal) end
ContextPtr:SetHide(true)

local deal = UI.GetScratchDeal()
local actorID, counterpartID, mode, reviewMode, proposalMessageID = -1, -1, nil, nil, nil
local baselineItems, baselinePromises, draftItems, draftPromises = {}, {}, {}, {}
local originalMessage, outgoingMessage, expectedSignature = "", "", nil
local mounted, pending, rebuilding, settingMessage, nativeRedrawInProgress, mockMountAuthorized, mockMode = false, false, false, false, false, false, false
local queuedAsPopup = false
local pendingSeconds, clobberSeconds, targetPromiserID = 0, 0, nil
local coopWarTargetAvailability = {}
local refresh
local reviewIM = InstanceManager:new("VoxReviewRow", "Container", Controls.VoxReviewStack)
local usPromiseIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxUsPromisePocketStack)
local themPromiseIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxThemPromisePocketStack)
local promiseIM = InstanceManager:new("VoxPromiseTableEntry", "Container", Controls.VoxPromiseTableStack)
local targetIM = InstanceManager:new("VoxPromiseTargetEntry", "Button", Controls.VoxTargetStack)

local promiseKeys = {
	MILITARY = "TXT_KEY_VD_DEAL_PROMISE_MILITARY", EXPANSION = "TXT_KEY_VD_DEAL_PROMISE_EXPANSION",
	BORDER = "TXT_KEY_VD_DEAL_PROMISE_BORDER", NO_DIGGING = "TXT_KEY_VD_DEAL_PROMISE_NO_DIGGING",
	COOP_WAR = "TXT_KEY_VD_DEAL_PROMISE_COOP_WAR",
}
local promiseKinds = { "MILITARY", "EXPANSION", "BORDER", "NO_DIGGING", "COOP_WAR" }
local promiseDurationKinds = { MILITARY = true, EXPANSION = true, BORDER = true, COOP_WAR = true }
local itemNameKeys = {
	GOLD = "TXT_KEY_VD_DEAL_ITEM_GOLD", GOLD_PER_TURN = "TXT_KEY_VD_DEAL_ITEM_GOLD_PER_TURN", MAPS = "TXT_KEY_VD_DEAL_ITEM_MAPS", RESOURCES = "TXT_KEY_VD_DEAL_ITEM_RESOURCES", CITIES = "TXT_KEY_VD_DEAL_ITEM_CITIES",
	OPEN_BORDERS = "TXT_KEY_VD_DEAL_ITEM_OPEN_BORDERS", DEFENSIVE_PACT = "TXT_KEY_VD_DEAL_ITEM_DEFENSIVE_PACT", RESEARCH_AGREEMENT = "TXT_KEY_VD_DEAL_ITEM_RESEARCH_AGREEMENT",
	PEACE_TREATY = "TXT_KEY_VD_DEAL_ITEM_PEACE_TREATY", THIRD_PARTY_PEACE = "TXT_KEY_VD_DEAL_ITEM_THIRD_PARTY_PEACE", THIRD_PARTY_WAR = "TXT_KEY_VD_DEAL_ITEM_THIRD_PARTY_WAR",
	ALLOW_EMBASSY = "TXT_KEY_VD_DEAL_ITEM_ALLOW_EMBASSY", DECLARATION_OF_FRIENDSHIP = "TXT_KEY_VD_DEAL_ITEM_DECLARATION_OF_FRIENDSHIP", VOTE_COMMITMENT = "TXT_KEY_VD_DEAL_ITEM_VOTE_COMMITMENT",
	TECHS = "TXT_KEY_VD_DEAL_ITEM_TECHS", VASSALAGE = "TXT_KEY_VD_DEAL_ITEM_VASSALAGE", VASSALAGE_REVOKE = "TXT_KEY_VD_DEAL_ITEM_VASSALAGE_REVOKE",
}
local isInteger = VoxDeorumDealUtils.IsInteger
local PENDING_TIMEOUT_SECONDS = 10

-- Return a data-only copy of a draft value.
local function copy(value) return VoxDeorumDealUtils.DeepCopy(value) end

-- Resolve the other principal in the mounted deal.
local function counterpartOf(playerID) return playerID == actorID and counterpartID or actorID end

-- Resolve one user-facing text key with optional substitutions.
local function text(key, ...) return Locale.ConvertTextKey(key, ...) end

-- Return normalized ordinary terms using the live duration constants.
local function normalizeItems(items) return VoxDeorumDealUtils.NormalizeItems(items, Game) end

-- Return normalized promises using the live duration constants.
local function normalizePromises(promises) return VoxDeorumDealUtils.NormalizePromises(promises, Game, GameDefines) end

-- Return a stable ordinary-term fingerprint.
local function itemFingerprint(items) return VoxDeorumDealUtils.ItemFingerprint(items, Game) end

-- Return a participant-aware scratch signature.
local function scratchSignature(items)
	return tostring(deal:GetFromPlayer()) .. ":" .. tostring(deal:GetToPlayer()) .. "\n" .. itemFingerprint(items)
end

-- Return whether one player is a living major civilization.
local function livingMajor(playerID)
	if not isInteger(playerID) or playerID < 0 or playerID >= GameDefines.MAX_MAJOR_CIVS then return false end
	local player = Players[playerID]
	return player ~= nil and player:IsAlive() and not player:IsMinorCiv() and not player:IsBarbarian()
end

-- Return whether the mounted effective seat is still current.
local function effectiveSeatIsCurrent()
	return actorID >= 0 and (mockMountAuthorized or VoxDeorumSeat.EffectiveSeat() == actorID)
end

-- Return whether the replaceable Stage 7.02 mock driver has opted out of live legality gates.
local function mockBypassesLegality()
	local driver = type(VoxDeorumDealUI) == "table" and VoxDeorumDealUI.driver or nil
	return mockMode and driver ~= nil and driver.bypassLegality == true
end

-- Set a localized or literal status message.
local function setStatus(text, literal)
	Controls.VoxStatusText:SetText(literal and tostring(text or "") or Locale.ConvertTextKey(text or ""))
end

-- Decode one native iterator tuple into a canonical ordinary item.
local function decodeItem(itemType, duration, _, data1, data2, data3, flag, fromPlayer)
	local toPlayer = counterpartOf(fromPlayer)
	local item = { fromPlayerID = fromPlayer, toPlayerID = toPlayer }
	if itemType == TradeableItems.TRADE_ITEM_GOLD then item.itemType, item.amount = "GOLD", data1
	elseif itemType == TradeableItems.TRADE_ITEM_GOLD_PER_TURN then item.itemType, item.amount, item.duration = "GOLD_PER_TURN", data1, duration
	elseif itemType == TradeableItems.TRADE_ITEM_MAPS then item.itemType = "MAPS"
	elseif itemType == TradeableItems.TRADE_ITEM_RESOURCES then item.itemType, item.resourceID, item.quantity, item.duration = "RESOURCES", data1, data2, duration
	elseif itemType == TradeableItems.TRADE_ITEM_CITIES then
		local plot, city = Map.GetPlot(data1, data2), nil
		if plot ~= nil then city = plot:GetPlotCity() end
		if city == nil or city:GetOwner() ~= fromPlayer then return nil end
		item.itemType, item.cityID = "CITIES", city:GetID()
	elseif itemType == TradeableItems.TRADE_ITEM_OPEN_BORDERS then item.itemType, item.duration = "OPEN_BORDERS", duration
	elseif itemType == TradeableItems.TRADE_ITEM_DEFENSIVE_PACT then item.itemType, item.duration = "DEFENSIVE_PACT", duration
	elseif itemType == TradeableItems.TRADE_ITEM_RESEARCH_AGREEMENT then item.itemType, item.duration = "RESEARCH_AGREEMENT", duration
	elseif itemType == TradeableItems.TRADE_ITEM_PEACE_TREATY then item.itemType, item.duration = "PEACE_TREATY", duration
	elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_PEACE then item.itemType, item.thirdPartyTeamID, item.duration = "THIRD_PARTY_PEACE", data1, duration
	elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_WAR then item.itemType, item.thirdPartyTeamID = "THIRD_PARTY_WAR", data1
	elseif itemType == TradeableItems.TRADE_ITEM_ALLOW_EMBASSY then item.itemType = "ALLOW_EMBASSY"
	elseif itemType == TradeableItems.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP then item.itemType, item.duration = "DECLARATION_OF_FRIENDSHIP", duration
	elseif itemType == TradeableItems.TRADE_ITEM_VOTE_COMMITMENT then item.itemType, item.resolutionID, item.voteChoice, item.numVotes, item.repeal = "VOTE_COMMITMENT", data1, data2, data3, flag
	elseif itemType == TradeableItems.TRADE_ITEM_TECHS then item.itemType, item.techID = "TECHS", data1
	elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE then item.itemType = "VASSALAGE"
	elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE_REVOKE then item.itemType = "VASSALAGE_REVOKE"
	else return nil end
	return VoxDeorumDealUtils.NormalizeItem(item, Game)
end

-- Decode every ordinary term in the shared native scratch deal.
local function decodeScratch()
	local items = {}
	deal:ResetIterator()
	while true do
		local itemType, duration, finalTurn, data1, data2, data3, flag, fromPlayer = deal:GetNextItem()
		if itemType == nil then break end
		local item = decodeItem(itemType, duration, finalTurn, data1, data2, data3, flag, fromPlayer)
		if item ~= nil then items[#items + 1] = item end
	end
	return normalizeItems(items)
end

-- Add one canonical term with human-to-human structural semantics.
local function addItem(item)
	local duration = VoxDeorumDealUtils.DurationForItem(item.itemType, Game)
	local from = item.fromPlayerID
	if item.itemType == "GOLD" then deal:AddGoldTrade(from, item.amount, true)
	elseif item.itemType == "GOLD_PER_TURN" then deal:AddGoldPerTurnTrade(from, item.amount, duration, true)
	elseif item.itemType == "MAPS" then deal:AddMapTrade(from, true)
	elseif item.itemType == "RESOURCES" then deal:AddResourceTrade(from, item.resourceID, item.quantity, duration, true)
	elseif item.itemType == "CITIES" then deal:AddCityTrade(from, item.cityID, true)
	elseif item.itemType == "OPEN_BORDERS" then deal:AddOpenBorders(from, duration, true)
	elseif item.itemType == "DEFENSIVE_PACT" then deal:AddDefensivePact(from, duration, true)
	elseif item.itemType == "RESEARCH_AGREEMENT" then deal:AddResearchAgreement(from, duration, true)
	elseif item.itemType == "PEACE_TREATY" then deal:AddPeaceTreaty(from, duration, true)
	elseif item.itemType == "THIRD_PARTY_PEACE" then deal:AddThirdPartyPeace(from, item.thirdPartyTeamID, duration, true)
	elseif item.itemType == "THIRD_PARTY_WAR" then deal:AddThirdPartyWar(from, item.thirdPartyTeamID, true)
	elseif item.itemType == "ALLOW_EMBASSY" then deal:AddAllowEmbassy(from, true)
	elseif item.itemType == "DECLARATION_OF_FRIENDSHIP" then deal:AddDeclarationOfFriendship(from, true)
	elseif item.itemType == "VOTE_COMMITMENT" then deal:AddVoteCommitment(from, item.resolutionID, item.voteChoice, item.numVotes, item.repeal or false, true)
	elseif item.itemType == "TECHS" then deal:AddTechTrade(from, item.techID, true)
	elseif item.itemType == "VASSALAGE" then deal:AddVassalageTrade(from, true)
	elseif item.itemType == "VASSALAGE_REVOKE" then deal:AddRevokeVassalageTrade(from, true)
	else return false end
	return true
end

-- Clear the scratch deal without leaving a stale expected signature.
local function clearScratch()
	rebuilding = true
	deal:ClearItems()
	rebuilding = false
	expectedSignature = nil
end

-- Validate and transactionally project ordinary terms into the shared scratch deal.
local function evaluateItems(items, retainScratch)
	local payload = { version = 1, items = items or {}, promises = {}, message = nil }
	local intended = normalizeItems(items)
	local availability = {}
	for index = 1, #intended do availability[index] = { available = true } end
	if not VoxDeorumDealUtils.ValidatePayload(payload, actorID, counterpartID) then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_MALFORMED_TERMS")
		for index = 1, #availability do availability[index] = { available = false, reason = reason } end
		clearScratch()
		return false, reason, nil, availability, nil
	end
	rebuilding = true
	deal:ClearItems(); deal:SetFromPlayer(actorID); deal:SetToPlayer(counterpartID)
	for index, item in ipairs(intended) do
		local before = deal:GetNumItems()
		if not addItem(item) or deal:GetNumItems() == before then
			local reason = text("TXT_KEY_VD_DEAL_ERROR_ITEM_UNAVAILABLE", text(itemNameKeys[item.itemType] or "TXT_KEY_VD_DEAL_ITEM_TERM"))
			availability[index] = { available = false, reason = reason }
			rebuilding = false; clearScratch()
			return false, reason, nil, availability, nil
		end
	end
	rebuilding = false
	local decoded = decodeScratch()
	if scratchSignature(decoded) ~= tostring(actorID) .. ":" .. tostring(counterpartID) .. "\n" .. itemFingerprint(intended) then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_NATIVE_DRAFT_CHANGED")
		clearScratch(); return false, reason, nil, availability, reason
	end
	local ok, valid = pcall(deal.AreAllTradeItemsValid, deal, true)
	if not ok or valid ~= true then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_COMBINATION")
		clearScratch(); return false, reason, nil, availability, reason
	end
	if retainScratch then expectedSignature = scratchSignature(decoded) else clearScratch() end
	return true, nil, decoded, availability, nil
end

-- Safely invoke a player binding and distinguish unavailable APIs from false results.
local function playerCall(player, method, ...)
	if player == nil or type(player[method]) ~= "function" then return false, nil end
	local ok, value = pcall(player[method], player, ...)
	return ok, value
end

-- Safely invoke a team binding and distinguish unavailable APIs from false results.
local function teamCall(team, method, ...)
	if team == nil or type(team[method]) ~= "function" then return false, nil end
	local ok, value = pcall(team[method], team, ...)
	return ok, value
end

-- Return a stable logical commitment key, collapsing Coop War twins.
local function commitmentKey(promise)
	if promise.promiseType == "COOP_WAR" then return "COOP_WAR:" .. tostring(promise.targetPlayerID) end
	return promise.promiseType .. ":" .. tostring(promise.promiserID) .. ":" .. tostring(promise.recipientID)
end

-- Validate every promise and return an explanatory reason for the first failure.
local function evaluatePromises(promises)
	local normalized, availability, seen = normalizePromises(promises), {}, {}
	for index = 1, #normalized do availability[index] = { available = true } end
	local allAvailable, firstReason = true, nil
	-- Mark one logical promise unavailable without hiding failures on later rows.
	local function fail(index, reason)
		availability[index] = { available = false, reason = reason }
		allAvailable, firstReason = false, firstReason or reason
	end
	if not effectiveSeatIsCurrent() or not livingMajor(actorID) or not livingMajor(counterpartID) then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_ACTOR_UNAVAILABLE")
		for index = 1, #normalized do fail(index, reason) end
		return false, reason, normalized, availability
	end
	if mockBypassesLegality() then return true, nil, normalized, availability end
	for index, promise in ipairs(normalized) do
		local kind = promise.promiseType
		local expectedDuration = promiseKeys[kind] ~= nil and VoxDeorumDealUtils.DurationForPromise(kind, Game, GameDefines) or nil
		if promiseKeys[kind] == nil then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_TYPE"))
		elseif kind == "NO_DIGGING" and promise.duration ~= nil then fail(index, text("TXT_KEY_VD_DEAL_ERROR_NO_DIGGING_DURATION"))
		elseif promiseDurationKinds[kind] and (expectedDuration == nil or promise.duration ~= expectedDuration) then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_DURATION")) end
		if not ((promise.promiserID == actorID and promise.recipientID == counterpartID) or (promise.promiserID == counterpartID and promise.recipientID == actorID)) then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_PARTICIPANTS")) end
		local key = commitmentKey(promise)
		local direction = tostring(promise.promiserID) .. ":" .. tostring(promise.recipientID)
		seen[key] = seen[key] or {}
		if seen[key][direction] then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_DUPLICATE")) end
		seen[key][direction] = true
		local recipient = Players[promise.recipientID]
		if kind == "MILITARY" or kind == "EXPANSION" or kind == "BORDER" then
			local method = "GetNumTurns" .. string.sub(kind, 1, 1) .. string.lower(string.sub(kind, 2)) .. "Promise"
			local apiOK, turns = playerCall(recipient, method, promise.promiserID)
			if not apiOK or type(turns) ~= "number" then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_STATE"))
			elseif turns >= 0 then fail(index, text("TXT_KEY_VD_DEAL_ERROR_PROMISE_ACTIVE")) end
		elseif kind == "COOP_WAR" then
			local target = promise.targetPlayerID
			if not livingMajor(target) or target == actorID or target == counterpartID then
				fail(index, text("TXT_KEY_VD_DEAL_ERROR_COOP_TARGET_INVALID"))
			else
				local actorTeamOK, actorTeamID = playerCall(Players[actorID], "GetTeam")
				local counterpartTeamOK, counterpartTeamID = playerCall(Players[counterpartID], "GetTeam")
				local targetTeamOK, targetTeamID = playerCall(Players[target], "GetTeam")
				local actorContactOK, actorMet = false, false
				local counterpartContactOK, counterpartMet = false, false
				if actorTeamOK and targetTeamOK then actorContactOK, actorMet = teamCall(Teams[actorTeamID], "IsHasMet", targetTeamID) end
				if counterpartTeamOK and targetTeamOK then counterpartContactOK, counterpartMet = teamCall(Teams[counterpartTeamID], "IsHasMet", targetTeamID) end
				if not actorContactOK or not counterpartContactOK or not actorMet or not counterpartMet then fail(index, text("TXT_KEY_VD_DEAL_ERROR_COOP_TARGET_CONTACT")) end
				local firstOK, first = playerCall(Players[actorID], "IsValidCoopWarTarget", target, false)
				local secondOK, second = playerCall(Players[counterpartID], "IsValidCoopWarTarget", target, false)
				if not firstOK or not secondOK or not first or not second then fail(index, text("TXT_KEY_VD_DEAL_ERROR_COOP_TARGET_UNAVAILABLE")) end
				local preparing = type(CoopWarStates) == "table" and CoopWarStates.COOP_WAR_STATE_PREPARING or nil
				local stateOKa, stateA = playerCall(Players[actorID], "GetCoopWarAcceptedState", counterpartID, target)
				local stateOKb, stateB = playerCall(Players[counterpartID], "GetCoopWarAcceptedState", actorID, target)
				if preparing == nil or not stateOKa or not stateOKb then fail(index, text("TXT_KEY_VD_DEAL_ERROR_COOP_STATE"))
				elseif stateA == preparing or stateB == preparing then fail(index, text("TXT_KEY_VD_DEAL_ERROR_COOP_PREPARING")) end
			end
		end
	end
	return allAvailable, firstReason, normalized, availability
end

-- Localize a database row without trusting optional display fields.
local function databaseName(row, fallback)
	if row == nil then return fallback end
	local key = row.Description or row.ShortDescription or row.Type
	if key == nil then return fallback end
	local ok, value = pcall(Locale.ConvertTextKey, key)
	return ok and value or fallback
end

-- Resolve a player display name without letting a missing binding break review.
local function playerName(playerID)
	local player = Players[playerID]
	local ok, value = playerCall(player, "GetName")
	return ok and type(value) == "string" and value ~= "" and value or text("TXT_KEY_VD_DEAL_FALLBACK_PLAYER", playerID)
end

-- Resolve a representative major-civilization name for a team.
local function teamName(teamID)
	for playerID = 0, (GameDefines.MAX_MAJOR_CIVS or 0) - 1 do
		local ok, currentTeam = playerCall(Players[playerID], "GetTeam")
		if ok and currentTeam == teamID then return playerName(playerID) end
	end
	return text("TXT_KEY_VD_DEAL_FALLBACK_TEAM", teamID)
end

-- Append a duration to one immutable term label.
local function withDuration(label, duration)
	if duration == nil then return label end
	return label .. text("TXT_KEY_VD_DEAL_DURATION", duration)
end

-- Find a live league proposal name for a vote commitment.
local function resolutionName(item)
	if type(Game.GetActiveLeague) ~= "function" then return text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID) end
	local leagueOK, league = pcall(Game.GetActiveLeague)
	if not leagueOK or league == nil then return text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID) end
	local method = item.repeal and "GetRepealProposals" or "GetEnactProposals"
	if type(league[method]) ~= "function" then return text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID) end
	local proposalsOK, proposals = pcall(league[method], league)
	if not proposalsOK or type(proposals) ~= "table" then return text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID) end
	for _, proposal in ipairs(proposals) do
		if proposal.ID == item.resolutionID then return databaseName(GameInfo.Resolutions[proposal.Type], text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID)) end
	end
	return text("TXT_KEY_VD_DEAL_FALLBACK_RESOLUTION", item.resolutionID)
end

-- Format every canonical ordinary item with its identifying live details.
local function itemLabel(item)
	local label = text(itemNameKeys[item.itemType] or "TXT_KEY_VD_DEAL_ITEM_TERM")
	if item.itemType == "GOLD" then label = label .. ": " .. tostring(item.amount)
	elseif item.itemType == "GOLD_PER_TURN" then label = label .. ": " .. tostring(item.amount)
	elseif item.itemType == "RESOURCES" then label = databaseName(GameInfo.Resources[item.resourceID], text("TXT_KEY_VD_DEAL_FALLBACK_RESOURCE", item.resourceID)) .. ": " .. tostring(item.quantity)
	elseif item.itemType == "CITIES" then
		local cityOK, city = playerCall(Players[item.fromPlayerID], "GetCityByID", item.cityID)
		local nameOK, name = false, nil
		if cityOK then nameOK, name = playerCall(city, "GetName") end
		label = nameOK and name or (label .. ": " .. tostring(item.cityID))
	elseif item.itemType == "THIRD_PARTY_PEACE" or item.itemType == "THIRD_PARTY_WAR" then label = label .. ": " .. teamName(item.thirdPartyTeamID)
	elseif item.itemType == "TECHS" then label = databaseName(GameInfo.Technologies[item.techID], text("TXT_KEY_VD_DEAL_FALLBACK_TECHNOLOGY", item.techID))
	elseif item.itemType == "VOTE_COMMITMENT" then
		label = resolutionName(item) .. text("TXT_KEY_VD_DEAL_VOTE_DETAIL", item.voteChoice, item.numVotes, text(item.repeal and "TXT_KEY_VD_DEAL_VOTE_REPEAL" or "TXT_KEY_VD_DEAL_VOTE_ENACT"))
	end
	return withDuration(label, item.duration)
end

-- Return a complete readable promise row label.
local function promiseLabel(promise)
	local label = Locale.ConvertTextKey(promiseKeys[promise.promiseType])
	if promise.targetPlayerID ~= nil then label = label .. ": " .. playerName(promise.targetPlayerID) end
	return withDuration(label, promise.duration)
end

-- Recalculate wrapper stacks after their contents change.
local function calculateWrapperStacks()
	Controls.VoxReviewStack:CalculateSize(); Controls.VoxReviewStack:ReprocessAnchoring(); Controls.VoxReviewPanel:CalculateInternalSize()
	Controls.VoxPromiseTableStack:CalculateSize(); Controls.VoxPromiseTableStack:ReprocessAnchoring(); Controls.VoxPromiseTablePanel:CalculateInternalSize()
	Controls.VoxUsPromisePocketStack:CalculateSize(); Controls.VoxUsPromisePocketStack:ReprocessAnchoring(); Controls.VoxUsPromisePocketPanel:CalculateInternalSize()
	Controls.VoxThemPromisePocketStack:CalculateSize(); Controls.VoxThemPromisePocketStack:ReprocessAnchoring(); Controls.VoxThemPromisePocketPanel:CalculateInternalSize()
	Controls.VoxTargetStack:CalculateSize(); Controls.VoxTargetStack:ReprocessAnchoring(); Controls.VoxTargetPanel:CalculateInternalSize()
end

-- Render immutable proposal terms without consulting the scratch deal.
local function renderReview(items, promises, itemAvailability, promiseAvailability, combinationReason)
	reviewIM:ResetInstances()
	-- Add one two-column row with visible unavailable styling.
	local function addRow(us, them, reason)
		local row = reviewIM:GetInstance()
		row.UsLabel:SetText(us or ""); row.ThemLabel:SetText(them or "")
		row.StatusLabel:SetText(reason ~= nil and "[COLOR_NEGATIVE_TEXT]" .. text("TXT_KEY_VD_DEAL_STATUS_UNAVAILABLE") .. "[ENDCOLOR]" or "")
		row.Unavailable:SetHide(reason == nil)
		row.Container:SetToolTipString(reason or "")
	end
	for index, item in ipairs(items) do
		local availability = itemAvailability and itemAvailability[index]
		local reason = availability and not availability.available and availability.reason or nil
		local text = itemLabel(item)
		if item.fromPlayerID == actorID then addRow(text, nil, reason) else addRow(nil, text, reason) end
	end
	local shownCoop = {}
	for index, promise in ipairs(promises) do
		local key = promise.promiseType == "COOP_WAR" and commitmentKey(promise) or nil
		if key == nil or not shownCoop[key] then
			if key ~= nil then shownCoop[key] = true end
			local availability = promiseAvailability and promiseAvailability[index]
			local reason = availability and not availability.available and availability.reason or nil
			if key ~= nil then
				for twinIndex, twin in ipairs(promises) do
					local twinAvailability = commitmentKey(twin) == key and promiseAvailability and promiseAvailability[twinIndex] or nil
					if twinAvailability and not twinAvailability.available then reason = twinAvailability.reason break end
				end
			end
			if promise.promiserID == actorID then addRow(promiseLabel(promise), nil, reason) else addRow(nil, promiseLabel(promise), reason) end
		end
	end
	if combinationReason ~= nil then addRow(text("TXT_KEY_VD_DEAL_REVIEW_COMBINATION"), nil, combinationReason) end
	calculateWrapperStacks()
end

-- Begin selecting a promise type from one side of the editor.
local function addPromise(promiser, index)
	if pending or mode == "incoming" or mode == "own" then return end
	local kind = promiseKinds[index]
	if kind == "COOP_WAR" then targetPromiserID = promiser; refresh(); return end
	local candidate = copy(draftPromises)
	candidate[#candidate + 1] = { promiserID = promiser, recipientID = counterpartOf(promiser), promiseType = kind }
	local ok, reason, normalized = evaluatePromises(candidate)
	if ok then draftPromises = normalized else setStatus(reason, true) end
	refresh()
end

-- Add a selected cooperative-war promise pair.
local function chooseCoopTarget(target)
	if targetPromiserID == nil then return end
	local candidate = copy(draftPromises)
	candidate[#candidate + 1] = { promiserID = targetPromiserID, recipientID = counterpartOf(targetPromiserID), promiseType = "COOP_WAR", targetPlayerID = target }
	local ok, reason, normalized = evaluatePromises(candidate)
	if ok then draftPromises = normalized else setStatus(reason, true) end
	targetPromiserID = nil
	refresh()
end

-- Append one candidate promise to the current editor draft.
local function candidatePromises(promiserID, promiseType, targetPlayerID)
	local candidate = copy(draftPromises)
	candidate[#candidate + 1] = { promiserID = promiserID, recipientID = counterpartOf(promiserID), promiseType = promiseType, targetPlayerID = targetPlayerID }
	return candidate
end

-- Remove a visible promise, including the normalized cooperative-war twin.
local function removePromise(index)
	if pending or mode == "incoming" or mode == "own" then return end
	local selected, kept = draftPromises[index], {}
	if selected == nil then return end
	for _, promise in ipairs(draftPromises) do
		if promise ~= selected and not (selected.promiseType == "COOP_WAR" and promise.promiseType == "COOP_WAR" and promise.targetPlayerID == selected.targetPlayerID) then kept[#kept + 1] = promise end
	end
	draftPromises = normalizePromises(kept)
	refresh()
end

-- Cache Coop War target legality once for this refresh across both promise sides.
local function cacheCoopWarTargetAvailability()
	coopWarTargetAvailability = { [actorID] = {}, [counterpartID] = {} }
	for _, promiserID in ipairs({ actorID, counterpartID }) do
		for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
			if livingMajor(playerID) and playerID ~= actorID and playerID ~= counterpartID then
				local available, reason = evaluatePromises(candidatePromises(promiserID, "COOP_WAR", playerID))
				coopWarTargetAvailability[promiserID][playerID] = { available = available, reason = reason }
			end
		end
	end
end

-- Return whether one promise side has a cached legal Coop War target.
local function coopWarChoiceAvailability(promiserID)
	local targets, reason = coopWarTargetAvailability[promiserID] or {}, text("TXT_KEY_VD_DEAL_ERROR_NO_COOP_TARGET")
	for _, availability in pairs(targets) do
		if availability.available then return true, nil end
		reason = availability.reason or reason
	end
	return false, reason
end

-- Render promise controls for the current editor state.
local function renderPromiseEditor()
	local editable = mounted and (mode == "author" or mode == "counter") and not pending
	for _, setup in ipairs({ { usPromiseIM, actorID }, { themPromiseIM, counterpartID } }) do
		setup[1]:ResetInstances()
		for index, kind in ipairs(promiseKinds) do
			local instance = setup[1]:GetInstance()
			local choiceOK, choiceReason = false, text("TXT_KEY_VD_DEAL_ERROR_NO_COOP_TARGET")
			if kind == "COOP_WAR" then
				choiceOK, choiceReason = coopWarChoiceAvailability(setup[2])
			else choiceOK, choiceReason = evaluatePromises(candidatePromises(setup[2], kind)) end
			local enabled = editable and choiceOK
			instance.Label:SetText(Locale.ConvertTextKey(promiseKeys[kind])); instance.Button:SetVoids(setup[2], index); instance.Button:SetDisabled(not enabled)
			instance.Button:SetToolTipString(enabled and "" or choiceReason)
			instance.Button:RegisterCallback(Mouse.eLClick, addPromise)
		end
	end
	promiseIM:ResetInstances()
	local seen = {}
	for index, promise in ipairs(draftPromises) do
		local key = promise.promiseType == "COOP_WAR" and commitmentKey(promise) or tostring(index)
		if not seen[key] then
			seen[key] = true
			local instance = promiseIM:GetInstance()
			instance.Label:SetText(promiseLabel(promise)); instance.Duration:SetText(tostring(promise.duration or "")); instance.Button:SetVoid1(index); instance.Button:SetDisabled(not editable)
			instance.Button:RegisterCallback(Mouse.eLClick, removePromise)
		end
	end
	targetIM:ResetInstances()
	if targetPromiserID ~= nil then
		for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
			if livingMajor(playerID) and playerID ~= actorID and playerID ~= counterpartID then
				local availability = coopWarTargetAvailability[targetPromiserID] and coopWarTargetAvailability[targetPromiserID][playerID] or nil
				local targetOK = availability and availability.available or false
				local targetReason = availability and availability.reason or text("TXT_KEY_VD_DEAL_ERROR_NO_COOP_TARGET")
				local instance = targetIM:GetInstance()
				instance.Label:SetText(playerName(playerID)); instance.Button:SetVoid1(playerID); instance.Button:SetDisabled(not targetOK)
				instance.Button:SetToolTipString(targetOK and "" or targetReason); instance.Button:RegisterCallback(Mouse.eLClick, chooseCoopTarget)
			end
		end
	end
	calculateWrapperStacks()
end

-- Configure a native footer button for one wrapper action.
local function configureButton(control, textKey, action, visible, enabled)
	control:SetHide(not visible); control:SetText(visible and Locale.ConvertTextKey(textKey) or ""); control:SetVoid1(action or -1); control:SetDisabled(not enabled)
end

-- Render footer, interaction blocker, and wrapper-owned controls.
refresh = function(skipScratchProjection)
	if not mounted then return end
	local editing = mode == "author" or mode == "counter"
	local itemsOK, itemAvailability, combinationReason = true, {}, nil
	if skipScratchProjection and editing then
		for index = 1, #draftItems do itemAvailability[index] = { available = true } end
	else
		itemsOK, _, _, itemAvailability, combinationReason = evaluateItems(editing and draftItems or baselineItems, editing)
	end
	local promisesOK, _, _, promiseAvailability = evaluatePromises(editing and draftPromises or baselinePromises)
	if mockBypassesLegality() then
		itemsOK, combinationReason = true, nil
		for index = 1, #(editing and draftItems or baselineItems) do itemAvailability[index] = { available = true } end
	end
	local review = not editing
	if editing then cacheCoopWarTargetAvailability() else coopWarTargetAvailability = {} end
	Controls.InteractionBlocker:SetHide(not review and not pending)
	Controls.VoxPendingCover:SetHide(not pending)
	Controls.VoxTargetFrame:SetHide(not editing or targetPromiserID == nil)
	Controls.VoxReviewPanel:SetHide(not review)
	Controls.VoxPromiseFrame:SetHide(not editing)
	Controls.VoxStatusFrame:SetHide(false)
	Controls.VoxMessageFrame:SetHide(not editing)
	Controls.VoxMessageInput:SetDisabled(not editing or pending)
	Controls.WhatDoYouWantButton:SetHide(true); Controls.WhatWillYouGiveMeButton:SetHide(true)
	Controls.WhatWillMakeThisWorkButton:SetHide(true); Controls.WhatWillEndThisWarButton:SetHide(true)
	Controls.WhatConcessionsButton:SetHide(true); Controls.DenounceButton:SetHide(true)
	if review then renderReview(baselineItems, baselinePromises, itemAvailability, promiseAvailability, combinationReason) else renderPromiseEditor() end
	local terms = #draftItems + #draftPromises > 0
	if mode == "author" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_PROPOSE", 1, true, not pending and effectiveSeatIsCurrent() and itemsOK and promisesOK and terms)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", 2, true, not pending)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	elseif mode == "counter" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", 4, true, not pending and effectiveSeatIsCurrent() and itemsOK and promisesOK and terms)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_BACK", 7, true, not pending)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	elseif mode == "incoming" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_ACCEPT", 3, true, not pending and effectiveSeatIsCurrent() and itemsOK and promisesOK)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", 4, true, not pending and effectiveSeatIsCurrent() and itemsOK and promisesOK)
		configureButton(Controls.VoxThirdAction, "TXT_KEY_VD_DEAL_ACTION_REJECT", 5, true, not pending and effectiveSeatIsCurrent())
	else
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", 4, true, not pending and effectiveSeatIsCurrent() and itemsOK and promisesOK)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_RETRACT", 6, true, not pending and effectiveSeatIsCurrent())
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	end
	Controls.VoxFooterStack:CalculateSize(); Controls.VoxFooterStack:ReprocessAnchoring()
end

-- Recover the editor draft if another caller has reused the global scratch deal.
local function recoverClobber()
	if not mounted or pending or rebuilding or (mode ~= "author" and mode ~= "counter") or expectedSignature == nil then return end
	if scratchSignature(decodeScratch()) ~= expectedSignature then
		evaluateItems(draftItems, true)
		DisplayDeal(); DoUpdateButtons()
	end
end

-- Serialize only client-owned DealPayload fields.
local function serializeDraft()
	local message = VoxDeorumDealUtils.SanitizeMessage(outgoingMessage)
	return { version = 1, items = copy(normalizeItems(draftItems)), promises = copy(normalizePromises(draftPromises)), message = message ~= "" and message or nil }
end

-- Clear mounted state and return focus to the conversation panel.
local function resetMountState()
	actorID, counterpartID, mode, reviewMode, proposalMessageID = -1, -1, nil, nil, nil
	baselineItems, baselinePromises, draftItems, draftPromises = {}, {}, {}, {}
	originalMessage, outgoingMessage, expectedSignature = "", "", nil
	mounted, pending, nativeRedrawInProgress, targetPromiserID = false, false, false, nil
	pendingSeconds, clobberSeconds = 0, 0
	mockMountAuthorized, mockMode, coopWarTargetAvailability = false, false, {}
	Controls.VoxTargetFrame:SetHide(true)
end

-- Clear mounted state and return focus to the conversation panel.
local function closeScreen()
	clearScratch(); ContextPtr:ClearUpdate()
	-- Dequeue before the restore event so the panel's re-queue ends up on top.
	if queuedAsPopup then queuedAsPopup = false; UIManager:DequeuePopup(ContextPtr) end
	ContextPtr:SetHide(true)
	resetMountState()
	LuaEvents.VoxDeorumDiploPanelRestoreAfterDeal(nil, false)
end

-- Enter a pending state and call the transport-replaceable local driver.
local function dispatch(action)
	if pending then return end
	if not mounted then return end
	if action == "cancel" then closeScreen(); return end
	if action == "back" then
		clearScratch(); targetPromiserID, mode = nil, reviewMode or "author"
		refresh(); return
	end
	if not effectiveSeatIsCurrent() then setStatus("TXT_KEY_VD_DEAL_ERROR_ACTOR_CHANGED"); return end
	local bypassLegality = mockBypassesLegality()
	local packet = { kind = action }
	if action == "propose" or (action == "counter" and (mode == "author" or mode == "counter")) then
		local itemsOK, itemReason = evaluateItems(draftItems, true)
		local promisesOK, promiseReason = evaluatePromises(draftPromises)
		if not itemsOK and not bypassLegality then setStatus(itemReason, true); return end
		if not promisesOK and not bypassLegality then setStatus(promiseReason, true); return end
		if #draftItems + #draftPromises == 0 then setStatus("TXT_KEY_VD_DEAL_ERROR_EMPTY"); return end
		packet.deal = serializeDraft()
		if action == "counter" then packet.expectedProposalID = proposalMessageID end
	elseif action == "accept" or action == "counter" then
		local itemsOK, itemReason, decoded = evaluateItems(baselineItems, action == "counter")
		local promisesOK, promiseReason = evaluatePromises(baselinePromises)
		if not itemsOK and not bypassLegality then setStatus(itemReason, true); return end
		if not promisesOK and not bypassLegality then setStatus(promiseReason, true); return end
		if action == "counter" then
			draftItems, draftPromises, outgoingMessage, mode = decoded or normalizeItems(baselineItems), copy(baselinePromises), "", "counter"
			Controls.VoxMessageInput:SetText(""); refresh(true)
			nativeRedrawInProgress = true; DisplayDeal(); DoUpdateButtons(); nativeRedrawInProgress = false
			return
		end
		packet.proposalMessageID = proposalMessageID
	elseif action == "reject" or action == "retract" then packet.proposalMessageID = proposalMessageID end
	pending, pendingSeconds = true, 0; setStatus("TXT_KEY_VD_DEAL_STATUS_PENDING"); refresh()
	local driver = VoxDeorumDealUI.driver
	if driver ~= nil and type(driver.onAction) == "function" then
		local driverOK, driverError = pcall(driver.onAction, packet)
		if not driverOK then VoxDeorumDealUI.resolve({ success = false, reason = tostring(driverError) }) end
	else VoxDeorumDealUI.resolve({ success = false, reason = text("TXT_KEY_VD_DEAL_ERROR_NO_DRIVER") }) end
end

-- Map a footer void value to the canonical driver action vocabulary.
local function onButton(index)
	local actions = { [1] = "propose", [2] = "cancel", [3] = "accept", [4] = "counter", [5] = "reject", [6] = "retract", [7] = "back" }
	if actions[index] ~= nil then dispatch(actions[index]) end
end

-- Keep the outgoing message safe for named-pipe serialization.
local function onMessageChanged()
	if settingMessage then return end
	local raw, clean = Controls.VoxMessageInput:GetText(), VoxDeorumDealUtils.StripDelimiter(Controls.VoxMessageInput:GetText())
	if raw ~= clean then settingMessage = true; Controls.VoxMessageInput:SetText(clean); settingMessage = false end
	outgoingMessage = clean
end

-- Resolve one driver result while preserving the mounted editor or review on error.
local function resolve(result)
	if not mounted or not pending then return end
	if result ~= nil and result.success == true then closeScreen(); return end
	pending = false; setStatus(result and result.reason or text("TXT_KEY_VD_DEAL_ERROR_ACTION_FAILED"), true)
	refresh()
	if mode == "author" or mode == "counter" then DisplayDeal(); DoUpdateButtons() end
end

-- Advance pending animation, detect scratch clobbers, and service the mock driver.
local function onUpdate(delta)
	if not mounted then return end
	if pending then
		pendingSeconds = pendingSeconds + delta
		if pendingSeconds >= PENDING_TIMEOUT_SECONDS then
			resolve({ success = false, reason = text("TXT_KEY_VD_DEAL_ERROR_TIMEOUT") })
			return
		end
		setStatus(text("TXT_KEY_VD_DEAL_STATUS_PENDING") .. string.rep(".", math.floor(pendingSeconds / 0.35) % 4), true)
	else
		clobberSeconds = clobberSeconds + delta
		if clobberSeconds >= 0.25 then clobberSeconds = 0; recoverClobber() end
	end
	local driver = VoxDeorumDealUI.driver
	if driver ~= nil and type(driver.onUpdate) == "function" then driver.onUpdate(delta) end
end

-- Mount one validated request for an explicitly authorized native actor.
local function mount(request, mountActorID, isMockMount, allowMockAuthorization)
	if type(request) ~= "table" or (request.mode ~= "author" and request.mode ~= "incoming" and request.mode ~= "own") then return end
	if not isInteger(mountActorID) or not isInteger(request.counterpartID) or not livingMajor(mountActorID) or not livingMajor(request.counterpartID) or request.counterpartID == mountActorID then return end
	if (request.mode == "incoming" or request.mode == "own") and (not isInteger(request.proposalMessageID) or request.proposalMessageID < 0 or not VoxDeorumDealUtils.ValidatePayload(request.deal, mountActorID, request.counterpartID)) then return end
	if request.mode == "author" and request.deal ~= nil then return end
	if mounted then closeScreen() end
	actorID, counterpartID, mode, reviewMode, proposalMessageID = mountActorID, request.counterpartID, request.mode, request.mode, request.proposalMessageID
	mockMode, mockMountAuthorized = isMockMount == true, allowMockAuthorization == true
	local source = request.deal or { version = 1, items = {}, promises = {} }
	baselineItems, baselinePromises = normalizeItems(source.items), normalizePromises(source.promises)
	draftItems, draftPromises = copy(baselineItems), copy(baselinePromises)
	originalMessage, outgoingMessage, mounted, pending = VoxDeorumDealUtils.SanitizeMessage(source.message), "", true, false
	if type(VoxDeorumOpenDeal) ~= "function" or VoxDeorumOpenDeal(actorID, counterpartID) ~= true then clearScratch(); resetMountState(); return end
	if mode == "author" then draftItems = decodeScratch() end
	LuaEvents.VoxDeorumDiploPanelDemoteForDeal(); Controls.DiscussionText:SetText(originalMessage)
	settingMessage = true; Controls.VoxMessageInput:SetText(""); settingMessage = false
	-- Present as a popup so the screen renders above the leaderhead scene (the TradeLogic pattern).
	if not queuedAsPopup then queuedAsPopup = true; UIManager:QueuePopup(ContextPtr, PopupPriority.LeaderTrade) end
	ContextPtr:SetHide(false); ContextPtr:SetUpdate(onUpdate); refresh()
	local driver = VoxDeorumDealUI.driver
	if driver ~= nil and type(driver.onOpen) == "function" then driver.onOpen(request) end
end

-- Mount a live request only for the current effective seat.
local function open(request)
	local seat = VoxDeorumSeat.EffectiveSeat()
	if not isInteger(seat) or not livingMajor(seat) then return end
	mount(request, seat, false, false)
end

-- Mount a mock request for a vetted native actor without widening the public event contract.
local function openMock(request, demoActorID)
	local seat = VoxDeorumSeat.EffectiveSeat()
	local seatSupportsNative = isInteger(seat) and livingMajor(seat)
	if seatSupportsNative and demoActorID ~= seat then return end
	if not isInteger(demoActorID) or not livingMajor(demoActorID) then return end
	mount(request, demoActorID, true, not seatSupportsNative)
end

-- Keep Escape within the wrapper without invoking stock diplomacy exits.
local function onInput(message, key)
	if message == KeyEvents.KeyDown and key == Keys.VK_ESCAPE and mounted then
		if not pending then closeScreen() end
		return true
	end
	return false
end

-- Reclaim native footer state after every Vox-only TradeLogic refresh.
local function onTradeLogicUpdate()
	if mounted then
		if mode == "author" or mode == "counter" then
			if not nativeRedrawInProgress then draftItems = decodeScratch(); expectedSignature = scratchSignature(draftItems) end
			refresh(nativeRedrawInProgress)
		else refresh() end
	end
end

if GenerationalInstanceManager == nil then error("Vox Deorum requires the EUI GenerationalInstanceManager.") end
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onButton)
Controls.CancelButton:RegisterCallback(Mouse.eLClick, onButton)
Controls.VoxThirdAction:RegisterCallback(Mouse.eLClick, onButton)
Controls.VoxMessageInput:RegisterCallback(onMessageChanged)
ContextPtr:SetInputHandler(onInput)
-- Chain the native trade handler installed by include("TradeLogic"); popup-stack
-- hides must re-arm the per-frame update without re-running open/close logic.
local nativeTradeShowHide = OnShowHide
ContextPtr:SetShowHideHandler(function(isHide, isInit)
	nativeTradeShowHide(isHide, isInit)
	if isInit then return end
	if isHide then ContextPtr:ClearUpdate()
	elseif mounted then ContextPtr:SetUpdate(onUpdate) end
end)
LuaEvents.VoxDeorumOpenDealScreen.Add(open)
LuaEvents.VoxDeorumDealActionResolved.Add(resolve)
LuaEvents.VoxDeorumTradeLogicUpdateButtons.Add(onTradeLogicUpdate)
VoxDeorumDealUI = { driver = {}, onAction = dispatch, resolve = resolve, open = open, openMock = openMock, close = closeScreen }

include("VoxDeorumDealScreenMock")
