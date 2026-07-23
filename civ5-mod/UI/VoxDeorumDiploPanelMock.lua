-- Stage 7.01 mock driver. Stage 7.04 replaces this include with the transport driver.
-- The mock always plays the normal seated demo, whatever seat it runs under:
-- observers can do everything except Declare War, a native path outside its scope.

local NOTIFICATION_NAME = "NOTIFICATION_VOX_DEORUM_DIPLOMACY"
local STREAM_CHUNK_SECONDS = 0.8
local STREAM_TEXT = "Consider it carefully. My patience has limits, but there may still be room for agreement if your people show good faith. Withdraw your scouts from our frontier and honor the promises already made. Do that, and we can discuss trade, open borders, and a lasting peace."

-- Build cumulative word-boundary cut points for four-word streaming chunks.
local function buildStreamCuts(text)
	local cuts, searchFrom, wordCount = {}, 1, 0
	while true do
		local _, wordEnd = string.find(text, "%S+", searchFrom)
		if wordEnd == nil then break end
		wordCount, searchFrom = wordCount + 1, wordEnd + 1
		if wordCount % 4 == 0 then table.insert(cuts, wordEnd) end
	end
	if cuts[#cuts] ~= string.len(text) then table.insert(cuts, string.len(text)) end
	return cuts
end

local STREAM_CUTS = buildStreamCuts(STREAM_TEXT)
local PHASES = {
	{ name = "loading", seconds = 3.0 }, { name = "no-envoy", seconds = 5.0 },
	{ name = "closed", seconds = 5.0 }, { name = "normal", seconds = 6.0 },
	{ name = "sending", seconds = 5.0 }, { name = "thinking", seconds = 5.0 },
	{ name = "streaming", seconds = #STREAM_CUTS * STREAM_CHUNK_SECONDS + 1.5 }, { name = "deal-pending", seconds = 5.0 },
	{ name = "ack-timeout", seconds = 6.0 }, { name = "reply-timeout", seconds = 6.0 },
}
local m_counterpartID, m_activePlayerID, m_mockTurn = -1, -1, 0
local m_phaseIndex, m_phaseSeconds = 1, 0
local m_lastStreamChunk = 0
local m_loadingEarlier, m_loadingEarlierSeconds = false, 0
local m_optimisticText, m_counterAppended, m_streamCommitted = "We accept your terms.", false, false
local m_nextID, m_dealStep = 300, 0
local dealMockButtons = {
	{ control = Controls.MockDealAuthorButton, scenario = "author" },
	{ control = Controls.MockDealIncomingButton, scenario = "incoming" },
	{ control = Controls.MockDealOwnButton, scenario = "own" },
	{ control = Controls.MockDealUnavailableButton, scenario = "unavailable" },
	{ control = Controls.MockDealSuccessButton, scenario = "success" },
	{ control = Controls.MockDealErrorButton, scenario = "error" },
}

-- Open one deal-screen mock scenario for the panel's current counterpart.
local function onDealMockButton(index)
	local entry = dealMockButtons[index]
	if entry ~= nil and m_counterpartID >= 0 then LuaEvents.VoxDeorumOpenDealScreenMock(entry.scenario, m_counterpartID) end
end

-- Reveal and bind controls that exist only for the removable mock driver.
local function initializeDealMockButtons()
	for index, entry in ipairs(dealMockButtons) do
		entry.control:SetVoid1(index)
		entry.control:RegisterCallback(Mouse.eLClick, onDealMockButton)
		entry.control:SetHide(false)
	end
	Controls.ActionStack:CalculateSize()
	Controls.ActionStack:ReprocessAnchoring()
end

-- Build one sample deal from the current conversation pair.
local function buildDealA()
	return { version = 1, message = "A first offer for peace along our border.", items = {
		{ fromPlayerID = m_counterpartID, toPlayerID = m_activePlayerID, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_WINE, quantity = 6, duration = 30, name = "Wine" },
		{ fromPlayerID = m_counterpartID, toPlayerID = m_activePlayerID, itemType = "GOLD", amount = 120 },
		{ fromPlayerID = m_activePlayerID, toPlayerID = m_counterpartID, itemType = "OPEN_BORDERS", duration = 45 },
		{ fromPlayerID = m_activePlayerID, toPlayerID = m_counterpartID, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_IRON, quantity = 4, duration = 30, name = "Iron" },
	}, promises = { { promiserID = m_counterpartID, recipientID = m_activePlayerID, promiseType = "MILITARY", duration = 20 } } }
end

-- Build a second sample deal for the counterproposal chain.
local function buildDealB()
	return { version = 1, message = "A fair exchange to steady our border.", items = {
		{ fromPlayerID = m_counterpartID, toPlayerID = m_activePlayerID, itemType = "GOLD_PER_TURN", amount = 8, duration = 30 },
		{ fromPlayerID = m_activePlayerID, toPlayerID = m_counterpartID, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_HORSE, quantity = 2, duration = 30, name = "Horses" },
	}, promises = { { promiserID = m_activePlayerID, recipientID = m_counterpartID, promiseType = "EXPANSION", duration = 20 } } }
end

-- Build the append-ordered transcript that exercises every durable row path.
local function buildMockRows()
	local t, us, them, dealA, dealB = m_mockTurn, m_activePlayerID, m_counterpartID, buildDealA(), buildDealB()
	return {
		{ ID = 100, Turn = t - 1, SpeakerID = them, MessageType = "text", Content = "Your borders creep ever closer to mine. Explain yourself." },
		{ ID = 101, Turn = t - 1, SpeakerID = them, MessageType = "text", Content = "{{{Greeting}}}" },
		{ ID = 102, Turn = t - 1, SpeakerID = us, MessageType = "text", Content = "The settlements are on land we claimed fairly, but I am open to discussing it." },
		{ ID = 103, Turn = t - 1, SpeakerID = them, MessageType = "text", Content = "[COLOR_YELLOW]Terms[ENDCOLOR][NEWLINE][ICON_BULLET] 120 Gold now" },
		{ ID = 200, Turn = t, SpeakerID = them, MessageType = "deal-proposal", Content = "", Payload = { Deal = dealA } },
		{ ID = 201, Turn = t, SpeakerID = us, MessageType = "deal-reject", Content = "That arrangement asks too much of us.", Payload = { ProposalMessageID = 200 } },
		{ ID = 202, Turn = t, SpeakerID = us, MessageType = "deal-proposal", Content = "Then consider this balanced exchange.", Payload = { Deal = dealB } },
		{ ID = 203, Turn = t, SpeakerID = them, MessageType = "deal-accept", Content = "I accept those terms.", Payload = { ProposalMessageID = 202 } },
		{ ID = 204, Turn = t, SpeakerID = them, MessageType = "deal-proposal", Content = "Let us also settle an older obligation.", Payload = { Deal = dealA } },
		{ ID = 205, Turn = t, SpeakerID = us, MessageType = "deal-accept", Content = "We agree to this second arrangement.", Payload = { ProposalMessageID = 204 } },
		{ ID = 206, Turn = t, SpeakerID = them, MessageType = "deal-enacted", Content = "Our agreement is now in force.", Payload = { ProposalMessageID = 204 } },
		{ ID = 207, Turn = t, SpeakerID = us, MessageType = "deal-proposal", Content = "Perhaps we can broaden the agreement.", Payload = { Deal = dealA } },
		{ ID = 209, Turn = t, SpeakerID = them, MessageType = "close", Content = "We have said enough for this turn." },
	}
end

-- Build the older page used by the prepend demonstration.
local function buildOlderRows()
	return {
		{ ID = 10, Turn = m_mockTurn - 3, SpeakerID = m_counterpartID, MessageType = "text", Content = "Our first exchange was cautious." },
		{ ID = 11, Turn = m_mockTurn - 2, SpeakerID = m_activePlayerID, MessageType = "text", Content = "Caution can be a foundation for trust." },
	}
end

-- Find a named phase in the repeating demonstration.
local function phaseIndex(name)
	for index, phase in ipairs(PHASES) do if phase.name == name then return index end end
	return 1
end

-- Apply one mock phase through the public UI surface.
local function applyPhase()
	local name = PHASES[m_phaseIndex].name
	if name == "closed" then
		VoxDeorumDiploUI.setCurrentTurn(m_mockTurn); VoxDeorumDiploUI.setPhase("normal")
	else
		VoxDeorumDiploUI.setCurrentTurn(m_mockTurn + 1)
		if name == "sending" then VoxDeorumDiploUI.setPhase(name, m_optimisticText)
		elseif name == "streaming" then m_streamCommitted, m_lastStreamChunk = false, 0; VoxDeorumDiploUI.setPhase(name); VoxDeorumDiploUI.setStreamingText("")
		elseif name == "deal-pending" then
			if m_dealStep >= 4 then VoxDeorumDiploUI.setPhase("normal")
			else VoxDeorumDiploUI.setPhase(name, m_dealStep == 0 and 207 or 208) end
		else VoxDeorumDiploUI.setPhase(name) end
	end
end

-- Commit the final streaming row before leaving the streaming phase.
local function finishStreaming()
	if m_streamCommitted then return end
	m_streamCommitted = true; m_nextID = m_nextID + 1
	VoxDeorumDiploUI.appendRow({ ID = m_nextID, Turn = m_mockTurn, SpeakerID = m_counterpartID, MessageType = "text", Content = STREAM_TEXT })
end

-- Advance the active counter through the reducer's visible status states.
local function finishPendingDeal()
	if m_dealStep == 0 then
		m_counterAppended, m_dealStep = true, 1
		VoxDeorumDiploUI.appendRow({ ID = 208, Turn = m_mockTurn, SpeakerID = m_counterpartID, MessageType = "deal-counter", Content = "A fair exchange to steady our border.", Payload = { Deal = buildDealB(), ProposalMessageID = 207 } })
	elseif m_dealStep == 1 then
		m_dealStep = 2
		VoxDeorumDiploUI.appendRow({ ID = 210, Turn = m_mockTurn, SpeakerID = m_activePlayerID, MessageType = "deal-reject", Content = "That counter still asks too much.", Payload = { ProposalMessageID = 208 } })
	elseif m_dealStep == 2 then
		m_dealStep = 3
		VoxDeorumDiploUI.appendRow({ ID = 211, Turn = m_mockTurn, SpeakerID = m_activePlayerID, MessageType = "deal-accept", Content = "On reflection, we accept the counter.", Payload = { ProposalMessageID = 208 } })
	elseif m_dealStep == 3 then
		m_dealStep = 4
		VoxDeorumDiploUI.appendRow({ ID = 212, Turn = m_mockTurn, SpeakerID = m_counterpartID, MessageType = "deal-enacted", Content = "The counterproposal is now in force.", Payload = { ProposalMessageID = 208 } })
	end
end

-- Populate and restart the demonstration whenever the panel opens.
local function onOpen(counterpartID, activePlayerID)
	m_counterpartID, m_activePlayerID, m_mockTurn = counterpartID, activePlayerID, Game.GetGameTurn()
	m_phaseIndex, m_phaseSeconds, m_loadingEarlier, m_loadingEarlierSeconds = 1, 0, false, 0
	m_counterAppended, m_streamCommitted, m_nextID, m_dealStep = false, false, 300, 0
	VoxDeorumDiploUI.setCurrentTurn(m_mockTurn + 1); VoxDeorumDiploUI.setRows(buildMockRows()); VoxDeorumDiploUI.setHasMore(true); applyPhase()
end

-- Begin the mock optimistic-send sequence.
local function onSend(text)
	m_optimisticText, m_phaseIndex, m_phaseSeconds = text, phaseIndex("sending"), 0; applyPhase()
end

-- Retry through the same optimistic-send sequence.
local function onRetry()
	m_phaseIndex, m_phaseSeconds = phaseIndex("sending"), 0; applyPhase()
end

-- Start the delayed older-page demonstration.
local function onLoadEarlier()
	m_loadingEarlier, m_loadingEarlierSeconds = true, 0
end

-- Advance mock paging, streaming text, and repeating phases.
local function onUpdate(delta)
	if m_loadingEarlier then
		m_loadingEarlierSeconds = m_loadingEarlierSeconds + delta
		if m_loadingEarlierSeconds >= 2.5 then m_loadingEarlier, m_loadingEarlierSeconds = false, 0; VoxDeorumDiploUI.prependRows(buildOlderRows(), false) end
	end
	m_phaseSeconds = m_phaseSeconds + delta
	if PHASES[m_phaseIndex].name == "streaming" then
		local chunk = math.min(#STREAM_CUTS, math.floor(m_phaseSeconds / STREAM_CHUNK_SECONDS) + 1)
		if chunk ~= m_lastStreamChunk then
			m_lastStreamChunk = chunk
			VoxDeorumDiploUI.setStreamingText(string.sub(STREAM_TEXT, 1, STREAM_CUTS[chunk]))
		end
	end
	if m_phaseSeconds >= PHASES[m_phaseIndex].seconds then
		local oldName = PHASES[m_phaseIndex].name
		if oldName == "streaming" then finishStreaming() elseif oldName == "deal-pending" then finishPendingDeal() end
		m_phaseSeconds, m_phaseIndex = 0, (m_phaseIndex % #PHASES) + 1; applyPhase()
	end
end

-- Keep the stage-01 smoke notification with the removable mock driver.
local function postMockNotification(counterpartID)
	local playerID, player = Game.GetActivePlayer(), Players[Game.GetActivePlayer()]
	if player ~= nil then player:AddNotificationName(NOTIFICATION_NAME, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTIFICATION_MESSAGE"), Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTIFICATION_SUMMARY"), -1, -1, counterpartID, counterpartID) end
end

VoxDeorumDiploUI.driver = { onOpen = onOpen, onSend = onSend, onRetry = onRetry, onLoadEarlier = onLoadEarlier, onUpdate = onUpdate, onHide = function() end }
LuaEvents.VoxDeorumDiploOpen.Add(postMockNotification)
initializeDealMockButtons()
