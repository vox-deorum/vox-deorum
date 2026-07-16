-- Vox Deorum mock-driven diplomacy conversation panel.
-- Bubble design adapted with credit to @schnetziomi5's diplomacy-message-log modmod.
-- Deal reduction mirrors vox-agents/src/utils/diplomacy/deal-reduce.ts.

include("IconSupport")

local DELIMITER = "!@#$%^!"
local NOTIFICATION_NAME = "NOTIFICATION_VOX_DEORUM_DIPLOMACY"
local BUBBLE_WIDTH = 760
local PHASES = {
	{ name = "loading", seconds = 1.8 }, { name = "no-envoy", seconds = 2.8 },
	{ name = "closed", seconds = 2.8 }, { name = "normal", seconds = 3.5 },
	{ name = "sending", seconds = 2.8 }, { name = "thinking", seconds = 2.8 },
	{ name = "streaming", seconds = 3.2 }, { name = "deal-pending", seconds = 2.8 },
	{ name = "ack-timeout", seconds = 3.5 }, { name = "reply-timeout", seconds = 3.5 },
}
local m_counterpartID, m_activePlayerID = -1, -1
local m_rows, m_notificationIDs = {}, {}
local m_phaseIndex, m_phaseSeconds, m_dotSeconds, m_dotCount = 1, 0, 0, 1
local m_mockTurn, m_optimisticText, m_warPromptOpen = 0, "We accept your terms.", false
local m_hasMore, m_loadingEarlier, m_loadingEarlierSeconds = true, false, 0

ContextPtr:SetHide(true)

-- Fit the panel inside a 1024x720 screen while preserving the anchored footer.
local function layoutPanel()
	local screenW, screenH = UIManager:GetScreenSizeVal()
	local targetW = math.max(1000, math.min(1050, screenW - 24))
	local targetH = math.max(640, math.min(740, screenH - 16))
	local transcriptW = math.min(930, targetW - 80)
	local transcriptH = math.max(360, targetH - 268)
	local inputW = math.max(620, targetW - 320)

	Controls.MainGrid:SetSizeVal(targetW, targetH)
	Controls.WarDim:SetSizeVal(targetW, targetH)
	Controls.TranscriptScroll:SetSizeVal(transcriptW, transcriptH)
	Controls.TranscriptBar:SetSizeY(math.max(200, transcriptH - 42))
	Controls.InputFrame:SetSizeX(inputW)
	Controls.InputBox:SetSizeX(inputW - 20)
	Controls.MainGrid:ReprocessAnchoring()
	Controls.TranscriptScroll:CalculateInternalSize()
end

-- Recompute the safe panel bounds whenever the game resolution changes.
local function onSystemUpdateUI(uiType)
	if uiType == SystemUpdateUIType.ScreenResize then layoutPanel() end
end

-- Strip the named-pipe delimiter from text before it reaches either edge.
local function sanitizeText(value)
	return string.gsub(tostring(value or ""), DELIMITER, "")
end

-- Return true for a transcript trigger token that should not be displayed.
local function isSpecialRow(content)
	return string.match(tostring(content or ""), "^%s*{{{[^{}]+}}}%s*$") ~= nil
end

-- Read the proposal ID answered by a deal outcome row.
local function answeredProposalID(row)
	local payload = row and row.Payload
	local id = payload and payload.ProposalMessageID
	return type(id) == "number" and id or nil
end

-- Port the append-ordered TypeScript deal reducer used by the Web client.
local function deriveActiveProposal(rows)
	local proposals, active = {}, nil
	for _, row in ipairs(rows) do
		if row.MessageType == "deal-proposal" or row.MessageType == "deal-counter" then
			table.insert(proposals, row)
			active = row
		end
	end
	if active == nil then return { active = nil, status = "none", proposals = proposals } end
	local status, enacted = "open", false
	for _, row in ipairs(rows) do
		if answeredProposalID(row) == active.ID then
			if row.MessageType == "deal-enacted" then enacted = true
			elseif row.MessageType == "deal-accept" then status = "accepted"
			elseif row.MessageType == "deal-reject" and status == "open" then status = "rejected" end
		end
	end
	if enacted then status = "enacted" end
	return { active = active, status = status, proposals = proposals }
end

-- Port transcript-utils.ts isClosedThisTurn for display-only input gating.
local function isClosedThisTurn(rows, currentTurn)
	local closeTurn = nil
	for _, row in ipairs(rows) do
		if row.MessageType == "close" and type(row.Turn) == "number" then closeTurn = row.Turn end
	end
	return closeTurn ~= nil and currentTurn <= closeTurn
end

-- Format the current game turn and calendar year for pills.
local function turnLabel(turn)
	local year = Game.GetTurnYear(turn)
	local era = year < 0 and "BC" or "AD"
	return "T" .. tostring(turn) .. "  ~  " .. tostring(math.abs(year)) .. " " .. era
end

-- Return a readable leader and civilization title for one player.
local function speakerTitle(playerID)
	local player = Players[playerID]
	if player == nil then return "Unknown leader" end
	local civ = GameInfo.Civilizations[player:GetCivilizationType()]
	local civName = civ and Locale.ConvertTextKey(civ.ShortDescription) or "Unknown Civilization"
	return player:GetName() .. " of " .. civName
end

-- Hook a player's leader portrait and civilization badge into one bubble side.
local function hookSpeaker(playerID, controls, ownSide)
	local player = Players[playerID]
	if player == nil then return end
	local leader = GameInfo.Leaders[player:GetLeaderType()]
	local head = ownSide and controls.RightHead or controls.LeftHead
	if leader ~= nil and IconHookup ~= nil then IconHookup(leader.PortraitIndex, 64, leader.IconAtlas, head) end
	if CivIconHookup ~= nil then
		if ownSide then CivIconHookup(playerID, 32, controls.RightCivIcon, controls.RightCivIconBG, controls.RightCivIconShadow, false, true)
		else CivIconHookup(playerID, 32, controls.LeftCivIcon, controls.LeftCivIconBG, controls.LeftCivIconShadow, false, true) end
	end
end

-- Capitalize one word while converting a schema enum into display text.
local function titleWord(first, rest)
	return string.upper(first) .. rest
end

-- Turn a schema enum into a readable fallback when no stamped name is present.
local function prettyType(value)
	local text = string.gsub(tostring(value or "Trade item"), "_", " ")
	return string.gsub(string.lower(text), "(%a)([%w']*)", titleWord)
end

-- Format one canonical DealPayload v1 trade item.
local function itemLabel(item)
	local kind = item.itemType
	local duration = item.duration and (" (" .. tostring(item.duration) .. "t)") or ""
	if kind == "GOLD" then return tostring(item.amount or 0) .. " Gold" end
	if kind == "GOLD_PER_TURN" then return tostring(item.amount or 0) .. " Gold per turn" .. duration end
	if kind == "RESOURCES" then return tostring(item.quantity or 0) .. " " .. (item.name or ("Resource #" .. tostring(item.resourceID))) .. duration end
	return (item.name or prettyType(kind)) .. duration
end

-- Format one canonical DealPayload v1 promise term.
local function promiseLabel(promise)
	local names = {
		MILITARY = "Won't attack / will move troops away",
		EXPANSION = "Won't settle near you",
		BORDER = "Won't buy plots near your cities",
		NO_DIGGING = "Won't dig your antiquity sites",
		COOP_WAR = "Will join a cooperative war",
	}
	local duration = promise.duration and (" (" .. tostring(promise.duration) .. "t)") or ""
	return (names[promise.promiseType] or prettyType(promise.promiseType)) .. duration .. " (promise)"
end

-- Produce a compact two-column term list from canonical DealPayload v1 fields.
local function dealColumns(deal)
	local they, you = {}, {}
	for _, item in ipairs((deal and deal.items) or {}) do
		table.insert(item.fromPlayerID == m_counterpartID and they or you, itemLabel(item))
	end
	for _, promise in ipairs((deal and deal.promises) or {}) do
		table.insert(promise.promiserID == m_counterpartID and they or you, promiseLabel(promise))
	end
	if #they == 0 then table.insert(they, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTHING")) end
	if #you == 0 then table.insert(you, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTHING")) end
	return table.concat(they, "[NEWLINE]"), table.concat(you, "[NEWLINE]")
end

-- Create the built-in append-ordered transcript that exercises every row path.
local function buildMockRows()
	local t, us, them = m_mockTurn, m_activePlayerID, m_counterpartID
	local dealA = { version = 1, message = "A first offer for peace along our border.", items = {
		{ fromPlayerID = them, toPlayerID = us, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_WINE, quantity = 6, duration = 30, name = "Wine" },
		{ fromPlayerID = them, toPlayerID = us, itemType = "GOLD", amount = 120 },
		{ fromPlayerID = us, toPlayerID = them, itemType = "OPEN_BORDERS", duration = 45 },
		{ fromPlayerID = us, toPlayerID = them, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_IRON, quantity = 4, duration = 30, name = "Iron" },
	}, promises = { { promiserID = them, recipientID = us, promiseType = "MILITARY", duration = 20 } } }
	local dealB = { version = 1, message = "A fair exchange to steady our border.", items = {
		{ fromPlayerID = them, toPlayerID = us, itemType = "GOLD_PER_TURN", amount = 8, duration = 30 },
		{ fromPlayerID = us, toPlayerID = them, itemType = "RESOURCES", resourceID = GameInfoTypes.RESOURCE_HORSE, quantity = 2, duration = 30, name = "Horses" },
	}, promises = { { promiserID = us, recipientID = them, promiseType = "EXPANSION", duration = 20 } } }
	m_rows = {
		{ ID = 100, Turn = t - 1, SpeakerID = them, MessageType = "text", Content = "Your borders creep ever closer to mine. Explain yourself." },
		{ ID = 101, Turn = t - 1, SpeakerID = them, MessageType = "text", Content = "{{{Greeting}}}" },
		{ ID = 102, Turn = t - 1, SpeakerID = us, MessageType = "text", Content = "The settlements are on land we claimed fairly, but I am open to discussing it." },
		{ ID = 200, Turn = t, SpeakerID = them, MessageType = "deal-proposal", Content = "A first offer for peace along our border.", Payload = { Deal = dealA } },
		{ ID = 201, Turn = t, SpeakerID = us, MessageType = "deal-reject", Content = "That arrangement asks too much of us.", Payload = { ProposalMessageID = 200 } },
		{ ID = 202, Turn = t, SpeakerID = us, MessageType = "deal-proposal", Content = "Then consider this balanced exchange.", Payload = { Deal = dealB } },
		{ ID = 203, Turn = t, SpeakerID = them, MessageType = "deal-accept", Content = "I accept those terms.", Payload = { ProposalMessageID = 202 } },
		{ ID = 204, Turn = t, SpeakerID = them, MessageType = "deal-proposal", Content = "Let us also settle an older obligation.", Payload = { Deal = dealA } },
		{ ID = 205, Turn = t, SpeakerID = us, MessageType = "deal-accept", Content = "We agree to this second arrangement.", Payload = { ProposalMessageID = 204 } },
		{ ID = 206, Turn = t, SpeakerID = them, MessageType = "deal-enacted", Content = "Our agreement is now in force.", Payload = { ProposalMessageID = 204 } },
		{ ID = 207, Turn = t, SpeakerID = us, MessageType = "deal-proposal", Content = "Perhaps we can broaden the agreement.", Payload = { Deal = dealA } },
		{ ID = 208, Turn = t, SpeakerID = them, MessageType = "deal-counter", Content = "A fair exchange to steady our border.", Payload = { Deal = dealB, ProposalMessageID = 207 } },
		{ ID = 209, Turn = t, SpeakerID = them, MessageType = "close", Content = "We have said enough for this turn." },
	}
end

-- Destroy all dynamic transcript controls before a complete mock re-render.
local function clearTranscript()
	Controls.TranscriptStack:DestroyAllChildren()
end

-- Add a centered turn boundary pill.
local function addTurn(turn)
	local instance = {}
	ContextPtr:BuildInstanceForControl("TurnInstance", instance, Controls.TranscriptStack)
	instance.Text:SetText(turnLabel(turn))
end

-- Return an animated label with a cycling one-to-three-dot suffix.
local function animated(text)
	return text .. " " .. string.rep(".", m_dotCount)
end

-- Open one deal card using the Stage 7.02 event contract.
local function openDeal(row, respond)
	LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, row.Payload and row.Payload.Deal or nil, respond and row.ID or nil)
end

-- Derive one historical proposal's terminal badge, or superseded when unanswered.
local function proposalBadge(row, reduction)
	if reduction.active ~= nil and reduction.active.ID == row.ID then return reduction.status end
	local status, enacted, answered = "open", false, false
	for _, answer in ipairs(m_rows) do
		if answeredProposalID(answer) == row.ID then
			answered = true
			if answer.MessageType == "deal-enacted" then enacted = true
			elseif answer.MessageType == "deal-accept" then status = "accepted"
			elseif answer.MessageType == "deal-reject" and status == "open" then status = "rejected" end
		end
	end
	if enacted then return "enacted" end
	return answered and status or "superseded"
end

-- Add a text or deal bubble and bind its portrait, badge, and click mode.
local function addMessage(row, reduction, pendingDeal, dealLocked)
	local instance = {}
	ContextPtr:BuildInstanceForControl("MessageInstance", instance, Controls.TranscriptStack)
	local own = row.SpeakerID == m_activePlayerID
	instance.LeftTitle:SetHide(own); instance.LeftText:SetHide(own); instance.LeftHeadFrame:SetHide(own)
	instance.RightTitle:SetHide(not own); instance.RightText:SetHide(not own); instance.RightHeadFrame:SetHide(not own)
	instance.CardButton:SetOffsetX(own and 92 or 48)
	local textControl = own and instance.RightText or instance.LeftText
	local titleControl = own and instance.RightTitle or instance.LeftTitle
	local isDeal = row.MessageType == "deal-proposal" or row.MessageType == "deal-counter"
	local content = row.Content
	local deal = row.Payload and row.Payload.Deal
	if isDeal and deal ~= nil and type(deal.message) == "string" and deal.message ~= "" then content = deal.message end
	titleControl:SetText(speakerTitle(row.SpeakerID))
	textControl:SetText(sanitizeText(content))
	hookSpeaker(row.SpeakerID, instance, own)
	instance.TheyHeader:SetHide(not isDeal); instance.YouHeader:SetHide(not isDeal)
	instance.TheyGive:SetHide(not isDeal); instance.YouGive:SetHide(not isDeal)
	instance.DealDivider:SetHide(not isDeal); instance.DealStatus:SetHide(not isDeal)
	instance.Pending:SetHide(not pendingDeal)
	local textHeight = math.max(24, textControl:GetSizeY())
	local height = 38 + textHeight + 16
	if isDeal then
		local they, you = dealColumns(deal)
		instance.TheyGive:SetText(they); instance.YouGive:SetText(you)
		local dealTop = 38 + textHeight + 14
		instance.TheyHeader:SetOffsetY(dealTop); instance.YouHeader:SetOffsetY(dealTop)
		instance.TheyGive:SetOffsetY(dealTop + 24); instance.YouGive:SetOffsetY(dealTop + 24)
		instance.DealDivider:SetOffsetY(dealTop - 2)
		local isActive = reduction.active ~= nil and reduction.active.ID == row.ID
		instance.DealStatus:SetText(Locale.ToUpper(proposalBadge(row, reduction)))
		height = dealTop + 24 + math.max(instance.TheyGive:GetSizeY(), instance.YouGive:GetSizeY()) + 28
		if pendingDeal and isActive then
			local pendingKeys = { "TXT_KEY_VD_DIPLO_ACCEPTING", "TXT_KEY_VD_DIPLO_REJECTING", "TXT_KEY_VD_DIPLO_PROPOSING" }
			instance.Pending:SetText(animated(Locale.ConvertTextKey(pendingKeys[m_dotCount])))
		end
		local locked = dealLocked and isActive and reduction.status == "open"
		local respond = isActive and reduction.status == "open" and not pendingDeal and not locked
		local function clickDeal() openDeal(row, respond) end
		instance.CardButton:RegisterCallback(Mouse.eLClick, clickDeal)
		instance.CardButton:SetDisabled(pendingDeal)
	end
	instance.CardButton:SetAlpha((pendingDeal or row.Pending) and 0.55 or 1)
	instance.Row:SetSizeVal(900, height + 8); instance.CardButton:SetSizeVal(BUBBLE_WIDTH, height)
	instance.Bubble:SetSizeVal(BUBBLE_WIDTH, height); instance.Border:SetSizeVal(BUBBLE_WIDTH + 4, height + 4)
end

-- Move Retry back to the optimistic sending phase.
local function retryPending()
	m_phaseIndex, m_phaseSeconds = 5, 0
end

-- Add a status or timeout line with an optional Retry action.
local function addStatus(text, retry)
	local instance = {}
	ContextPtr:BuildInstanceForControl("StatusInstance", instance, Controls.TranscriptStack)
	instance.Text:SetText(text)
	instance.RetryButton:SetHide(not retry)
	if retry then instance.RetryButton:RegisterCallback(Mouse.eLClick, retryPending) end
end

-- Update war visibility from native team state and declaration legality.
local function refreshWarButton()
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	local visible = false
	if active ~= nil and other ~= nil then
		local activeTeam, otherTeamID = Teams[active:GetTeam()], other:GetTeam()
		visible = not activeTeam:IsAtWar(otherTeamID) and activeTeam:CanDeclareWar(otherTeamID)
	end
	Controls.WarButton:SetHide(not visible)
end

-- Apply visible input gating with an explanatory row for every disabled state.
local function refreshInput(closed, phase)
	local noEnvoy = phase == "no-envoy"
	local pending = phase == "sending" or phase == "thinking" or phase == "streaming" or phase == "deal-pending"
	local reason = nil
	if phase == "loading" then reason = animated(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING"))
	elseif noEnvoy then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NO_ENVOY")
	elseif closed then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_CLOSED")
	elseif phase == "ack-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOT_DELIVERED")
	elseif phase == "reply-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_ENVOY_UNAVAILABLE")
	elseif pending then reason = animated(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_BUSY")) end
	Controls.InputFrame:SetHide(reason ~= nil); Controls.SendButton:SetHide(reason ~= nil)
	Controls.InputReason:SetHide(reason == nil); Controls.InputReason:SetText(reason or "")
	Controls.ProposeButton:SetDisabled(reason ~= nil)
end

-- Render the current demo phase from rows, reducers, and transient UI state.
local function render()
	clearTranscript()
	local phase = PHASES[m_phaseIndex].name
	local currentTurn = phase == "closed" and m_mockTurn or m_mockTurn + 1
	local closed = isClosedThisTurn(m_rows, currentTurn)
	Controls.HeaderTurn:SetText(turnLabel(currentTurn))
	Controls.LoadEarlierButton:SetHide(not m_hasMore or phase == "loading" or phase == "no-envoy")
	Controls.LoadEarlierButton:SetDisabled(m_loadingEarlier)
	if phase == "loading" then addStatus(animated(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING")), false)
	elseif phase == "no-envoy" then addStatus(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NO_ENVOY"), false)
	else
		local reduction, previousTurn = deriveActiveProposal(m_rows), nil
		for _, row in ipairs(m_rows) do
			if not isSpecialRow(row.Content) then
				if previousTurn ~= row.Turn then addTurn(row.Turn) end
				addMessage(row, reduction, phase == "deal-pending" and reduction.active and reduction.active.ID == row.ID, closed)
				previousTurn = row.Turn
			end
		end
		if phase == "sending" then addMessage({ SpeakerID = m_activePlayerID, MessageType = "text", Content = m_optimisticText .. " (" .. Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_SENDING") .. ")", Pending = true }, reduction, false, closed)
		elseif phase == "thinking" then addStatus(animated(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_THINKING")), false)
		elseif phase == "streaming" then addMessage({ SpeakerID = m_counterpartID, MessageType = "text", Content = "Consider it carefully. My patience has limits" .. string.rep(".", m_dotCount) }, reduction, false, closed)
		elseif phase == "ack-timeout" then addStatus(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOT_DELIVERED"), true)
		elseif phase == "reply-timeout" then addStatus(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_ENVOY_UNAVAILABLE"), true) end
		if m_loadingEarlier then addStatus(animated(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING_EARLIER")), false) end
		if closed then addStatus(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_CLOSED"), false) end
	end
	refreshInput(closed, phase)
	Controls.TranscriptStack:CalculateSize(); Controls.TranscriptStack:ReprocessAnchoring()
	Controls.TranscriptScroll:CalculateInternalSize(); Controls.TranscriptScroll:SetScrollValue(1)
	refreshWarButton()
end

-- Advance dot animation and the repeating mock-state demonstration.
local function onUpdate(delta)
	m_phaseSeconds, m_dotSeconds = m_phaseSeconds + delta, m_dotSeconds + delta
	local changed = false
	if m_loadingEarlier then
		m_loadingEarlierSeconds = m_loadingEarlierSeconds + delta
		if m_loadingEarlierSeconds >= 1.5 then
			m_loadingEarlier, m_loadingEarlierSeconds, m_hasMore, changed = false, 0, false, true
		end
	end
	if m_dotSeconds >= 0.45 then m_dotSeconds, m_dotCount, changed = 0, (m_dotCount % 3) + 1, true end
	if m_phaseSeconds >= PHASES[m_phaseIndex].seconds then
		m_phaseSeconds, m_phaseIndex, changed = 0, (m_phaseIndex % #PHASES) + 1, true
	end
	if changed then render() end
end

-- Post one notification through the same registered body stage 04 will call.
local function postNotification(playerID, counterpartID, summary, message)
	local player = Players[playerID]
	if player == nil then return false end
	player:AddNotificationName(NOTIFICATION_NAME, sanitizeText(message), sanitizeText(summary), -1, -1, counterpartID, counterpartID)
	return true
end

-- Track diplomacy notification IDs by counterpart as the game creates them.
local function onNotificationAdded(id, notificationType, tooltip, summary, gameValue, extraGameData, playerID)
	local expected = NotificationTypes and NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY
	if expected == nil or notificationType ~= expected or playerID ~= Game.GetActivePlayer() then return end
	m_notificationIDs[gameValue] = m_notificationIDs[gameValue] or {}
	m_notificationIDs[gameValue][id] = true
end

-- Remove every tracked notification for one conversation pair.
local function dismissPairNotifications(counterpartID)
	for id in pairs(m_notificationIDs[counterpartID] or {}) do UI.RemoveNotification(id) end
	m_notificationIDs[counterpartID] = nil
end

-- Show the dormant addin against a fresh mock transcript.
local function showPanel(counterpartID)
	local other = Players[counterpartID]
	if other == nil or not other:IsAlive() or other:IsMinorCiv() or other:IsBarbarian() then return end
	m_activePlayerID, m_counterpartID, m_mockTurn = Game.GetActivePlayer(), counterpartID, Game.GetGameTurn()
	m_phaseIndex, m_phaseSeconds, m_dotSeconds, m_warPromptOpen = 1, 0, 0, false
	m_hasMore, m_loadingEarlier, m_loadingEarlierSeconds = true, false, 0
	Controls.WarDim:SetHide(true)
	buildMockRows()
	ContextPtr:SetHide(false); ContextPtr:SetUpdate(onUpdate)
	render()
end

-- Hide the whole addin without ending or mutating the conversation.
local function hidePanel()
	m_warPromptOpen = false
	Controls.WarDim:SetHide(true); ContextPtr:ClearUpdate(); ContextPtr:SetHide(true)
end

-- Open from Converse and post the stage-01 smoke-test notification.
local function onConverseOpen(counterpartID)
	postNotification(Game.GetActivePlayer(), counterpartID, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTIFICATION_SUMMARY"), Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTIFICATION_MESSAGE"))
	showPanel(counterpartID)
end

-- Open from a native notification and dismiss all notifications for its pair.
local function onNotificationActivated(notificationID, counterpartID, extra)
	UI.RemoveNotification(notificationID); dismissPairNotifications(counterpartID); showPanel(counterpartID)
end

-- Strip delimiters as the player types without disturbing unchanged text.
local function onInputChanged()
	local raw = Controls.InputBox:GetText()
	local clean = sanitizeText(raw)
	if clean ~= raw then Controls.InputBox:SetText(clean) end
end

-- Start the optimistic mock send cycle for non-empty sanitized input.
local function onSend()
	local clean = sanitizeText(Controls.InputBox:GetText())
	if string.match(clean, "^%s*$") then return end
	m_optimisticText = clean; Controls.InputBox:ClearString()
	m_phaseIndex, m_phaseSeconds = 5, 0
	render()
end

-- Open the deal screen in authoring mode.
local function onProposeDeal()
	LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, nil, nil)
end

-- Show the local native-war confirmation overlay.
local function onDeclareWar()
	m_warPromptOpen = true; Controls.WarDim:SetHide(false)
end

-- Cancel the local native-war confirmation overlay.
local function cancelDeclareWar()
	m_warPromptOpen = false; Controls.WarDim:SetHide(true)
end

-- Confirm against current team state, then ask the network layer to declare war.
local function confirmDeclareWar()
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	if active ~= nil and other ~= nil then
		local activeTeam, counterpartTeamID = Teams[active:GetTeam()], other:GetTeam()
		if not activeTeam:IsAtWar(counterpartTeamID) and activeTeam:CanDeclareWar(counterpartTeamID) then Network.SendChangeWar(counterpartTeamID, true) end
	end
	cancelDeclareWar(); refreshWarButton()
end

-- Keep the transcript mounted while the mock earlier page loads inline.
local function onLoadEarlier()
	if not m_hasMore or m_loadingEarlier then return end
	m_loadingEarlier, m_loadingEarlierSeconds = true, 0
	render()
end

-- Handle Escape locally so the game menu does not open over this panel.
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE and not ContextPtr:IsHidden() then
		if m_warPromptOpen then cancelDeclareWar() else hidePanel() end
		return true
	end
	return false
end

-- Keep update state coherent if another context hides this addin.
local function showHideHandler(isHide, isInit)
	if isHide and not isInit then ContextPtr:ClearUpdate() end
end

Game.RegisterFunction("VoxDeorumPostNotification", postNotification)
Events.NotificationAdded.Add(onNotificationAdded)
LuaEvents.VoxDeorumDiploOpen.Add(onConverseOpen)
LuaEvents.VoxDeorumDiplomacyNotificationActivated.Add(onNotificationActivated)
Controls.CloseButton:RegisterCallback(Mouse.eLClick, hidePanel)
Controls.GoodbyeButton:RegisterCallback(Mouse.eLClick, hidePanel)
Controls.LoadEarlierButton:RegisterCallback(Mouse.eLClick, onLoadEarlier)
Controls.InputBox:RegisterCallback(onInputChanged)
Controls.SendButton:RegisterCallback(Mouse.eLClick, onSend)
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onProposeDeal)
Controls.WarButton:RegisterCallback(Mouse.eLClick, onDeclareWar)
Controls.WarYesButton:RegisterCallback(Mouse.eLClick, confirmDeclareWar)
Controls.WarNoButton:RegisterCallback(Mouse.eLClick, cancelDeclareWar)
ContextPtr:SetInputHandler(inputHandler)
ContextPtr:SetShowHideHandler(showHideHandler)
layoutPanel()
Events.SystemUpdateUI.Add(onSystemUpdateUI)
