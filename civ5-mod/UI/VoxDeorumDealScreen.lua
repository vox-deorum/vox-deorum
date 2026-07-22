-- Vox Deorum wrapper for the native VP deal editor.

include("VoxDeorumSeat")
include("VoxDeorumDealUtils")
include("InstanceManager")
include("TradeLogic")

if Events.ClearDiplomacyTradeTable.Remove ~= nil and type(DoClearDeal) == "function" then Events.ClearDiplomacyTradeTable.Remove(DoClearDeal) end
ContextPtr:SetHide(true)

local deal = UI.GetScratchDeal()
local actorID, counterpartID, mode, proposalMessageID = -1, -1, nil, nil
local baselineItems, baselinePromises, draftItems, draftPromises = {}, {}, {}, {}
local baselineProjectionFailures, draftProjectionFailures, combinationReason = {}, {}, nil
local originalMessage, outgoingMessage, expectedSignature, mountFingerprint, lastStatus = "", "", nil, nil, ""
local mounted, pending, rebuilding, settingMessage, nativeRedrawInProgress, mountingInProgress, validationTooltipDismissed, mockMountAuthorized, mockMode = false, false, false, false, false, false, false, false, false
local queuedAsPopup = false
local pendingSeconds, clobberSeconds, targetPromiserID = 0, 0, nil
local coopWarTargetAvailability = {}
local refresh
local usPromiseIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxUsPocketPromiseStack)
local themPromiseIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxThemPocketPromiseStack)
local usPromiseTableIM = InstanceManager:new("VoxPromiseTableEntry", "Container", Controls.VoxUsTablePromiseStack)
local themPromiseTableIM = InstanceManager:new("VoxPromiseTableEntry", "Container", Controls.VoxThemTablePromiseStack)
local usCoopTargetIM = InstanceManager:new("VoxPromiseTargetEntry", "Button", Controls.VoxUsPocketCoopWarStack)
local themCoopTargetIM = InstanceManager:new("VoxPromiseTargetEntry", "Button", Controls.VoxThemPocketCoopWarStack)

local promiseKeys = {
	MILITARY = "TXT_KEY_VD_DEAL_PROMISE_MILITARY", EXPANSION = "TXT_KEY_VD_DEAL_PROMISE_EXPANSION",
	BORDER = "TXT_KEY_VD_DEAL_PROMISE_BORDER", NO_DIGGING = "TXT_KEY_VD_DEAL_PROMISE_NO_DIGGING",
	COOP_WAR = "TXT_KEY_VD_DEAL_PROMISE_COOP_WAR",
}
local promiseKinds = { "MILITARY", "EXPANSION", "BORDER", "NO_DIGGING", "COOP_WAR" }
local promiseDurationKinds = { MILITARY = true, EXPANSION = true, BORDER = true, COOP_WAR = true }
local footerActions = { propose = 1, cancel = 2, accept = 3, counter = 4, reject = 5, retract = 6, reset = 7 }
local buttonActions = {}
for action, index in pairs(footerActions) do buttonActions[index] = action end
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

-- Return a stable item-and-promise fingerprint that excludes the outgoing message.
local function semanticFingerprint(items, promises)
	return VoxDeorumDealUtils.SemanticFingerprint(items, promises, Game, GameDefines)
end

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

-- Store and display a localized or literal action status message.
local function setStatus(value, literal)
	lastStatus = literal and tostring(value or "") or Locale.ConvertTextKey(value or "")
	Controls.VoxStatusText:SetText(lastStatus)
	Controls.VoxStatusFrame:SetHide(lastStatus == "")
end

-- Permanently clear the mounted proposal's validation tooltip after its first edit.
local function dismissValidationTooltip()
	if validationTooltipDismissed then return end
	validationTooltipDismissed = true
	Controls.VoxStatusFrame:SetToolTipString("")
	local wasHidden = Controls.VoxStatusFrame:IsHidden()
	Controls.VoxStatusFrame:SetHide(true)
	if not wasHidden then Controls.VoxStatusFrame:SetHide(false) end
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

-- Project ordinary terms into the scratch deal according to one clear failure policy.
local function projectItemCore(items, failurePolicy)
	local payload = { version = 1, items = items or {}, promises = {}, message = nil }
	local intended = normalizeItems(items)
	if not VoxDeorumDealUtils.ValidatePayload(payload, actorID, counterpartID) then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_MALFORMED_TERMS")
		clearScratch()
		return false, reason, {}, failurePolicy.collectFailures and { reason } or nil
	end
	local failures = {}
	rebuilding = true
	deal:ClearItems(); deal:SetFromPlayer(actorID); deal:SetToPlayer(counterpartID)
	for _, item in ipairs(intended) do
		local before = deal:GetNumItems()
		if not addItem(item) or deal:GetNumItems() == before then
			local reason = text(failurePolicy.unavailableKey, text(itemNameKeys[item.itemType] or "TXT_KEY_VD_DEAL_ITEM_TERM"))
			if not failurePolicy.collectFailures then
				rebuilding = false; clearScratch()
				return false, reason, nil, nil
			end
			failures[#failures + 1] = reason
		end
	end
	rebuilding = false
	local decoded = decodeScratch()
	if not failurePolicy.collectFailures and scratchSignature(decoded) ~= scratchSignature(intended) then
		local reason = text("TXT_KEY_VD_DEAL_ERROR_NATIVE_DRAFT_CHANGED")
		clearScratch(); return false, reason, nil, nil
	end
	if not failurePolicy.collectFailures then
		local ok, valid = pcall(deal.AreAllTradeItemsValid, deal, true)
		if not ok or valid ~= true then
			local reason = text("TXT_KEY_VD_DEAL_ERROR_COMBINATION")
			clearScratch(); return false, reason, nil, nil
		end
	end
	return true, nil, decoded, failures
end

-- Validate ordinary terms transactionally, retaining the scratch only when requested.
local function evaluateItems(items, retainScratch)
	local ok, reason, decoded = projectItemCore(items, { collectFailures = false, unavailableKey = "TXT_KEY_VD_DEAL_ERROR_ITEM_UNAVAILABLE" })
	if not ok then return false, reason end
	if retainScratch then expectedSignature = scratchSignature(decoded) else clearScratch() end
	return true, nil
end

-- Probe the native aggregate legality of the currently projected scratch deal.
local function probeCombination()
	local ok, valid = pcall(deal.AreAllTradeItemsValid, deal, true)
	if ok and valid == true then combinationReason = nil else combinationReason = text("TXT_KEY_VD_DEAL_ERROR_COMBINATION") end
	return combinationReason == nil
end

-- Best-effort project an editable item list and return every term the native deal rejects.
local function projectItems(items)
	local _, _, _, failures = projectItemCore(items, { collectFailures = true, unavailableKey = "TXT_KEY_VD_DEAL_ERROR_ORIGINAL_TERM_UNAVAILABLE" })
	draftItems = decodeScratch()
	expectedSignature = scratchSignature(draftItems)
	probeCombination()
	return failures or {}
end

-- Project the immutable mounted proposal and clear failures from any prior edited draft.
local function projectBaseline(items)
	baselineProjectionFailures = projectItems(items)
	draftProjectionFailures = {}
	return baselineProjectionFailures
end

-- Project the current edited draft without changing immutable baseline failures.
local function projectDraft(items)
	draftProjectionFailures = projectItems(items)
	return draftProjectionFailures
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

-- Resolve a player display name without letting a missing binding break rendering.
local function playerName(playerID)
	local player = Players[playerID]
	local ok, value = playerCall(player, "GetName")
	return ok and type(value) == "string" and value ~= "" and value or text("TXT_KEY_VD_DEAL_FALLBACK_PLAYER", playerID)
end

-- Return a complete readable promise row label.
local function promiseLabel(promise)
	local label = Locale.ConvertTextKey(promiseKeys[promise.promiseType])
	if promise.targetPlayerID ~= nil then label = label .. ": " .. playerName(promise.targetPlayerID) end
	return label
end

-- Append one candidate promise to the current editor draft.
local function candidatePromises(promiserID, promiseType, targetPlayerID)
	local candidate = copy(draftPromises)
	candidate[#candidate + 1] = { promiserID = promiserID, recipientID = counterpartOf(promiserID), promiseType = promiseType, targetPlayerID = targetPlayerID }
	return candidate
end

-- Validate, commit, and render one promise candidate.
local function tryAddPromise(promiserID, promiseType, targetPlayerID)
	local ok, reason, normalized = evaluatePromises(candidatePromises(promiserID, promiseType, targetPlayerID))
	if ok then draftPromises = normalized; dismissValidationTooltip() else setStatus(reason, true) end
	refresh()
	return ok
end

-- Begin selecting a promise type from one side of the editor.
local function addPromise(promiser, index)
	if pending then return end
	local kind = promiseKinds[index]
	if kind == "COOP_WAR" then
		targetPromiserID = targetPromiserID == promiser and nil or promiser
		refresh(); return
	end
	tryAddPromise(promiser, kind)
end

-- Add a selected cooperative-war promise pair.
local function chooseCoopTarget(target)
	if targetPromiserID == nil then return end
	local promiserID = targetPromiserID
	targetPromiserID = nil
	tryAddPromise(promiserID, "COOP_WAR", target)
end

-- Remove a visible promise, including the normalized cooperative-war twin.
local function removePromise(index)
	if pending then return end
	local selected, kept = draftPromises[index], {}
	if selected == nil then return end
	for _, promise in ipairs(draftPromises) do
		if promise ~= selected and not (selected.promiseType == "COOP_WAR" and promise.promiseType == "COOP_WAR" and promise.targetPlayerID == selected.targetPlayerID) then kept[#kept + 1] = promise end
	end
	draftPromises = normalizePromises(kept)
	dismissValidationTooltip()
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

-- Recalculate one side of the native pocket after promise content changes.
local function recalcPocket(isUs)
	local promiseStack = isUs and Controls.VoxUsPocketPromiseStack or Controls.VoxThemPocketPromiseStack
	local coopStack = isUs and Controls.VoxUsPocketCoopWarStack or Controls.VoxThemPocketCoopWarStack
	local pocketStack = isUs and Controls.UsPocketStack or Controls.ThemPocketStack
	local panel = isUs and Controls.UsPocketPanel or Controls.ThemPocketPanel
	coopStack:CalculateSize(); coopStack:ReprocessAnchoring()
	promiseStack:CalculateSize(); promiseStack:ReprocessAnchoring()
	pocketStack:CalculateSize(); pocketStack:ReprocessAnchoring()
	panel:CalculateInternalSize(); panel:ReprocessAnchoring()
end

-- Recalculate one side of the native table after promise rows change.
local function recalcTable(isUs)
	local promiseStack = isUs and Controls.VoxUsTablePromiseStack or Controls.VoxThemTablePromiseStack
	local tableStack = isUs and Controls.UsTableStack or Controls.ThemTableStack
	local panel = isUs and Controls.UsTablePanel or Controls.ThemTablePanel
	promiseStack:CalculateSize(); promiseStack:ReprocessAnchoring()
	tableStack:CalculateSize(); tableStack:ReprocessAnchoring()
	panel:CalculateInternalSize(); panel:ReprocessAnchoring()
end

-- Collapse both wrapper-owned pocket categories to their native-style default state.
local function collapsePromiseCategories()
	Controls.VoxUsPocketPromiseStack:SetHide(true); Controls.VoxThemPocketPromiseStack:SetHide(true)
	Controls.VoxUsPocketCoopWarStack:SetHide(true); Controls.VoxThemPocketCoopWarStack:SetHide(true)
	Controls.VoxUsPocketPromise:SetText("[ICON_PLUS] " .. text("TXT_KEY_VD_DEAL_PROMISES"))
	Controls.VoxThemPocketPromise:SetText("[ICON_PLUS] " .. text("TXT_KEY_VD_DEAL_PROMISES"))
	targetPromiserID = nil
	recalcPocket(true); recalcPocket(false)
end

-- Toggle one wrapper-owned promise category using the native sub-stack pattern.
local function togglePromiseCategory(isUs, _, control)
	local promiseStack = isUs == 1 and Controls.VoxUsPocketPromiseStack or Controls.VoxThemPocketPromiseStack
	local coopStack = isUs == 1 and Controls.VoxUsPocketCoopWarStack or Controls.VoxThemPocketCoopWarStack
	if promiseStack:IsHidden() then
		promiseStack:SetHide(false)
		control:SetText("[ICON_MINUS] " .. text("TXT_KEY_VD_DEAL_PROMISES"))
	else
		promiseStack:SetHide(true); coopStack:SetHide(true)
		control:SetText("[ICON_PLUS] " .. text("TXT_KEY_VD_DEAL_PROMISES"))
		if (isUs == 1 and targetPromiserID == actorID) or (isUs ~= 1 and targetPromiserID == counterpartID) then targetPromiserID = nil end
	end
	recalcPocket(isUs == 1)
end

-- Render the five promise choices into both native pocket categories.
local function renderPromisePockets()
	local editable = mounted and not pending
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
end

-- Render the current Coop War target chooser beneath the selected side.
local function renderCoopTargets()
	usCoopTargetIM:ResetInstances(); themCoopTargetIM:ResetInstances()
	Controls.VoxUsPocketCoopWarStack:SetHide(targetPromiserID ~= actorID)
	Controls.VoxThemPocketCoopWarStack:SetHide(targetPromiserID ~= counterpartID)
	if targetPromiserID == nil then return end
	local manager = targetPromiserID == actorID and usCoopTargetIM or themCoopTargetIM
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		if livingMajor(playerID) and playerID ~= actorID and playerID ~= counterpartID then
			local availability = coopWarTargetAvailability[targetPromiserID] and coopWarTargetAvailability[targetPromiserID][playerID] or nil
			local targetOK = availability and availability.available or false
			local targetReason = availability and availability.reason or text("TXT_KEY_VD_DEAL_ERROR_NO_COOP_TARGET")
			local instance = manager:GetInstance()
			instance.Label:SetText(playerName(playerID)); instance.Button:SetVoid1(playerID); instance.Button:SetDisabled(pending or not targetOK)
			instance.Button:SetToolTipString(targetOK and "" or targetReason); instance.Button:RegisterCallback(Mouse.eLClick, chooseCoopTarget)
		end
	end
end

-- Render removable promises into their native table sides.
local function renderPromiseTableRows(promiseAvailability)
	usPromiseTableIM:ResetInstances(); themPromiseTableIM:ResetInstances()
	local usCount, themCount, seen = 0, 0, {}
	-- Add one native-style promise row to a table-side manager.
	local function addRow(manager, index, promise, reason)
		local instance = manager:GetInstance()
		local label, duration = promiseLabel(promise), tostring(promise.duration or "")
		if reason ~= nil then
			label = "[COLOR_NEGATIVE_TEXT]" .. label .. "[ENDCOLOR]"
			duration = "[COLOR_NEGATIVE_TEXT]" .. duration .. "[ENDCOLOR]"
		end
		instance.Label:SetText(label); instance.Duration:SetText(duration)
		instance.Button:SetVoid1(index); instance.Button:SetDisabled(pending); instance.Button:SetToolTipString(reason or "")
		instance.Button:RegisterCallback(Mouse.eLClick, removePromise)
	end
	for index, promise in ipairs(draftPromises) do
		local availability = promiseAvailability and promiseAvailability[index]
		local reason = availability and not availability.available and availability.reason or nil
		if promise.promiseType == "COOP_WAR" then
			local key = commitmentKey(promise)
			if not seen[key] then
				seen[key] = true
				for twinIndex, twin in ipairs(draftPromises) do
					local twinAvailability = commitmentKey(twin) == key and promiseAvailability and promiseAvailability[twinIndex] or nil
					if twinAvailability and not twinAvailability.available then reason = twinAvailability.reason break end
				end
				addRow(usPromiseTableIM, index, promise, reason); addRow(themPromiseTableIM, index, promise, reason)
				usCount, themCount = usCount + 1, themCount + 1
			end
		elseif promise.promiserID == actorID then
			addRow(usPromiseTableIM, index, promise, reason); usCount = usCount + 1
		else
			addRow(themPromiseTableIM, index, promise, reason); themCount = themCount + 1
		end
	end
	Controls.VoxUsTablePromiseStack:SetHide(usCount == 0); Controls.VoxThemTablePromiseStack:SetHide(themCount == 0)
end

-- Return whether the visible proposal draft differs semantically from its mount state.
local function isChanged()
	return mountFingerprint ~= nil and semanticFingerprint(draftItems, draftPromises) ~= mountFingerprint
end

-- Return whether the unchanged incoming proposal is unsafe to accept.
local function acceptBlocked(promisesOK)
	return #baselineProjectionFailures > 0 or combinationReason ~= nil or not promisesOK
end

-- Render the highest-priority validation status and expose every reason in its tooltip.
local function renderStatus(promiseReason)
	local reasons = {}
	for _, reason in ipairs(baselineProjectionFailures) do reasons[#reasons + 1] = reason end
	for _, reason in ipairs(draftProjectionFailures) do reasons[#reasons + 1] = reason end
	if combinationReason ~= nil then reasons[#reasons + 1] = combinationReason end
	if promiseReason ~= nil then reasons[#reasons + 1] = promiseReason end
	local status = reasons[1] or lastStatus
	Controls.VoxStatusText:SetText(status)
	Controls.VoxStatusFrame:SetHide(status == "")
	Controls.VoxStatusFrame:SetToolTipString(validationTooltipDismissed and "" or table.concat(reasons, "[NEWLINE]"))
end

-- Configure a native footer button for one wrapper action.
local function configureButton(control, textKey, action, visible, enabled)
	control:SetHide(not visible); control:SetText(visible and Locale.ConvertTextKey(textKey) or ""); control:SetVoid1(action or -1); control:SetDisabled(not enabled)
end

-- Render the single editable deal path and its fingerprint-driven footer.
refresh = function()
	if not mounted then return end
	local combinationOK = probeCombination()
	local promisesOK, promiseReason, normalizedPromises, promiseAvailability = evaluatePromises(draftPromises)
	draftPromises = normalizedPromises
	local changed = isChanged()
	cacheCoopWarTargetAvailability()
	renderPromisePockets(); renderCoopTargets(); renderPromiseTableRows(promiseAvailability)
	recalcPocket(true); recalcPocket(false); recalcTable(true); recalcTable(false)
	Controls.VoxPendingCover:SetHide(not pending)
	Controls.VoxMessageFrame:SetHide(mode ~= "author" and not changed)
	Controls.VoxMessageInput:SetDisabled(pending)
	Controls.WhatDoYouWantButton:SetHide(true); Controls.WhatWillYouGiveMeButton:SetHide(true)
	Controls.WhatWillMakeThisWorkButton:SetHide(true); Controls.WhatWillEndThisWarButton:SetHide(true)
	Controls.WhatConcessionsButton:SetHide(true); Controls.DenounceButton:SetHide(true)
	renderStatus(promiseReason)
	local terms = #draftItems + #draftPromises > 0
	local actorReady = not pending and effectiveSeatIsCurrent()
	if mode == "author" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_PROPOSE", footerActions.propose, true, actorReady and combinationOK and promisesOK and terms)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", footerActions.cancel, true, not pending)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	elseif changed then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", footerActions.counter, true, actorReady and combinationOK and promisesOK and terms)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", footerActions.cancel, true, not pending)
		configureButton(Controls.VoxThirdAction, "TXT_KEY_VD_DEAL_ACTION_RESET", footerActions.reset, true, not pending)
	elseif mode == "incoming" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_ACCEPT", footerActions.accept, true, actorReady and not acceptBlocked(promisesOK))
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", footerActions.cancel, true, not pending)
		configureButton(Controls.VoxThirdAction, "TXT_KEY_VD_DEAL_ACTION_REJECT", footerActions.reject, true, actorReady)
	else
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_RETRACT", footerActions.retract, true, actorReady)
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", footerActions.cancel, true, not pending)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	end
	Controls.VoxFooterStack:CalculateSize(); Controls.VoxFooterStack:ReprocessAnchoring()
end

-- Redraw native deal controls without letting wrapper update hooks re-enter refresh.
local function redrawNative()
	nativeRedrawInProgress = true
	local ok, reason = pcall(function() DisplayDeal(); DoUpdateButtons() end)
	nativeRedrawInProgress = false
	if not ok then error(reason) end
end

-- Show the in-field message prompt only while the input is empty.
local function renderMessagePlaceholder()
	Controls.VoxMessagePlaceholder:SetHide(Controls.VoxMessageInput:GetText() ~= "")
end

-- Restore the mounted proposal to the same fresh state used for a new incoming or own mount.
local function remountBaseline()
	draftPromises = copy(baselinePromises); projectBaseline(baselineItems)
	mountFingerprint = semanticFingerprint(draftItems, draftPromises)
	targetPromiserID, outgoingMessage, lastStatus = nil, "", ""
	settingMessage = true; Controls.VoxMessageInput:SetText(""); settingMessage = false
	renderMessagePlaceholder(); collapsePromiseCategories(); redrawNative()
end

-- Reproject the editor draft if another caller has reused the global scratch deal.
local function restoreScratchDraftIfChanged(allowPending)
	if not mounted or (pending and not allowPending) or rebuilding or mountingInProgress or expectedSignature == nil then return end
	if scratchSignature(decodeScratch()) == expectedSignature then return false end
	local itemsOK = evaluateItems(draftItems, true)
	if itemsOK then draftProjectionFailures = {}; probeCombination() else projectDraft(draftItems) end
	return true
end

-- Recover and redraw the editor draft after a periodic scratch-clobber check.
local function recoverClobber()
	if not restoreScratchDraftIfChanged() then return end
	redrawNative()
	refresh()
end

-- Serialize only client-owned DealPayload fields.
local function serializeDraft()
	local message = VoxDeorumDealUtils.SanitizeMessage(outgoingMessage)
	return { version = 1, items = copy(normalizeItems(draftItems)), promises = copy(normalizePromises(draftPromises)), message = message ~= "" and message or nil }
end

-- Restore a visible draft after strict native validation rejects it.
local function restoreDraftAfterValidationFailure(items, reason)
	projectDraft(items)
	redrawNative()
	setStatus(reason, true); refresh()
end

-- Validate and package one authored proposal or counter action.
local function buildAuthoredPacket(action, bypassLegality)
	local itemsOK, itemReason = evaluateItems(draftItems, true)
	if itemsOK then draftProjectionFailures = {} end
	local promisesOK, promiseReason, normalizedPromises = evaluatePromises(draftPromises)
	draftPromises = normalizedPromises
	if not itemsOK and not bypassLegality then restoreDraftAfterValidationFailure(draftItems, itemReason); return nil end
	if not promisesOK and not bypassLegality then setStatus(promiseReason, true); return nil end
	if #draftItems + #draftPromises == 0 then setStatus("TXT_KEY_VD_DEAL_ERROR_EMPTY"); return nil end
	local packet = { kind = action, deal = serializeDraft() }
	if action == "counter" then packet.expectedProposalID = proposalMessageID end
	return packet
end

-- Clear mounted state and return focus to the conversation panel.
local function resetMountState()
	actorID, counterpartID, mode, proposalMessageID = -1, -1, nil, nil
	baselineItems, baselinePromises, draftItems, draftPromises = {}, {}, {}, {}
	baselineProjectionFailures, draftProjectionFailures, combinationReason = {}, {}, nil
	originalMessage, outgoingMessage, expectedSignature, mountFingerprint, lastStatus = "", "", nil, nil, ""
	mounted, pending, nativeRedrawInProgress, mountingInProgress, validationTooltipDismissed, targetPromiserID = false, false, false, false, false, nil
	pendingSeconds, clobberSeconds = 0, 0
	mockMountAuthorized, mockMode, coopWarTargetAvailability = false, false, {}
	Controls.VoxUsPocketCoopWarStack:SetHide(true); Controls.VoxThemPocketCoopWarStack:SetHide(true)
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
	if action == "reset" then
		if mode == "author" then return end
		dismissValidationTooltip()
		remountBaseline()
		refresh(); return
	end
	if not effectiveSeatIsCurrent() then setStatus("TXT_KEY_VD_DEAL_ERROR_ACTOR_CHANGED"); return end
	local bypassLegality = mockBypassesLegality()
	local packet
	if action == "propose" then
		packet = buildAuthoredPacket(action, bypassLegality)
		if packet == nil then return end
	elseif action == "counter" then
		if mode == "author" or not isChanged() then return end
		packet = buildAuthoredPacket(action, bypassLegality)
		if packet == nil then return end
	elseif action == "accept" then
		packet = { kind = action }
		if mode ~= "incoming" or isChanged() then return end
		local itemsOK, itemReason = evaluateItems(baselineItems, true)
		local promisesOK, promiseReason = evaluatePromises(baselinePromises)
		if not itemsOK and not bypassLegality then
			remountBaseline()
			setStatus(itemReason, true); refresh(); return
		end
		if not promisesOK and not bypassLegality then setStatus(promiseReason, true); return end
		packet.proposalMessageID = proposalMessageID
	elseif action == "reject" then
		if mode ~= "incoming" or isChanged() then return end
		packet = { kind = action, proposalMessageID = proposalMessageID }
	elseif action == "retract" then
		if mode ~= "own" or isChanged() then return end
		packet = { kind = action, proposalMessageID = proposalMessageID }
	else return end
	pending, pendingSeconds = true, 0; setStatus("TXT_KEY_VD_DEAL_STATUS_PENDING"); refresh()
	local driver = VoxDeorumDealUI.driver
	if driver ~= nil and type(driver.onAction) == "function" then
		local driverOK, driverError = pcall(driver.onAction, packet)
		if not driverOK then VoxDeorumDealUI.resolve({ success = false, reason = tostring(driverError) }) end
	else VoxDeorumDealUI.resolve({ success = false, reason = text("TXT_KEY_VD_DEAL_ERROR_NO_DRIVER") }) end
end

-- Map a footer void value to the canonical driver action vocabulary.
local function onButton(index)
	if buttonActions[index] ~= nil then dispatch(buttonActions[index]) end
end

-- Keep the outgoing message safe for named-pipe serialization.
local function onMessageChanged()
	if settingMessage then return end
	local raw = Controls.VoxMessageInput:GetText()
	local clean = VoxDeorumDealUtils.StripDelimiter(raw)
	if raw ~= clean then settingMessage = true; Controls.VoxMessageInput:SetText(clean); settingMessage = false end
	outgoingMessage = clean
	dismissValidationTooltip()
	renderMessagePlaceholder()
end

-- Resolve one driver result while preserving the mounted editor on error.
local function resolve(result)
	if not mounted or not pending then return end
	if result ~= nil and result.success == true then closeScreen(); return end
	pending = false; setStatus(result and result.reason or text("TXT_KEY_VD_DEAL_ERROR_ACTION_FAILED"), true)
	redrawNative()
	refresh()
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
	actorID, counterpartID, mode, proposalMessageID = mountActorID, request.counterpartID, request.mode, request.proposalMessageID
	mockMode, mockMountAuthorized = isMockMount == true, allowMockAuthorization == true
	local source = request.deal or { version = 1, items = {}, promises = {} }
	baselineItems, baselinePromises = normalizeItems(source.items), normalizePromises(source.promises)
	draftItems = copy(baselineItems)
	originalMessage, outgoingMessage, lastStatus, mounted, pending = VoxDeorumDealUtils.SanitizeMessage(source.message), "", "", true, false
	validationTooltipDismissed = false
	mountingInProgress = true
	if type(VoxDeorumOpenDeal) ~= "function" or VoxDeorumOpenDeal(actorID, counterpartID) ~= true then
		mountingInProgress = false; clearScratch(); resetMountState(); return
	end
	if mode == "author" then
		draftItems = decodeScratch(); baselineProjectionFailures, draftProjectionFailures = {}, {}; expectedSignature = scratchSignature(draftItems); mountFingerprint = nil; probeCombination()
		settingMessage = true; Controls.VoxMessageInput:SetText(""); settingMessage = false
		renderMessagePlaceholder()
	else
		remountBaseline()
	end
	mountingInProgress = false
	LuaEvents.VoxDeorumDiploPanelDemoteForDeal(); Controls.DiscussionText:SetText(originalMessage)
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

-- Return whether a native refresh belongs to wrapper-controlled projection work.
local function nativeEventSuppressed()
	return not mounted or mountingInProgress or nativeRedrawInProgress or rebuilding
end

-- Reclaim native footer state only after a genuine native ordinary-term edit.
local function onTradeLogicUpdate()
	if nativeEventSuppressed() then return end
	local items = decodeScratch()
	local signature = scratchSignature(items)
	if signature == expectedSignature then return end
	dismissValidationTooltip()
	draftProjectionFailures = {}
	draftItems, expectedSignature = items, signature
	refresh()
end

-- Restore wrapper-owned promise rows after the native table rebuilds.
local function onTradeLogicTableRefresh()
	if nativeEventSuppressed() then return end
	local _, _, _, promiseAvailability = evaluatePromises(draftPromises)
	renderPromiseTableRows(promiseAvailability); recalcTable(true); recalcTable(false)
end

-- Restore wrapper-owned promise pockets after the native pocket rebuilds.
local function onTradeLogicPocketRefresh()
	if nativeEventSuppressed() then return end
	cacheCoopWarTargetAvailability(); renderPromisePockets(); renderCoopTargets()
	recalcPocket(true); recalcPocket(false)
end

if GenerationalInstanceManager == nil then error("Vox Deorum requires the EUI GenerationalInstanceManager.") end
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onButton)
Controls.CancelButton:RegisterCallback(Mouse.eLClick, onButton)
Controls.VoxThirdAction:RegisterCallback(Mouse.eLClick, onButton)
Controls.VoxMessageInput:RegisterCallback(onMessageChanged)
Controls.VoxUsPocketPromise:SetVoid1(1); Controls.VoxThemPocketPromise:SetVoid1(0)
Controls.VoxUsPocketPromise:RegisterCallback(Mouse.eLClick, togglePromiseCategory)
Controls.VoxThemPocketPromise:RegisterCallback(Mouse.eLClick, togglePromiseCategory)
ContextPtr:SetInputHandler(onInput)
-- Chain the native trade handler installed by include("TradeLogic"); popup-stack
-- hides must resume the per-frame update without re-running open/close logic.
local nativeTradeShowHide = OnShowHide
ContextPtr:SetShowHideHandler(function(isHide, isInit)
	nativeTradeShowHide(isHide, isInit)
	if isInit then return end
	if isHide then ContextPtr:ClearUpdate()
	elseif mounted then
		-- Native show restores the mounted participants but may leave another caller's terms in the shared scratch deal.
		restoreScratchDraftIfChanged(true)
		local resumeOK, resumed = false, false
		if type(VoxDeorumResumeHumanToHumanEditor) == "function" then resumeOK, resumed = pcall(VoxDeorumResumeHumanToHumanEditor) end
		if resumeOK and resumed then redrawNative(); refresh() end
		collapsePromiseCategories(); ContextPtr:SetUpdate(onUpdate)
	end
end)
LuaEvents.VoxDeorumOpenDealScreen.Add(open)
LuaEvents.VoxDeorumDealActionResolved.Add(resolve)
LuaEvents.VoxDeorumTradeLogicClearTable.Add(onTradeLogicTableRefresh)
LuaEvents.VoxDeorumTradeLogicDisplayDeal.Add(onTradeLogicTableRefresh)
LuaEvents.VoxDeorumTradeLogicResetDisplay.Add(onTradeLogicPocketRefresh)
LuaEvents.VoxDeorumTradeLogicUpdateButtons.Add(onTradeLogicUpdate)
VoxDeorumDealUI = { driver = {}, onAction = dispatch, resolve = resolve, open = open, openMock = openMock, close = closeScreen }

include("VoxDeorumDealScreenMock")
