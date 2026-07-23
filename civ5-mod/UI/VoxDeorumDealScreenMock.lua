-- Stage 7.02 delayed driver. Legality-probed requests exercise the deal screen until the stage 7.04 transport replaces this final include.

local MOCK_DELAY_SECONDS = 1.25
local m_mockSeconds = 0
local m_mockPending = false
local m_mockShouldError = false

-- Advance a delayed result through the deal screen's shared update owner.
local function onMockUpdate(delta)
	if not m_mockPending then return end
	m_mockSeconds = m_mockSeconds + delta
	if m_mockSeconds < MOCK_DELAY_SECONDS then return end
	m_mockPending = false
	if m_mockShouldError then VoxDeorumDealUI.resolve({ success = false, reason = Locale.ConvertTextKey("TXT_KEY_VD_DEAL_MOCK_ERROR") })
	else VoxDeorumDealUI.resolve({ success = true, reason = Locale.ConvertTextKey("TXT_KEY_VD_DEAL_MOCK_SUCCESS") }) end
end

-- Return whether one ID is a native living-major deal participant.
local function isLivingMajor(playerID)
	return VoxDeorumDealUtils.IsLivingMajor(playerID, Players, GameDefines) == true
end

-- Find the first living major other than one excluded actor.
local function findMockCounterpart(actorID)
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		if playerID ~= actorID and isLivingMajor(playerID) then return playerID end
	end
	return nil
end

-- Select the current live seat pair, or a deterministic presentation pair for an unsupported observer seat.
local function selectMockPair(requestedCounterpartID)
	local effectiveSeat = VoxDeorumSeat.EffectiveSeat()
	if isLivingMajor(effectiveSeat) then
		local counterpart = isLivingMajor(requestedCounterpartID) and requestedCounterpartID ~= effectiveSeat and requestedCounterpartID or findMockCounterpart(effectiveSeat)
		return counterpart ~= nil and effectiveSeat or nil, counterpart
	end
	local actor = findMockCounterpart(-1)
	local counterpart = actor ~= nil and findMockCounterpart(actor) or nil
	return actor, counterpart
end

-- Return the shared scratch deal when the native binding is available.
local function getScratchDeal()
	if UI == nil or type(UI.GetScratchDeal) ~= "function" then return nil end
	local ok, scratch = pcall(UI.GetScratchDeal)
	return ok and scratch or nil
end

-- Clear native scratch terms without assuming the binding remains available.
local function clearScratch(scratch)
	if scratch ~= nil and type(scratch.ClearItems) == "function" then pcall(scratch.ClearItems, scratch) end
end

-- Clear and bind scratch terms to the two current deal principals.
local function resetScratch(scratch, actorID, counterpartID)
	if scratch == nil or type(scratch.ClearItems) ~= "function" or type(scratch.SetFromPlayer) ~= "function" or type(scratch.SetToPlayer) ~= "function" then return false end
	local cleared = pcall(scratch.ClearItems, scratch)
	local fromSet = pcall(scratch.SetFromPlayer, scratch, actorID)
	local toSet = pcall(scratch.SetToPlayer, scratch, counterpartID)
	return cleared and fromSet and toSet
end

-- Return the exact native probe data for one canonical candidate.
local function itemProbeData(item)
	if TradeableItems == nil then return nil end
	if item.itemType == "GOLD" then return TradeableItems.TRADE_ITEM_GOLD, item.amount, -1, -1
	elseif item.itemType == "RESOURCES" then return TradeableItems.TRADE_ITEM_RESOURCES, item.resourceID, item.quantity, -1
	elseif item.itemType == "OPEN_BORDERS" then return TradeableItems.TRADE_ITEM_OPEN_BORDERS, item.duration, -1, -1
	elseif item.itemType == "ALLOW_EMBASSY" then return TradeableItems.TRADE_ITEM_ALLOW_EMBASSY, -1, -1, -1
	elseif item.itemType == "GOLD_PER_TURN" then return TradeableItems.TRADE_ITEM_GOLD_PER_TURN, item.amount, item.duration, -1
	elseif item.itemType == "MAPS" then return TradeableItems.TRADE_ITEM_MAPS, -1, -1, -1 end
	return nil
end

-- Add one canonical candidate with the native human-to-human constructor.
local function addScratchItem(scratch, item)
	if item.itemType == "GOLD" and type(scratch.AddGoldTrade) == "function" then return pcall(scratch.AddGoldTrade, scratch, item.fromPlayerID, item.amount, true)
	elseif item.itemType == "RESOURCES" and type(scratch.AddResourceTrade) == "function" then return pcall(scratch.AddResourceTrade, scratch, item.fromPlayerID, item.resourceID, item.quantity, item.duration, true)
	elseif item.itemType == "OPEN_BORDERS" and type(scratch.AddOpenBorders) == "function" then return pcall(scratch.AddOpenBorders, scratch, item.fromPlayerID, item.duration, true)
	elseif item.itemType == "ALLOW_EMBASSY" and type(scratch.AddAllowEmbassy) == "function" then return pcall(scratch.AddAllowEmbassy, scratch, item.fromPlayerID, true)
	elseif item.itemType == "GOLD_PER_TURN" and type(scratch.AddGoldPerTurnTrade) == "function" then return pcall(scratch.AddGoldPerTurnTrade, scratch, item.fromPlayerID, item.amount, item.duration, true)
	elseif item.itemType == "MAPS" and type(scratch.AddMapTrade) == "function" then return pcall(scratch.AddMapTrade, scratch, item.fromPlayerID, true) end
	return false
end

-- Rebuild scratch from only the candidates that already passed aggregate validation.
local function rebuildScratch(scratch, actorID, counterpartID, accepted)
	if not resetScratch(scratch, actorID, counterpartID) then return false end
	for _, item in ipairs(accepted) do if not addScratchItem(scratch, item) then return false end end
	return true
end

-- Probe and retain one candidate only when it remains legal with the accepted scratch terms.
local function probeScratchItem(scratch, actorID, counterpartID, accepted, item)
	local itemType, data1, data2, data3 = itemProbeData(item)
	if itemType == nil or type(scratch.IsPossibleToTradeItem) ~= "function" or type(scratch.AreAllTradeItemsValid) ~= "function" then return false end
	local possibleOK, possible = pcall(scratch.IsPossibleToTradeItem, scratch, item.fromPlayerID, item.toPlayerID, itemType, data1, data2, data3, false, true)
	if not possibleOK or possible ~= true then return false end
	local added = addScratchItem(scratch, item)
	local aggregateOK, aggregate = pcall(scratch.AreAllTradeItemsValid, scratch, true)
	if not added or not aggregateOK or aggregate ~= true then rebuildScratch(scratch, actorID, counterpartID, accepted); return false end
	accepted[#accepted + 1] = item
	return true
end

-- Match the native temporary-for-permanent classification for mock trade items.
local temporalClasses = {
	GOLD = "permanent",
	GOLD_PER_TURN = "temporary",
	MAPS = "permanent",
	RESOURCES = "temporary",
	OPEN_BORDERS = "temporary",
	ALLOW_EMBASSY = "temporary",
}

-- Return the native temporal class used to balance mock deal directions.
local function temporalClass(item)
	return temporalClasses[item.itemType]
end

-- Return whether every accepted term shares one temporal class.
local function sharedTemporalClass(items)
	local class = nil
	for _, item in ipairs(items) do
		local candidateClass = temporalClass(item)
		if class ~= nil and class ~= candidateClass then return nil end
		class = candidateClass
	end
	return class
end

-- Return whether a direction already offers a one-time gold term.
local function hasGold(items)
	for _, item in ipairs(items) do if item.itemType == "GOLD" then return true end end
	return false
end

-- Return available resource IDs in their native database order.
local function availableResources(playerID)
	local player = Players and Players[playerID] or nil
	if player == nil or GameInfo == nil or type(GameInfo.Resources) ~= "function" then return {} end
	local resourcesOK, resources = pcall(GameInfo.Resources)
	if not resourcesOK or resources == nil then return {} end
	local available = {}
	for resource in resources do
		local amountOK, amount = VoxDeorumDealUtils.TryCall(player, "GetNumResourceAvailable", resource.ID, false)
		if amountOK and type(amount) == "number" and amount > 0 then available[#available + 1] = resource.ID end
	end
	return available
end

-- Return the positive amount of gold a player can offer.
local function availableGold(playerID)
	local goldOK, gold = VoxDeorumDealUtils.TryCall(Players and Players[playerID] or nil, "GetGold")
	return goldOK and type(gold) == "number" and gold > 0 and gold or nil
end

-- Build and probe the ordered candidate list for one offer direction.
local function probeDirection(scratch, actorID, counterpartID, accepted, fromPlayerID, toPlayerID, limit, requiredClass, skipGold)
	local selected = {}
	local function try(item)
		if #selected >= limit or (requiredClass ~= nil and temporalClass(item) ~= requiredClass) then return false end
		if probeScratchItem(scratch, actorID, counterpartID, accepted, item) then selected[#selected + 1] = item; return true end
		return false
	end
	local gold = availableGold(fromPlayerID)
	if not skipGold and gold ~= nil then try(VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "GOLD", amount = math.min(10, gold) }, Game)) end
	for _, resourceID in ipairs(availableResources(fromPlayerID)) do
		if #selected >= limit then break end
		local resource = VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "RESOURCES", resourceID = resourceID, quantity = 1 }, Game)
		if resource.duration ~= nil and try(resource) then break end
	end
	local openBorders = VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "OPEN_BORDERS" }, Game)
	if openBorders.duration ~= nil then try(openBorders) end
	try(VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "ALLOW_EMBASSY" }, Game))
	local goldPerTurn = VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "GOLD_PER_TURN", amount = 2 }, Game)
	if goldPerTurn.duration ~= nil then try(goldPerTurn) end
	try(VoxDeorumDealUtils.NormalizeItem({ fromPlayerID = fromPlayerID, toPlayerID = toPlayerID, itemType = "MAPS" }, Game))
	return selected
end

-- Build up to two forward terms and one matching reverse term in one cumulative scratch deal.
local function buildProbedItems(actorID, counterpartID, own)
	local scratch = getScratchDeal()
	if scratch == nil then return {} end
	local forwardFrom = own and actorID or counterpartID
	local forwardTo = own and counterpartID or actorID
	local accepted = {}
	if not rebuildScratch(scratch, actorID, counterpartID, accepted) then return {} end
	local forward = probeDirection(scratch, actorID, counterpartID, accepted, forwardFrom, forwardTo, 2, nil, false)
	local class = #forward > 0 and sharedTemporalClass(forward) or nil
	if class ~= nil then probeDirection(scratch, actorID, counterpartID, accepted, forwardTo, forwardFrom, 1, class, hasGold(forward)) end
	return accepted
end

-- Return the first inactive standard promise, or the always-available No Digging promise.
local function firstLegalPromise(promiserID, recipientID)
	local recipient = Players and Players[recipientID] or nil
	for _, kind in ipairs({ "MILITARY", "EXPANSION", "BORDER" }) do
		local stateOK, turns = VoxDeorumDealUtils.TryCall(recipient, VoxDeorumDealUtils.PromiseStateGetter(kind), promiserID)
		if stateOK and type(turns) == "number" and turns < 0 then return VoxDeorumDealUtils.NormalizePromise({ promiserID = promiserID, recipientID = recipientID, promiseType = kind }, Game, GameDefines) end
	end
	return VoxDeorumDealUtils.NormalizePromise({ promiserID = promiserID, recipientID = recipientID, promiseType = "NO_DIGGING" }, Game, GameDefines)
end

-- Find a cooperative-war target that passes the same native gates as promise evaluation.
local function findLegalCoopTarget(actorID, counterpartID)
	for targetID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		if VoxDeorumDealUtils.IsLegalCoopWarTarget(actorID, counterpartID, targetID, Players, Teams, GameDefines, CoopWarStates) then return targetID end
	end
	return nil
end

-- Build a schema-complete deal with legality-probed terms and one legal promise.
local function buildMockDeal(actorID, counterpartID, own)
	local promiser = own and actorID or counterpartID
	local recipient = own and counterpartID or actorID
	local deal = { version = 1, items = buildProbedItems(actorID, counterpartID, own), promises = { firstLegalPromise(promiser, recipient) }, message = own and "Let us put this understanding in writing." or "Respect our lands and we can move forward." }
	return deal
end

-- Build a legal base deal plus deterministic invalid ordinary and paired cooperative-war terms.
local function buildUnavailableMockDeal(actorID, counterpartID, own)
	local deal = buildMockDeal(actorID, counterpartID, own)
	local promiser = own and actorID or counterpartID
	local recipient = own and counterpartID or actorID
	deal.items[#deal.items + 1] = { fromPlayerID = promiser, toPlayerID = recipient, itemType = "CITIES", cityID = -1 }
	deal.promises[#deal.promises + 1] = VoxDeorumDealUtils.NormalizePromise({ promiserID = actorID, recipientID = counterpartID, promiseType = "COOP_WAR", targetPlayerID = actorID }, Game, GameDefines)
	deal.promises[#deal.promises + 1] = VoxDeorumDealUtils.NormalizePromise({ promiserID = counterpartID, recipientID = actorID, promiseType = "COOP_WAR", targetPlayerID = actorID }, Game, GameDefines)
	return deal
end

-- Build one symmetric legal cooperative-war payload, or report when no target remains legal.
local function buildCoopWarMockDeal(actorID, counterpartID)
	local targetID = findLegalCoopTarget(actorID, counterpartID)
	if targetID == nil then print("Vox Deorum Deal Screen mock: no legal cooperative-war target is available."); return nil end
	local promises = {
		VoxDeorumDealUtils.NormalizePromise({ promiserID = counterpartID, recipientID = actorID, promiseType = "COOP_WAR", targetPlayerID = targetID }, Game, GameDefines),
		VoxDeorumDealUtils.NormalizePromise({ promiserID = actorID, recipientID = counterpartID, promiseType = "COOP_WAR", targetPlayerID = targetID }, Game, GameDefines),
	}
	return { version = 1, items = {}, promises = promises, message = "Let us prepare our joint war." }
end

-- Build one explicit stage-7.02 FireTuner scenario.
local function buildMockRequest(name, actorID, counterpartID)
	if counterpartID == nil then return nil end
	if name == "author" then return { counterpartID = counterpartID, mode = "author" }
	elseif name == "incoming" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7001 }
	elseif name == "own" then return { counterpartID = counterpartID, mode = "own", deal = buildMockDeal(actorID, counterpartID, true), proposalMessageID = 7002 }
	elseif name == "error" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7003, mockResult = "error" }
	elseif name == "unavailable" then return { counterpartID = counterpartID, mode = "incoming", deal = buildUnavailableMockDeal(actorID, counterpartID, false), proposalMessageID = 7004 }
	elseif name == "coop-war" then
		local coopDeal = buildCoopWarMockDeal(actorID, counterpartID)
		if coopDeal == nil then return nil end
		return { counterpartID = counterpartID, mode = "incoming", deal = coopDeal, proposalMessageID = 7005 }
	end
	return nil
end

-- Remember which delayed result the current mock request should demonstrate.
local function onMockOpen(request)
	m_mockSeconds, m_mockPending = 0, false
	m_mockShouldError = request ~= nil and request.mockResult == "error"
end

-- Begin a delayed mock completion without enacting or writing any gameplay state.
local function onMockAction(_)
	m_mockSeconds, m_mockPending = 0, true
end

-- Build a named request and its separately authorized presentation actor.
local function buildNamedMockRequest(name, counterpartID)
	local actorID, selectedCounterpartID = selectMockPair(counterpartID)
	local hasPair = actorID ~= nil and selectedCounterpartID ~= nil
	local request = hasPair and buildMockRequest(name, actorID, selectedCounterpartID) or nil
	clearScratch(getScratchDeal())
	if not hasPair then return nil end
	return request, actorID
end

-- Open a named request through the context-local mock mount seam.
local function openMock(name, counterpartID)
	local request, actorID = buildNamedMockRequest(name, counterpartID)
	if request ~= nil then VoxDeorumDealUI.openMock(request, actorID) end
end

VoxDeorumDealUI.driver = { onOpen = onMockOpen, onAction = onMockAction, onUpdate = onMockUpdate }
VoxDeorumDealMock = { Open = openMock, BuildRequest = buildNamedMockRequest }
LuaEvents.VoxDeorumOpenDealScreenMock.Add(openMock)
