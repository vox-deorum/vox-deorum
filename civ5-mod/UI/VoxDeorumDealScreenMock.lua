-- Stage 7.02 delayed driver. Request-scoped legality bypasses preserve presentation scenarios. Stage 7.04 replaces only this final include.

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
	return VoxDeorumDealUtils.IsLivingMajor(playerID, Players, GameDefines)
end

-- Find the first living major other than one excluded actor.
local function findMockCounterpart(actorID)
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		if playerID ~= actorID and isLivingMajor(playerID) then return playerID end
	end
	return nil
end

-- Find a third living major for a cooperative-war presentation request.
local function findMockCoopTarget(actorID, counterpartID)
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		if playerID ~= actorID and playerID ~= counterpartID and isLivingMajor(playerID) then return playerID end
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

-- Return the first resource that the proposer can visibly offer to the native editor.
local function firstAvailableResource(playerID)
	local player = Players[playerID]
	if player == nil or GameInfo == nil or type(GameInfo.Resources) ~= "function" then return nil end
	for resource in GameInfo.Resources() do
		local ok, amount = pcall(player.GetNumResourceAvailable, player, resource.ID, false)
		if ok and type(amount) == "number" and amount > 0 then return resource.ID end
	end
	return nil
end

-- Build a schema-complete deal with native-projection examples and one promise.
local function buildMockDeal(actorID, counterpartID, own)
	local promiser = own and actorID or counterpartID
	local recipient = own and counterpartID or actorID
	local items = {
		{ fromPlayerID = promiser, toPlayerID = recipient, itemType = "GOLD", amount = 10 },
		{ fromPlayerID = recipient, toPlayerID = promiser, itemType = "OPEN_BORDERS" },
	}
	local resourceID = firstAvailableResource(promiser)
	if resourceID ~= nil then
		items[#items + 1] = { fromPlayerID = promiser, toPlayerID = recipient, itemType = "RESOURCES", resourceID = resourceID, quantity = 1 }
	end
	return {
		version = 1,
		items = items,
		promises = { { promiserID = promiser, recipientID = recipient, promiseType = "NO_DIGGING" } },
		message = own and "Let us put this understanding in writing." or "Respect our lands and we can move forward.",
	}
end

-- Build a legal-looking deal with deterministic unavailable ordinary and promise terms.
local function buildUnavailableMockDeal(actorID, counterpartID, own)
	local deal = buildMockDeal(actorID, counterpartID, own)
	local promiser = own and actorID or counterpartID
	local recipient = own and counterpartID or actorID
	deal.items[#deal.items + 1] = { fromPlayerID = promiser, toPlayerID = recipient, itemType = "CITIES", cityID = -1 }
	deal.promises = {
		{ promiserID = promiser, recipientID = recipient, promiseType = "COOP_WAR", targetPlayerID = actorID },
		{ promiserID = recipient, recipientID = promiser, promiseType = "COOP_WAR", targetPlayerID = actorID },
	}
	return deal
end

-- Build one symmetric Coop War payload for the presentation-only mock path.
local function buildCoopWarMockDeal(actorID, counterpartID, singleDirection)
	local targetID = findMockCoopTarget(actorID, counterpartID)
	if targetID == nil then return nil end
	local promises = { { promiserID = counterpartID, recipientID = actorID, promiseType = "COOP_WAR", targetPlayerID = targetID } }
	if not singleDirection then promises[#promises + 1] = { promiserID = actorID, recipientID = counterpartID, promiseType = "COOP_WAR", targetPlayerID = targetID } end
	return { version = 1, items = {}, promises = promises, message = "Let us prepare our joint war." }
end

-- Build one explicit stage-7.02 FireTuner scenario.
local function buildMockRequest(name, actorID, counterpartID)
	if counterpartID == nil then return nil end
	if name == "author" then return { counterpartID = counterpartID, mode = "author", mockBypassLegality = true }
	elseif name == "incoming" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7001, mockBypassLegality = true }
	elseif name == "own" then return { counterpartID = counterpartID, mode = "own", deal = buildMockDeal(actorID, counterpartID, true), proposalMessageID = 7002, mockBypassLegality = true }
	elseif name == "success" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7003, mockResult = "success", mockBypassLegality = true }
	elseif name == "error" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7004, mockResult = "error", mockBypassLegality = true }
	elseif name == "unavailable" then return { counterpartID = counterpartID, mode = "incoming", deal = buildUnavailableMockDeal(actorID, counterpartID, false), proposalMessageID = 7005 }
	elseif name == "own-unavailable" then return { counterpartID = counterpartID, mode = "own", deal = buildUnavailableMockDeal(actorID, counterpartID, true), proposalMessageID = 7006 }
	elseif name == "coop-war" or name == "coop-war-wire-invalid" then
		local singleDirection = name == "coop-war-wire-invalid"
		local coopDeal = buildCoopWarMockDeal(actorID, counterpartID, singleDirection)
		if coopDeal == nil then return nil end
		return { counterpartID = counterpartID, mode = "incoming", deal = coopDeal, proposalMessageID = singleDirection and 7008 or 7007, mockBypassLegality = true }
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
	if actorID == nil or selectedCounterpartID == nil then return nil end
	return buildMockRequest(name, actorID, selectedCounterpartID), actorID
end

-- Open a named request through the context-local mock mount seam.
local function openMock(name, counterpartID)
	local request, actorID = buildNamedMockRequest(name, counterpartID)
	if request ~= nil then VoxDeorumDealUI.openMock(request, actorID) end
end

VoxDeorumDealUI.driver = { onOpen = onMockOpen, onAction = onMockAction, onUpdate = onMockUpdate }
VoxDeorumDealMock = { Open = openMock, BuildRequest = buildNamedMockRequest }
LuaEvents.VoxDeorumOpenDealScreenMock.Add(openMock)
