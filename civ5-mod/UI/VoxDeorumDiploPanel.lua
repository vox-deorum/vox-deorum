-- Vox Deorum diplomacy conversation panel.
-- Bubble design adapted with credit to @schnetziomi5's diplomacy-message-log modmod.
-- Deal reduction mirrors vox-agents/src/utils/diplomacy/deal-reduce.ts.

include("IconSupport")
include("VoxDeorumSeat")

local DELIMITER = "!@#$%^!"
local DELIMITER_PATTERN = string.gsub(DELIMITER, "%W", "%%%1")
local RESERVED_RIGHT = 264
local OUTER_GUTTER = 12
local STATUS_KEYS = {
	open = "TXT_KEY_VD_DIPLO_STATUS_OPEN", accepted = "TXT_KEY_VD_DIPLO_STATUS_ACCEPTED",
	rejected = "TXT_KEY_VD_DIPLO_STATUS_REJECTED", enacted = "TXT_KEY_VD_DIPLO_STATUS_ENACTED",
	superseded = "TXT_KEY_VD_DIPLO_STATUS_SUPERSEDED",
}
local STATUS_COLORS = {
	open = "COLOR_YELLOW",
	accepted = "COLOR_POSITIVE_TEXT", rejected = "COLOR_NEGATIVE_TEXT",
	enacted = "COLOR_POSITIVE_TEXT", superseded = "COLOR_GREY",
}
local m_geometry = {
	contentWidth = 1004, transcriptWidth = 924, rowWidth = 894, bubbleWidth = 754,
	textWrapWidth = 666, inputWidth = 684, inputStatusWidth = 884,
	dealColumnWidth = 316, dealYouX = 378, dealDividerX = 368,
}
local m_counterpartID, m_activePlayerID = -1, -1
local m_rows, m_rowByID, m_rowInstances = {}, {}, {}
local m_lastBuiltTurn, m_currentTurn = nil, 0
local m_phase, m_phaseArg, m_streamingText = "loading", nil, ""
local m_hasMore, m_loadingEarlier = false, false
local m_dotSeconds, m_dotCount, m_animated = 0, 1, {}
local m_tail = { sending = {}, streaming = {}, status = {} }
local m_notificationIDs, m_notificationOwner, m_notificationMessages = {}, {}, {}
local m_warPromptOpen = false
local m_isPureObserver = false
local PENDING_POKE_TIMEOUT = 3.0
local m_presentation = nil -- nil | "pending" | "leader" | "static"
local m_sceneLeaderID = -1
local m_pendingCounterpartID, m_pendingSeconds = -1, 0

ContextPtr:SetHide(true)

-- Return whether the current UI still controls the deal actor bound on open.
local function isBoundActorCurrent()
	return VoxDeorumSeat.EffectiveSeat() == m_activePlayerID
end

-- Return whether the active observer is acting for its pinned civilization seat.
local function isHumanStrategist()
	local activePlayerID = Game.GetActivePlayer()
	local activePlayer = Players[activePlayerID]
	return activePlayer ~= nil and activePlayer:IsObserver() and not VoxDeorumSeat.IsPureObserver() and activePlayerID ~= m_activePlayerID
end

-- Size the panel and record the shared geometry used by every row instance.
local function layoutPanel()
	local screenW, screenH = UIManager:GetScreenSizeVal()
	local targetH = math.max(520, math.floor(screenH * 0.70))
	local columnW = math.max(760, screenW - RESERVED_RIGHT - OUTER_GUTTER)
	local columnX = math.max(12, math.floor((screenW - RESERVED_RIGHT - columnW) / 2))
	local transcriptW, transcriptH = columnW - 80, math.max(260, targetH - 136)
	local rowW, bubbleW = transcriptW - 30, math.min(1120, transcriptW - 170)
	local inputW = math.max(400, columnW - 320)
	local inputStatusW = columnW - 120
	local dealColumnW = math.floor((bubbleW - 42 - 60 - 20) / 2)
	local headerTitleW = math.max(120, math.min(270, math.floor(transcriptW / 2) - 150))
	m_geometry = {
		contentWidth = columnW, transcriptWidth = transcriptW, rowWidth = rowW,
		bubbleWidth = bubbleW, textWrapWidth = bubbleW - 88, inputWidth = inputW,
		inputStatusWidth = inputStatusW, dealColumnWidth = dealColumnW,
		dealYouX = 42 + dealColumnW + 20, dealDividerX = 42 + dealColumnW + 10,
	}
	Controls.MainGrid:SetSizeVal(screenW, targetH); Controls.ContentColumn:SetSizeVal(columnW, targetH); Controls.ContentColumn:SetOffsetVal(columnX, 0); Controls.WarDim:SetSizeVal(screenW, targetH)
	Controls.TranscriptScroll:SetSizeVal(transcriptW, transcriptH); Controls.TranscriptBar:SetSizeY(math.max(200, transcriptH - 42))
	Controls.TranscriptStack:SetSizeX(rowW); Controls.TailStack:SetSizeX(rowW); Controls.FooterDivider:SetSizeX(transcriptW)
	Controls.HeaderBar:SetSizeX(transcriptW); Controls.HeaderRule:SetSizeX(transcriptW)
	Controls.HeaderLeftTitle:SetTruncateWidth(headerTitleW); Controls.HeaderRightTitle:SetTruncateWidth(headerTitleW)
	Controls.HeaderBar:ReprocessAnchoring()
	Controls.InputFrame:SetSizeX(inputW); Controls.InputFrameBorder:SetSizeVal(inputW + 4, 42); Controls.InputBox:SetSizeX(inputW - 20)
	Controls.InputStatusSlot:SetSizeVal(inputStatusW, 38); Controls.InputReason:SetWrapWidth(math.max(320, inputStatusW - 160))
	Controls.MainGrid:ReprocessAnchoring(); Controls.ContentColumn:ReprocessAnchoring(); Controls.TranscriptScroll:CalculateInternalSize()
end

-- Strip the named-pipe delimiter from text.
local function sanitizeText(value)
	return string.gsub(tostring(value or ""), DELIMITER_PATTERN, "")
end

-- Wrap display text in one of Civilization V's named text colors.
local function colorText(value, color)
	return "[" .. color .. "]" .. tostring(value or "") .. "[ENDCOLOR]"
end

-- Combine a deal's current status and message into one summary line.
local function dealSummary(row, status)
	local statusText = Locale.ConvertTextKey(STATUS_KEYS[status] or STATUS_KEYS.superseded)
	local prefix = colorText(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_DEAL_PREFIX", statusText), STATUS_COLORS[status] or "COLOR_GREY")
	local content = sanitizeText(row.Content)
	return prefix .. (string.match(content, "^%s*$") == nil and (" " .. content) or "")
end

-- Return whether a transcript row is a hidden trigger token.
local function isSpecialRow(content)
	return string.match(tostring(content or ""), "^%s*{{{[^{}]+}}}%s*$") ~= nil
end

-- Read the proposal ID answered by an outcome row.
local function answeredProposalID(row)
	local id = row and row.Payload and row.Payload.ProposalMessageID
	return type(id) == "number" and id or nil
end

-- Port the append-ordered Web deal reducer.
local function deriveActiveProposal(rows)
	local proposals, active = {}, nil
	for _, row in ipairs(rows) do
		if row.MessageType == "deal-proposal" or row.MessageType == "deal-counter" then table.insert(proposals, row); active = row end
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

-- Port the Web close-row input derivation.
local function isClosedThisTurn(rows, currentTurn)
	local closeTurn = nil
	for _, row in ipairs(rows) do if row.MessageType == "close" and type(row.Turn) == "number" then closeTurn = row.Turn end end
	return closeTurn ~= nil and currentTurn <= closeTurn
end

-- Format a game turn and calendar year.
local function turnLabel(turn)
	local year = Game.GetTurnYear(turn)
	return "T" .. tostring(turn) .. "  ~  " .. tostring(math.abs(year)) .. " " .. (year < 0 and "BC" or "AD")
end

-- Return a localized speaker title.
local function speakerTitle(playerID)
	if m_isPureObserver and playerID == m_activePlayerID then return Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_OBSERVER") end
	local player = Players[playerID]
	local leaderName, civName = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_UNKNOWN_LEADER"), Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_UNKNOWN_CIV")
	if player ~= nil then
		leaderName = player:GetName()
		local civ = GameInfo.Civilizations[player:GetCivilizationType()]
		if civ ~= nil then civName = Locale.ConvertTextKey(civ.ShortDescription) end
	end
	return Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_SPEAKER_TITLE", leaderName, civName)
end

-- Return the player whose artwork represents a conversation speaker.
local function speakerIconPlayerID(playerID)
	if m_isPureObserver and playerID == m_activePlayerID then return GameDefines.BARBARIAN_PLAYER end
	return playerID
end

-- Hook a leader portrait and civilization badge into a bubble.
local function hookSpeaker(playerID, controls, ownSide)
	local iconPlayerID = speakerIconPlayerID(playerID)
	local player = Players[iconPlayerID]
	if player == nil then return end
	local leader, head = GameInfo.Leaders[player:GetLeaderType()], ownSide and controls.RightHead or controls.LeftHead
	if leader ~= nil and IconHookup ~= nil then IconHookup(leader.PortraitIndex, 64, leader.IconAtlas, head) end
	if CivIconHookup ~= nil then
		if ownSide then CivIconHookup(iconPlayerID, 32, controls.RightCivIcon, controls.RightCivIconBG, controls.RightCivIconShadow, false, true)
		else CivIconHookup(iconPlayerID, 32, controls.LeftCivIcon, controls.LeftCivIconBG, controls.LeftCivIconShadow, false, true) end
	end
end

-- Bind both conversation sides into the compact header bar above the transcript.
local function populateHeader()
	Controls.HeaderLeftTitle:SetText(speakerTitle(m_counterpartID))
	Controls.HeaderRightTitle:SetText(speakerTitle(m_activePlayerID))
	if CivIconHookup ~= nil then CivIconHookup(m_counterpartID, 32, Controls.HeaderLeftCivIcon, Controls.HeaderLeftCivIconBG, Controls.HeaderLeftCivIconShadow, false, true) end
	local ownIconPlayerID = speakerIconPlayerID(m_activePlayerID)
	if CivIconHookup ~= nil then CivIconHookup(ownIconPlayerID, 32, Controls.HeaderRightCivIcon, Controls.HeaderRightCivIconBG, Controls.HeaderRightCivIconShadow, false, true) end
	Controls.HeaderRightCivIconBG:SetHide(false)
end

-- Capitalize one schema word.
local function titleWord(first, rest) return string.upper(first) .. rest end

-- Turn a schema enum into a readable fallback.
local function prettyType(value)
	return string.gsub(string.lower(string.gsub(tostring(value or "Trade item"), "_", " ")), "(%a)([%w']*)", titleWord)
end

-- Format one canonical trade item.
local function itemLabel(item)
	local kind, duration = item.itemType, item.duration and (" (" .. tostring(item.duration) .. "t)") or ""
	if kind == "GOLD" then return tostring(item.amount or 0) .. " Gold" end
	if kind == "GOLD_PER_TURN" then return tostring(item.amount or 0) .. " Gold per turn" .. duration end
	if kind == "RESOURCES" then return tostring(item.quantity or 0) .. " " .. (item.name or ("Resource #" .. tostring(item.resourceID))) .. duration end
	return (item.name or prettyType(kind)) .. duration
end

-- Format one canonical promise term.
local function promiseLabel(promise)
	local names = { MILITARY = "Won't attack / will move troops away", EXPANSION = "Won't settle near you", BORDER = "Won't buy plots near your cities", NO_DIGGING = "Won't dig your antiquity sites", COOP_WAR = "Will join a cooperative war" }
	local duration = promise.duration and (" (" .. tostring(promise.duration) .. "t)") or ""
	return (names[promise.promiseType] or prettyType(promise.promiseType)) .. duration .. " (promise)"
end

-- Produce the two deal term columns.
local function dealColumns(deal)
	local they, you = {}, {}
	for _, item in ipairs((deal and deal.items) or {}) do
		if item.fromPlayerID == m_counterpartID then table.insert(they, itemLabel(item))
		elseif item.fromPlayerID == m_activePlayerID then table.insert(you, itemLabel(item)) end
	end
	for _, promise in ipairs((deal and deal.promises) or {}) do
		if promise.promiserID == m_counterpartID then table.insert(they, promiseLabel(promise))
		elseif promise.promiserID == m_activePlayerID then table.insert(you, promiseLabel(promise)) end
	end
	if #they == 0 then table.insert(they, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTHING")) end
	if #you == 0 then table.insert(you, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOTHING")) end
	return table.concat(they, "[NEWLINE]"), table.concat(you, "[NEWLINE]")
end

-- Return whether the transcript is stuck to its bottom edge.
local function isAtBottom()
	return Controls.TranscriptScroll:GetRatio() >= 1 or Controls.TranscriptScroll:GetScrollValue() > 0.98
end

-- Apply the shared animated-dot suffix to one label.
local function applyAnimated(entry)
	entry.control:SetText(entry.prefix .. string.rep(".", m_dotCount) .. (entry.suffix or ""))
end

-- Track one animated label.
local function addAnimated(control, prefix, suffix)
	local entry = { control = control, prefix = prefix, suffix = suffix }
	table.insert(m_animated, entry); applyAnimated(entry)
end

-- Open one deal card in respond or view mode.
local function openDeal(row, respond)
	local proposalID = respond and isBoundActorCurrent() and row.ID or nil
	LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, row.Payload and row.Payload.Deal or nil, proposalID)
end

-- Apply the shared bubble geometry for one message instance.
local function sizeBubble(instance, height)
	instance.Row:SetSizeVal(m_geometry.rowWidth, height + 4)
	instance.CardButton:SetSizeVal(m_geometry.bubbleWidth, height); instance.Bubble:SetSizeVal(m_geometry.bubbleWidth, height); instance.Border:SetSizeVal(m_geometry.bubbleWidth + 4, height + 4)
end

-- Reposition deal terms and size the card after its summary or pending state changes.
local function resizeDealBubble(instance, pending)
	local textControl = instance.LeftText:IsHidden() and instance.RightText or instance.LeftText
	local dealTop = 18 + textControl:GetSizeY()
	instance.TheyHeader:SetOffsetY(dealTop); instance.YouHeader:SetOffsetY(dealTop)
	instance.TheyGive:SetOffsetY(dealTop + 24); instance.YouGive:SetOffsetY(dealTop + 24); instance.DealDivider:SetOffsetY(dealTop - 2)
	local termsHeight = math.max(instance.TheyGive:GetSizeY(), instance.YouGive:GetSizeY())
	instance.DealDivider:SetSizeY(termsHeight + 28)
	sizeBubble(instance, dealTop + 24 + termsHeight + (pending and 30 or 14))
end

-- Bind all bubble details that do not depend on later rows.
local function bindStaticRow(row, instance)
	local own = row.SpeakerID == m_activePlayerID
	local isDeal, deal = row.MessageType == "deal-proposal" or row.MessageType == "deal-counter", row.Payload and row.Payload.Deal
	local content = isDeal and dealSummary(row, "open") or sanitizeText(row.Content)
	local hasContent = string.match(content, "^%s*$") == nil
	instance.LeftText:SetHide(own or not hasContent); instance.LeftHeadFrame:SetHide(own)
	instance.RightText:SetHide(not own or not hasContent); instance.RightHeadFrame:SetHide(not own)
	instance.CardButton:SetOffsetX(own and (m_geometry.rowWidth - m_geometry.bubbleWidth - 48) or 48)
	instance.LeftText:SetWrapWidth(m_geometry.textWrapWidth); instance.RightText:SetWrapWidth(m_geometry.textWrapWidth)
	local textControl = own and instance.RightText or instance.LeftText
	textControl:SetText(content); hookSpeaker(row.SpeakerID, instance, own)
	instance.TheyHeader:SetHide(not isDeal); instance.YouHeader:SetHide(not isDeal); instance.TheyGive:SetHide(not isDeal); instance.YouGive:SetHide(not isDeal)
	instance.DealDivider:SetHide(not isDeal); instance.Pending:SetHide(true)
	local measuredTextHeight = hasContent and textControl:GetSizeY() or 0
	local height = 10 + math.max(24, measuredTextHeight) + 12
	if isDeal then
		local they, you = dealColumns(deal)
		instance.TheyHeader:SetText(colorText(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_THEY_GIVE"), "COLOR_POSITIVE_TEXT"))
		instance.YouHeader:SetText(colorText(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_YOU_GIVE"), "COLOR_NEGATIVE_TEXT"))
		instance.TheyGive:SetText(they); instance.YouGive:SetText(you)
		instance.TheyHeader:SetOffsetX(42); instance.TheyGive:SetOffsetX(42); instance.TheyGive:SetWrapWidth(m_geometry.dealColumnWidth)
		instance.YouHeader:SetOffsetX(m_geometry.dealYouX); instance.YouGive:SetOffsetX(m_geometry.dealYouX); instance.YouGive:SetWrapWidth(m_geometry.dealColumnWidth)
		instance.DealDivider:SetOffsetX(m_geometry.dealDividerX)
		resizeDealBubble(instance, false)
	else
		sizeBubble(instance, height)
	end
	instance.CardButton:SetDisabled(not isDeal); instance.CardButton:SetAlpha(row.Pending and 0.55 or 1)
	return isDeal
end

-- Build one durable row and at most one turn separator.
local function buildRowInstance(row)
	if isSpecialRow(row.Content) then return end
	if m_lastBuiltTurn ~= row.Turn then
		local turn = {}; ContextPtr:BuildInstanceForControl("TurnInstance", turn, Controls.TranscriptStack); turn.Row:SetSizeX(m_geometry.rowWidth); turn.Text:SetText(turnLabel(row.Turn))
	end
	m_lastBuiltTurn = row.Turn
	local instance = {}; ContextPtr:BuildInstanceForControl("MessageInstance", instance, Controls.TranscriptStack)
	local record = { row = row, controls = instance, respond = false }; record.isDeal = bindStaticRow(row, instance)
	if record.isDeal then instance.CardButton:RegisterCallback(Mouse.eLClick, function() openDeal(record.row, record.respond) end) end
	m_rowInstances[row.ID] = record
end

-- Resolve the proposal targeted by a pending phase.
local function pendingProposalID(reduction)
	if m_phase ~= "deal-pending" then return nil end
	if type(m_phaseArg) == "number" then return m_phaseArg end
	if type(m_phaseArg) == "table" then return m_phaseArg.proposalID or m_phaseArg.ProposalMessageID end
	return reduction.active and reduction.active.ID or nil
end

-- Resolve the current pending status label.
local function pendingLabelKey()
	return type(m_phaseArg) == "table" and m_phaseArg.labelKey or "TXT_KEY_VD_DIPLO_PROPOSING"
end

-- Refresh one proposal card in place.
local function refreshDealRow(row, reduction)
	local record = m_rowInstances[row.ID]
	if record == nil then return end
	local instance, active = record.controls, reduction.active ~= nil and reduction.active.ID == row.ID
	local status = active and reduction.status or "superseded"
	local pending = pendingProposalID(reduction) == row.ID
	local textControl = row.SpeakerID == m_activePlayerID and instance.RightText or instance.LeftText
	textControl:SetText(dealSummary(row, status)); resizeDealBubble(instance, pending)
	instance.Pending:SetHide(not pending)
	if pending then addAnimated(instance.Pending, Locale.ConvertTextKey(pendingLabelKey()) .. " ") end
	record.respond = active and reduction.status == "open" and not pending and not isClosedThisTurn(m_rows, m_currentTurn) and isBoundActorCurrent()
	instance.CardButton:SetDisabled(pending); instance.CardButton:SetAlpha((pending or row.Pending) and 0.55 or 1)
end

-- Refresh every proposal after a row or phase change.
local function refreshDealRows(reduction)
	for _, row in ipairs(reduction.proposals) do refreshDealRow(row, reduction) end
end

-- Size a transient bubble after changing wrapped text.
local function resizeTailMessage(instance, extraBottom)
	local textControl = instance.LeftText:IsHidden() and instance.RightText or instance.LeftText
	local height = 10 + math.max(24, textControl:GetSizeY()) + 12 + (extraBottom or 0)
	sizeBubble(instance, height)
end

-- Configure one pooled transient message.
local function bindTailMessage(instance, speakerID, text)
	bindStaticRow({ SpeakerID = speakerID, MessageType = "text", Content = text }, instance); instance.CardButton:SetDisabled(true); resizeTailMessage(instance)
end

-- Build the three transient tail rows once.
local function buildTailPool()
	ContextPtr:BuildInstanceForControl("MessageInstance", m_tail.sending, Controls.TailStack); ContextPtr:BuildInstanceForControl("MessageInstance", m_tail.streaming, Controls.TailStack)
	ContextPtr:BuildInstanceForControl("StatusInstance", m_tail.status, Controls.TailStack)
	m_tail.status.Row:SetSizeX(m_geometry.rowWidth); m_tail.status.Text:SetWrapWidth(m_geometry.rowWidth - 60)
	for _, instance in pairs(m_tail) do instance.Row:SetHide(true) end
end

-- Apply message phases and older-page loading to pooled tail rows.
local function refreshTail(reduction)
	m_animated = {}
	for _, instance in pairs(m_tail) do instance.Row:SetHide(true) end
	local bodyHidden = m_phase == "loading" or m_phase == "no-envoy"
	Controls.TranscriptScroll:SetHide(bodyHidden)
	if m_phase == "sending" then
		local text = type(m_phaseArg) == "string" and sanitizeText(m_phaseArg) or ""
		bindTailMessage(m_tail.sending, m_activePlayerID, text); m_tail.sending.Row:SetHide(false)
		m_tail.sending.Pending:SetHide(false)
		addAnimated(m_tail.sending.Pending, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_SENDING") .. " ")
		resizeTailMessage(m_tail.sending, 22)
	elseif m_phase == "streaming" then
		bindTailMessage(m_tail.streaming, m_counterpartID, m_streamingText); m_tail.streaming.Row:SetHide(false)
	end
	if m_loadingEarlier then
		m_tail.status.Row:SetSizeX(m_geometry.rowWidth); m_tail.status.Text:SetWrapWidth(m_geometry.rowWidth - 60)
		m_tail.status.Row:SetHide(false); addAnimated(m_tail.status.Text, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING_EARLIER") .. " ")
	end
	refreshDealRows(reduction)
end

-- Recalculate geometry and optionally stick the scroll to the bottom.
local function reflowTranscript(stickToBottom)
	Controls.TranscriptStack:CalculateSize(); Controls.TranscriptStack:ReprocessAnchoring()
	Controls.TailStack:SetOffsetY(Controls.TranscriptStack:GetSizeY()); Controls.TailStack:CalculateSize(); Controls.TailStack:ReprocessAnchoring()
	Controls.TranscriptScroll:CalculateInternalSize()
	if stickToBottom then Controls.TranscriptScroll:SetScrollValue(1) end
end

-- Return whether text and deal input are currently locked.
local function inputIsLocked()
	return isClosedThisTurn(m_rows, m_currentTurn) or m_phase ~= "normal"
end

-- Reflow the native-aligned action stack after changing child visibility.
local function reflowActionStack()
	Controls.ActionStack:CalculateSize(); Controls.ActionStack:ReprocessAnchoring()
end

-- Apply visible input gating with an explanatory row.
local function refreshInput()
	local reason, animated = nil, false
	if m_phase == "loading" then reason, animated = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING"), true
	elseif m_phase == "no-envoy" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NO_ENVOY")
	elseif isClosedThisTurn(m_rows, m_currentTurn) then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_CLOSED")
	elseif m_phase == "ack-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOT_DELIVERED")
	elseif m_phase == "reply-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_ENVOY_UNAVAILABLE")
	elseif m_phase ~= "normal" then reason, animated = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_THINKING"), true end
	Controls.InputFrame:SetHide(reason ~= nil); Controls.SendButton:SetHide(reason ~= nil); Controls.InputStatusSlot:SetHide(reason == nil); Controls.InputReason:SetHide(reason == nil)
	if animated then addAnimated(Controls.InputReason, reason .. " ") else Controls.InputReason:SetText(reason or "") end
	local canRetry = (m_phase == "ack-timeout" or m_phase == "reply-timeout") and not m_loadingEarlier
	Controls.InputRetryButton:SetHide(not canRetry)
	local canInteractWithDeals = isBoundActorCurrent()
	Controls.ProposeButton:SetHide(not canInteractWithDeals)
	Controls.ProposeButton:SetDisabled(reason ~= nil or not canInteractWithDeals)
	reflowActionStack()
end

-- Return whether the effective seat may declare war on the counterpart right now.
local function canDeclareWarNow()
	if VoxDeorumSeat.IsPureObserver() or not isBoundActorCurrent() then return false end
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	if active == nil or other == nil then return false end
	local activeTeam, otherTeamID = Teams[active:GetTeam()], other:GetTeam()
	if activeTeam:IsAtWar(otherTeamID) then return false end
	if isHumanStrategist() then return activeTeam:CanDeclareWar(otherTeamID, m_activePlayerID) end
	return activeTeam:CanDeclareWar(otherTeamID)
end

-- Update native war-action visibility.
local function refreshWarButton() 
	Controls.WarButton:SetHide(not canDeclareWarNow())
	reflowActionStack()
end

-- Refresh row-dependent state without rebuilding durable instances.
local function refreshState(stickToBottom)
	local reduction = deriveActiveProposal(m_rows)
	Controls.LoadEarlierButton:SetHide(not m_hasMore or m_phase == "loading" or m_phase == "no-envoy"); Controls.LoadEarlierButton:SetDisabled(m_loadingEarlier)
	refreshTail(reduction); refreshInput(); refreshWarButton(); reflowTranscript(stickToBottom)
end

-- Perform the full rebuild reserved for open, reset, and prepend.
local function rebuildRows(stickToBottom)
	Controls.TranscriptStack:DestroyAllChildren(); m_rowInstances, m_lastBuiltTurn = {}, nil
	for _, row in ipairs(m_rows) do buildRowInstance(row) end
	refreshState(stickToBottom)
end

-- Capture the first durable row visible at the top of the transcript viewport.
local function captureScrollAnchor()
	local viewport = Controls.TranscriptScroll:GetSizeY()
	local contentHeight = Controls.TranscriptStack:GetSizeY() + Controls.TailStack:GetSizeY()
	local scrollTop = Controls.TranscriptScroll:GetScrollValue() * math.max(0, contentHeight - viewport)
	local anchorID, proportion = nil, 0
	for _, row in ipairs(m_rows) do
		local record = m_rowInstances[row.ID]
		if record ~= nil then
			local rowY = record.controls.Row:GetOffsetY()
			local rowHeight = math.max(1, record.controls.Row:GetSizeY())
			if scrollTop < rowY then
				anchorID, proportion = row.ID, 0
				break
			elseif scrollTop < rowY + rowHeight then
				anchorID = row.ID
				proportion = math.max(0, math.min(1, (scrollTop - rowY) / rowHeight))
				break
			end
		end
	end
	return { id = anchorID, proportion = proportion, fallback = scrollTop }
end

-- Restore the same proportional point within a rebuilt durable row.
local function restoreScrollAnchor(anchor)
	local viewport = Controls.TranscriptScroll:GetSizeY()
	local contentHeight = Controls.TranscriptStack:GetSizeY() + Controls.TailStack:GetSizeY()
	local scrollTop = anchor.fallback
	local record = anchor.id ~= nil and m_rowInstances[anchor.id] or nil
	if record ~= nil then
		local proportion = math.max(0, math.min(1, anchor.proportion or 0))
		local rowHeight = record.controls.Row:GetSizeY()
		local withinRow = math.min(math.max(0, rowHeight - 1), proportion * rowHeight)
		scrollTop = record.controls.Row:GetOffsetY() + withinRow
	end
	Controls.TranscriptScroll:SetScrollValue(math.max(0, math.min(1, scrollTop / math.max(1, contentHeight - viewport))))
end

-- Rebuild wrapped rows after a resolution change and preserve scroll intent.
local function onSystemUpdateUI(uiType)
	if uiType ~= SystemUpdateUIType.ScreenResize then return end
	local stickToBottom = isAtBottom()
	local anchor = not stickToBottom and captureScrollAnchor() or nil
	layoutPanel(); rebuildRows(stickToBottom)
	if anchor ~= nil then restoreScrollAnchor(anchor) end
end

-- Clear the panel before a new pair or server reflush.
local function reset(meta)
	m_rows, m_rowByID, m_rowInstances, m_lastBuiltTurn, m_streamingText = {}, {}, {}, nil, ""
	m_hasMore, m_loadingEarlier = meta and meta.hasMore == true or false, false
	if meta == nil then m_phase = "loading" elseif meta.hasEnvoy == false then m_phase = "no-envoy" elseif meta.busy then m_phase = "thinking" else m_phase = "normal" end
	m_phaseArg, m_dotSeconds, m_dotCount = nil, 0, 1
	Controls.TranscriptStack:DestroyAllChildren(); refreshState(true)
end

-- Replace the transcript and rebuild it once.
local function setRows(rows)
	m_rows, m_rowByID = {}, {}
	for _, row in ipairs(rows or {}) do
		if row.ID ~= nil and m_rowByID[row.ID] == nil then m_rowByID[row.ID] = row; table.insert(m_rows, row) end
	end
	rebuildRows(true)
end

-- Append one deduplicated row without touching existing instances.
local function appendRow(row)
	if row == nil or row.ID == nil or m_rowByID[row.ID] ~= nil then return false end
	local stick = isAtBottom(); m_rowByID[row.ID] = row; table.insert(m_rows, row); buildRowInstance(row)
	if m_phase == "streaming" then m_phase, m_phaseArg, m_streamingText = "normal", nil, "" end
	refreshState(stick); return true
end

-- Prepend older rows and restore the old content's approximate viewport.
local function prependRows(rows, hasMore)
	local oldValue, oldHeight, viewport = Controls.TranscriptScroll:GetScrollValue(), Controls.TranscriptStack:GetSizeY() + Controls.TailStack:GetSizeY(), Controls.TranscriptScroll:GetSizeY()
	local merged, seen = {}, {}
	for _, row in ipairs(rows or {}) do if row.ID ~= nil and not seen[row.ID] then seen[row.ID] = true; table.insert(merged, row) end end
	for _, row in ipairs(m_rows) do if row.ID ~= nil and not seen[row.ID] then seen[row.ID] = true; table.insert(merged, row) end end
	m_rows, m_rowByID, m_hasMore, m_loadingEarlier = merged, {}, hasMore == true, false
	for _, row in ipairs(m_rows) do m_rowByID[row.ID] = row end
	rebuildRows(false)
	local newHeight = Controls.TranscriptStack:GetSizeY() + Controls.TailStack:GetSizeY()
	local restored = (oldValue * math.max(0, oldHeight - viewport) + math.max(0, newHeight - oldHeight)) / math.max(1, newHeight - viewport)
	Controls.TranscriptScroll:SetScrollValue(math.max(0, math.min(1, restored)))
end

-- Change the transient phase in place.
local function setPhase(phase, arg)
	local stick = isAtBottom(); m_phase, m_phaseArg, m_dotSeconds = phase or "normal", arg, 0
	if m_phase ~= "streaming" then m_streamingText = "" end
	refreshState(stick)
end

-- Update streaming text and reflow only when the bubble height changes.
local function setStreamingText(text)
	local oldHeight, stick = m_tail.streaming.Row:GetSizeY(), isAtBottom(); m_streamingText = sanitizeText(text)
	if m_phase == "streaming" then
		bindTailMessage(m_tail.streaming, m_counterpartID, m_streamingText); m_tail.streaming.Row:SetHide(false)
		if oldHeight ~= m_tail.streaming.Row:GetSizeY() then reflowTranscript(stick) end
	end
end

-- Change older-page availability.
local function setHasMore(flag)
	m_hasMore = flag == true; Controls.LoadEarlierButton:SetHide(not m_hasMore or m_phase == "loading" or m_phase == "no-envoy")
end

-- Change the turn used by closure derivation.
local function setCurrentTurn(turn)
	local stick = isAtBottom(); m_currentTurn = tonumber(turn) or Game.GetGameTurn(); refreshState(stick)
end

-- Tick animated labels and the active driver.
local function onUpdate(delta)
	m_dotSeconds = m_dotSeconds + delta
	if m_dotSeconds >= 0.45 then m_dotSeconds, m_dotCount = 0, (m_dotCount % 3) + 1; for _, entry in ipairs(m_animated) do applyAnimated(entry) end end
	if VoxDeorumDiploUI.driver ~= nil and VoxDeorumDiploUI.driver.onUpdate ~= nil then VoxDeorumDiploUI.driver.onUpdate(delta) end
end

-- Track diplomacy notifications in both directions, caching each message for
-- the counterpart-less activation path.
local function onNotificationAdded(id, notificationType, tooltip, summary, gameValue, extraGameData, playerID)
	local expected = NotificationTypes and NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY
	if expected == nil or notificationType ~= expected or playerID ~= Game.GetActivePlayer() then return end
	m_notificationIDs[gameValue] = m_notificationIDs[gameValue] or {}; m_notificationIDs[gameValue][id] = true; m_notificationOwner[id] = gameValue
	m_notificationMessages[id] = tooltip
end

-- Prune indexes after native or programmatic removal.
local function onNotificationRemoved(id)
	m_notificationMessages[id] = nil
	local owner = m_notificationOwner[id]; if owner == nil then return end
	local ids = m_notificationIDs[owner]
	if ids ~= nil then ids[id] = nil; if next(ids) == nil then m_notificationIDs[owner] = nil end end
	m_notificationOwner[id] = nil
end

-- Remove all tracked notifications for one pair.
local function dismissPairNotifications(counterpartID)
	local ids = {}; for id in pairs(m_notificationIDs[counterpartID] or {}) do table.insert(ids, id) end
	for _, id in ipairs(ids) do UI.RemoveNotification(id) end
	m_notificationIDs[counterpartID] = nil
end

-- Return whether a target is a live major civilization.
local function isValidCounterpart(counterpartID)
	local other = Players[counterpartID]
	return counterpartID ~= VoxDeorumSeat.EffectiveSeat() and other ~= nil and other:IsAlive() and not other:IsMinorCiv() and not other:IsBarbarian()
end

-- Abort a pending leaderhead poke and return the context to dormancy.
local function cancelPending()
	if m_presentation ~= "pending" then return end
	m_presentation, m_pendingCounterpartID, m_pendingSeconds = nil, -1, 0
	ContextPtr:ClearUpdate(); ContextPtr:SetHide(true); Controls.MainGrid:SetHide(false)
end

-- Show the panel in an explicit presentation mode: "leader" overlays the live
-- animated leaderhead as a popup above LeaderHeadRoot (the TradeLogic pattern);
-- "static" is the dimmed full-screen fallback for mocks, pure observers, and
-- failed pokes. The mode is passed explicitly rather than sniffed from
-- UI.GetLeaderHeadRootUp() to avoid event-ordering races.
local function presentPanel(counterpartID, mode)
	if not isValidCounterpart(counterpartID) then return end
	cancelPending()
	local wasQueued = m_presentation == "leader"
	m_activePlayerID, m_counterpartID, m_currentTurn, m_warPromptOpen = VoxDeorumSeat.EffectiveSeat(), counterpartID, Game.GetGameTurn(), false
	m_isPureObserver = VoxDeorumSeat.IsPureObserver()
	populateHeader()
	m_presentation = mode
	Controls.WarDim:SetHide(true); Controls.MainGrid:SetHide(false)
	reset(nil)
	-- Keep at most one popup-stack entry across re-opens and mode switches.
	if mode == "leader" then
		if not wasQueued then UIManager:QueuePopup(ContextPtr, PopupPriority.LeaderTrade) end
	elseif wasQueued then
		UIManager:DequeuePopup(ContextPtr)
	end
	ContextPtr:SetHide(false); ContextPtr:SetUpdate(onUpdate)
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onOpen ~= nil then driver.onOpen(m_counterpartID, m_activePlayerID) end
end

-- Close without mutating the conversation. Over-leader mode dequeues back to
-- the native root options: root-up was never cleared, so LeaderHeadRoot's
-- show-handler restores Discuss/Trade/Converse/War when it resurfaces.
local function hidePanel()
	if m_presentation == "pending" then cancelPending(); return end
	if m_presentation == nil then return end
	local wasLeader = m_presentation == "leader"
	m_presentation, m_warPromptOpen = nil, false
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onHide ~= nil then driver.onHide() end
	Controls.WarDim:SetHide(true); ContextPtr:ClearUpdate()
	if wasLeader then UIManager:DequeuePopup(ContextPtr) end
	ContextPtr:SetHide(true)
end

-- Convert an open over-leader panel to the static fallback without touching
-- the conversation or the driver (scene torn down or another audience arrived).
local function demoteToStatic()
	m_presentation = "static"
	UIManager:DequeuePopup(ContextPtr)
	ContextPtr:SetHide(false)
end

-- Tick the poke timeout on a visible-but-empty context; a hidden context
-- cannot rely on SetUpdate ticking. Never calls driver.onUpdate: the driver
-- has not been opened yet.
local function onPendingUpdate(delta)
	m_pendingSeconds = m_pendingSeconds + delta
	if m_pendingSeconds >= PENDING_POKE_TIMEOUT then
		local counterpartID = m_pendingCounterpartID
		cancelPending(); presentPanel(counterpartID, "static")
	end
end

-- Ask the engine to raise the leaderhead for a notification open; the panel
-- opens over it when the matching AILeaderMessage arrives, or falls back to
-- the static presentation on poke failure or timeout.
local function beginPendingOpen(counterpartID)
	m_presentation, m_pendingCounterpartID, m_pendingSeconds = "pending", counterpartID, 0
	Controls.MainGrid:SetHide(true); ContextPtr:SetHide(false)
	ContextPtr:SetUpdate(onPendingUpdate)
	local ok = pcall(function() Players[counterpartID]:DoBeginDiploWithHuman() end)
	if not ok then cancelPending(); presentPanel(counterpartID, "static") end
end

-- Open from the leader-screen action, over the scene when it shows this leader.
local function onConverseOpen(counterpartID)
	presentPanel(counterpartID, m_sceneLeaderID == counterpartID and "leader" or "static")
end

-- Track the leader on the native scene: resolve pending pokes, and step aside
-- (demote to static) when a different audience arrives mid-conversation so the
-- incoming leader UI is unobstructed.
local function onPanelAILeaderMessage(diploPlayerID)
	m_sceneLeaderID = diploPlayerID or -1
	if m_presentation == "pending" then
		local counterpartID = m_pendingCounterpartID
		cancelPending()
		presentPanel(counterpartID, m_sceneLeaderID == counterpartID and "leader" or "static")
	elseif m_presentation == "leader" and m_sceneLeaderID ~= m_counterpartID then
		demoteToStatic()
	end
end

-- Fall back to the static presentation if the engine tears the scene down
-- under an open panel; a pending poke instead rides out its timeout.
local function onPanelLeavingLeaderView()
	m_sceneLeaderID = -1
	if m_presentation == "leader" then demoteToStatic() end
end

-- A valid counterpart opens the conversation and dismisses its pair notifications;
-- a counterpart-less notification shows its cached message in a text dialog. The
-- message is read before removal, since UI.RemoveNotification prunes the cache.
local function onNotificationActivated(notificationID, counterpartID, extra)
	if isValidCounterpart(counterpartID) then
		UI.RemoveNotification(notificationID); dismissPairNotifications(counterpartID)
		if m_sceneLeaderID == counterpartID then presentPanel(counterpartID, "leader")
		elseif VoxDeorumSeat.IsPureObserver() or m_sceneLeaderID ~= -1 then presentPanel(counterpartID, "static")
		else beginPendingOpen(counterpartID) end
	else
		local message = m_notificationMessages[notificationID]
		UI.RemoveNotification(notificationID)
		if message ~= nil and message ~= "" then
			UI.AddPopup{ Type = ButtonPopupTypes.BUTTONPOPUP_TEXT, Data1 = 800, Text = message }
		end
	end
end

-- Send one sanitized non-empty value through the driver.
local function sendText(text)
	local clean = sanitizeText(text)
	if inputIsLocked() or string.match(clean, "^%s*$") then return end
	Controls.InputBox:ClearString()
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onSend ~= nil then driver.onSend(clean) end
end

-- Strip delimiters live and send on Enter.
local function onInputChanged(_, _, isEnter)
	local raw = Controls.InputBox:GetText(); local clean = sanitizeText(raw)
	if clean ~= raw then Controls.InputBox:SetText(clean) end
	if isEnter then sendText(clean) end
end

-- Send from the footer button.
local function onSend() sendText(Controls.InputBox:GetText()) end

-- Open deal authoring when input is available.
local function onProposeDeal()
	if isBoundActorCurrent() and not inputIsLocked() then LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, nil, nil) end
end

-- Show the native-war confirmation overlay.
local function onDeclareWar()
	if not canDeclareWarNow() then return end
	m_warPromptOpen = true; Controls.WarDim:SetHide(false)
end

-- Cancel native-war confirmation.
local function cancelDeclareWar() m_warPromptOpen = false; Controls.WarDim:SetHide(true) end

-- Confirm native war against current team state. Our declare path bypasses
-- FROM_UI_DIPLO_EVENT_HUMAN_DECLARES_WAR, so the leaderhead would keep a stale
-- mood; after declaring over the live scene, close and leave the audience.
local function confirmDeclareWar()
	local declared = canDeclareWarNow()
	if declared then
		local counterpartTeamID = Players[m_counterpartID]:GetTeam()
		if isHumanStrategist() then Teams[Players[m_activePlayerID]:GetTeam()]:DeclareWar(counterpartTeamID, false, m_activePlayerID)
		else Network.SendChangeWar(counterpartTeamID, true) end
	end
	cancelDeclareWar()
	if declared and m_presentation == "leader" then
		hidePanel()
		pcall(function() UI.SetLeaderHeadRootUp(false); UI.RequestLeaveLeader() end)
	else
		refreshWarButton()
	end
end

-- Show the loading-earlier tail and ask the driver for a page.
local function onLoadEarlier()
	if not m_hasMore or m_loadingEarlier then return end
	m_loadingEarlier = true; refreshState(isAtBottom())
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onLoadEarlier ~= nil then driver.onLoadEarlier() end
end

-- Handle Escape locally.
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE and not ContextPtr:IsHidden() then
		if m_warPromptOpen then cancelDeclareWar() else hidePanel() end
		return true
	end
	return false
end

-- Keep the per-frame update armed across popup-stack show/hide cycles. Never
-- calls driver.onHide or hidePanel here: dequeue-triggered hides must not
-- double-fire the driver or recurse.
local function showHideHandler(isHide, isInit)
	if isInit then return end
	if isHide then ContextPtr:ClearUpdate()
	elseif m_presentation == "leader" or m_presentation == "static" then ContextPtr:SetUpdate(onUpdate) end
end

-- Expose the stable interface shared by mock and transport drivers.
VoxDeorumDiploUI = { reset = reset, setRows = setRows, appendRow = appendRow, prependRows = prependRows, setPhase = setPhase, setStreamingText = setStreamingText, setHasMore = setHasMore, setCurrentTurn = setCurrentTurn, driver = {} }

buildTailPool()
Events.NotificationAdded.Add(onNotificationAdded); Events.NotificationRemoved.Add(onNotificationRemoved)
Events.AILeaderMessage.Add(onPanelAILeaderMessage); Events.LeavingLeaderViewMode.Add(onPanelLeavingLeaderView)
LuaEvents.VoxDeorumDiploOpen.Add(onConverseOpen); LuaEvents.VoxDeorumDiplomacyNotificationActivated.Add(onNotificationActivated)
Controls.GoodbyeButton:RegisterCallback(Mouse.eLClick, hidePanel)
Controls.LoadEarlierButton:RegisterCallback(Mouse.eLClick, onLoadEarlier); Controls.InputBox:RegisterCallback(onInputChanged); Controls.SendButton:RegisterCallback(Mouse.eLClick, onSend)
-- Retry a timed-out request through whichever conversation driver is active.
Controls.InputRetryButton:RegisterCallback(Mouse.eLClick, function()
	if VoxDeorumDiploUI.driver ~= nil and VoxDeorumDiploUI.driver.onRetry ~= nil then VoxDeorumDiploUI.driver.onRetry() end
end)
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onProposeDeal); Controls.WarButton:RegisterCallback(Mouse.eLClick, onDeclareWar)
Controls.WarYesButton:RegisterCallback(Mouse.eLClick, confirmDeclareWar); Controls.WarNoButton:RegisterCallback(Mouse.eLClick, cancelDeclareWar)
ContextPtr:SetInputHandler(inputHandler); ContextPtr:SetShowHideHandler(showHideHandler)
layoutPanel(); Events.SystemUpdateUI.Add(onSystemUpdateUI)

include("VoxDeorumDiploPanelMock")
