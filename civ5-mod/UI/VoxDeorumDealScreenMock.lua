-- Stage 7.02 delayed driver. Stage 7.04 replaces only this final include.

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

-- Find a living major counterpart for FireTuner smoke requests.
local function findMockCounterpart(actorID)
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		local player = Players[playerID]
		if playerID ~= actorID and player ~= nil and player:IsAlive() and not player:IsMinorCiv() and not player:IsBarbarian() then return playerID end
	end
	return nil
end

-- Build a small schema-complete deal that is safe to mount without assuming tradable inventory.
local function buildMockDeal(actorID, counterpartID, own)
	local promiser = own and actorID or counterpartID
	local recipient = own and counterpartID or actorID
	return {
		version = 1,
		items = {},
		promises = { { promiserID = promiser, recipientID = recipient, promiseType = "NO_DIGGING" } },
		message = own and "Let us put this understanding in writing." or "Respect our lands and we can move forward.",
	}
end

-- Build one of the six explicit stage-7.02 FireTuner scenarios.
local function buildMockRequest(name, counterpartID)
	local actorID = VoxDeorumSeat.EffectiveSeat()
	counterpartID = counterpartID or findMockCounterpart(actorID)
	if counterpartID == nil then return nil end
	if name == "author" then return { counterpartID = counterpartID, mode = "author" }
	elseif name == "incoming" then return { counterpartID = counterpartID, mode = "incoming", deal = buildMockDeal(actorID, counterpartID, false), proposalMessageID = 7001 }
	elseif name == "own" then return { counterpartID = counterpartID, mode = "own", deal = buildMockDeal(actorID, counterpartID, true), proposalMessageID = 7002 }
	elseif name == "view" then return { counterpartID = counterpartID, mode = "view", deal = buildMockDeal(actorID, counterpartID, false) }
	elseif name == "success" then return { counterpartID = counterpartID, mode = "author", mockResult = "success" }
	elseif name == "error" then return { counterpartID = counterpartID, mode = "author", mockResult = "error" } end
	return nil
end

-- Remember which delayed result the current mock request should demonstrate.
local function onMockOpen(request)
	m_mockShouldError = request ~= nil and request.mockResult == "error"
end

-- Begin a delayed mock completion without enacting or writing any gameplay state.
local function onMockAction(_)
	m_mockSeconds, m_mockPending = 0, true
end

-- Open a named request through the same ordinary LuaEvent used by production callers.
local function openMock(name, counterpartID)
	local request = buildMockRequest(name, counterpartID)
	if request ~= nil then LuaEvents.VoxDeorumOpenDealScreen(request) end
end

VoxDeorumDealUI.driver = { onOpen = onMockOpen, onAction = onMockAction, onUpdate = onMockUpdate }
VoxDeorumDealMock = { Open = openMock, BuildRequest = buildMockRequest }
LuaEvents.VoxDeorumOpenDealScreenMock.Add(openMock)
