-- Vox Deorum diplomacy conversation panel.
-- Bubble design adapted with credit to @schnetziomi5's diplomacy-message-log modmod.
-- Deal reduction mirrors vox-agents/src/utils/diplomacy/deal-reduce.ts.

include("IconSupport")

local DELIMITER = "!@#$%^!"
local DELIMITER_PATTERN = string.gsub(DELIMITER, "%W", "%%%1")
local NOTIFICATION_NAME = "NOTIFICATION_VOX_DEORUM_DIPLOMACY"
local BUBBLE_WIDTH = 760
local STATUS_KEYS = {
	open = "TXT_KEY_VD_DIPLO_STATUS_OPEN", accepted = "TXT_KEY_VD_DIPLO_STATUS_ACCEPTED",
	rejected = "TXT_KEY_VD_DIPLO_STATUS_REJECTED", enacted = "TXT_KEY_VD_DIPLO_STATUS_ENACTED",
	superseded = "TXT_KEY_VD_DIPLO_STATUS_SUPERSEDED",
}
local m_counterpartID, m_activePlayerID = -1, -1
local m_rows, m_rowByID, m_rowInstances = {}, {}, {}
local m_lastBuiltTurn, m_currentTurn = nil, 0
local m_phase, m_phaseArg, m_streamingText = "loading", nil, ""
local m_hasMore, m_loadingEarlier = false, false
local m_dotSeconds, m_dotCount, m_animated = 0, 1, {}
local m_tail = { sending = {}, streaming = {}, status = {}, closed = {} }
local m_notificationIDs, m_notificationOwner = {}, {}
local m_warPromptOpen = false

ContextPtr:SetHide(true)

-- Fit the panel inside a 1024x720 screen while preserving the footer.
local function layoutPanel()
	local screenW, screenH = UIManager:GetScreenSizeVal()
	local targetW, targetH = math.max(1000, math.min(1050, screenW - 24)), math.max(640, math.min(740, screenH - 16))
	local transcriptW, transcriptH = math.min(930, targetW - 80), math.max(360, targetH - 268)
	local inputW = math.max(620, targetW - 320)
	Controls.MainGrid:SetSizeVal(targetW, targetH); Controls.WarDim:SetSizeVal(targetW, targetH)
	Controls.TranscriptScroll:SetSizeVal(transcriptW, transcriptH); Controls.TranscriptBar:SetSizeY(math.max(200, transcriptH - 42))
	Controls.InputFrame:SetSizeX(inputW); Controls.InputBox:SetSizeX(inputW - 20)
	Controls.MainGrid:ReprocessAnchoring(); Controls.TranscriptScroll:CalculateInternalSize()
end

-- Recompute safe bounds when the game resolution changes.
local function onSystemUpdateUI(uiType)
	if uiType == SystemUpdateUIType.ScreenResize then layoutPanel() end
end

-- Strip the named-pipe delimiter from text.
local function sanitizeText(value)
	return string.gsub(tostring(value or ""), DELIMITER_PATTERN, "")
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
	local player = Players[playerID]
	local leaderName, civName = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_UNKNOWN_LEADER"), Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_UNKNOWN_CIV")
	if player ~= nil then
		leaderName = player:GetName()
		local civ = GameInfo.Civilizations[player:GetCivilizationType()]
		if civ ~= nil then civName = Locale.ConvertTextKey(civ.ShortDescription) end
	end
	return Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_SPEAKER_TITLE", leaderName, civName)
end

-- Hook a leader portrait and civilization badge into a bubble.
local function hookSpeaker(playerID, controls, ownSide)
	local player = Players[playerID]
	if player == nil then return end
	local leader, head = GameInfo.Leaders[player:GetLeaderType()], ownSide and controls.RightHead or controls.LeftHead
	if leader ~= nil and IconHookup ~= nil then IconHookup(leader.PortraitIndex, 64, leader.IconAtlas, head) end
	if CivIconHookup ~= nil then
		if ownSide then CivIconHookup(playerID, 32, controls.RightCivIcon, controls.RightCivIconBG, controls.RightCivIconShadow, false, true)
		else CivIconHookup(playerID, 32, controls.LeftCivIcon, controls.LeftCivIconBG, controls.LeftCivIconShadow, false, true) end
	end
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
	for _, item in ipairs((deal and deal.items) or {}) do table.insert(item.fromPlayerID == m_counterpartID and they or you, itemLabel(item)) end
	for _, promise in ipairs((deal and deal.promises) or {}) do table.insert(promise.promiserID == m_counterpartID and they or you, promiseLabel(promise)) end
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
	LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, row.Payload and row.Payload.Deal or nil, respond and row.ID or nil)
end

-- Apply the shared bubble geometry for one message instance.
local function sizeBubble(instance, height)
	instance.Row:SetSizeVal(900, height + 8); instance.CardButton:SetSizeVal(BUBBLE_WIDTH, height); instance.Bubble:SetSizeVal(BUBBLE_WIDTH, height); instance.Border:SetSizeVal(BUBBLE_WIDTH + 4, height + 4)
end

-- Bind all bubble details that do not depend on later rows.
local function bindStaticRow(row, instance)
	local own = row.SpeakerID == m_activePlayerID
	instance.LeftTitle:SetHide(own); instance.LeftText:SetHide(own); instance.LeftHeadFrame:SetHide(own)
	instance.RightTitle:SetHide(not own); instance.RightText:SetHide(not own); instance.RightHeadFrame:SetHide(not own)
	instance.CardButton:SetOffsetX(own and 92 or 48)
	local textControl, titleControl = own and instance.RightText or instance.LeftText, own and instance.RightTitle or instance.LeftTitle
	local isDeal, deal, content = row.MessageType == "deal-proposal" or row.MessageType == "deal-counter", row.Payload and row.Payload.Deal, row.Content
	titleControl:SetText(speakerTitle(row.SpeakerID)); textControl:SetText(sanitizeText(content)); hookSpeaker(row.SpeakerID, instance, own)
	instance.TheyHeader:SetHide(not isDeal); instance.YouHeader:SetHide(not isDeal); instance.TheyGive:SetHide(not isDeal); instance.YouGive:SetHide(not isDeal)
	instance.DealDivider:SetHide(not isDeal); instance.DealStatus:SetHide(not isDeal); instance.Pending:SetHide(true)
	local textHeight = math.max(24, textControl:GetSizeY())
	local height = 38 + textHeight + 16
	if isDeal then
		local they, you = dealColumns(deal); instance.TheyGive:SetText(they); instance.YouGive:SetText(you)
		local dealTop = 38 + textHeight + 14
		instance.TheyHeader:SetOffsetY(dealTop); instance.YouHeader:SetOffsetY(dealTop); instance.TheyGive:SetOffsetY(dealTop + 24); instance.YouGive:SetOffsetY(dealTop + 24); instance.DealDivider:SetOffsetY(dealTop - 2)
		height = dealTop + 24 + math.max(instance.TheyGive:GetSizeY(), instance.YouGive:GetSizeY()) + 28
	end
	sizeBubble(instance, height)
	instance.CardButton:SetDisabled(not isDeal); instance.CardButton:SetAlpha(row.Pending and 0.55 or 1)
	return isDeal
end

-- Build one durable row and at most one turn separator.
local function buildRowInstance(row)
	if isSpecialRow(row.Content) then return end
	if m_lastBuiltTurn ~= row.Turn then
		local turn = {}; ContextPtr:BuildInstanceForControl("TurnInstance", turn, Controls.TranscriptStack); turn.Text:SetText(turnLabel(row.Turn))
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
	instance.DealStatus:SetText(Locale.ToUpper(Locale.ConvertTextKey(STATUS_KEYS[status] or STATUS_KEYS.superseded)))
	local pending = pendingProposalID(reduction) == row.ID
	instance.Pending:SetHide(not pending)
	if pending then addAnimated(instance.Pending, Locale.ConvertTextKey(pendingLabelKey()) .. " ") end
	record.respond = active and reduction.status == "open" and not pending and not isClosedThisTurn(m_rows, m_currentTurn)
	instance.CardButton:SetDisabled(pending); instance.CardButton:SetAlpha((pending or row.Pending) and 0.55 or 1)
end

-- Refresh every proposal after a row or phase change.
local function refreshDealRows(reduction)
	for _, row in ipairs(reduction.proposals) do refreshDealRow(row, reduction) end
end

-- Size a transient bubble after changing wrapped text.
local function resizeTailMessage(instance)
	local textControl = instance.LeftText:IsHidden() and instance.RightText or instance.LeftText
	local height = 38 + math.max(24, textControl:GetSizeY()) + 16
	sizeBubble(instance, height)
end

-- Configure one pooled transient message.
local function bindTailMessage(instance, speakerID, text)
	bindStaticRow({ SpeakerID = speakerID, MessageType = "text", Content = text }, instance); instance.CardButton:SetDisabled(true); resizeTailMessage(instance)
end

-- Build the four transient tail rows once.
local function buildTailPool()
	ContextPtr:BuildInstanceForControl("MessageInstance", m_tail.sending, Controls.TailStack); ContextPtr:BuildInstanceForControl("MessageInstance", m_tail.streaming, Controls.TailStack)
	ContextPtr:BuildInstanceForControl("StatusInstance", m_tail.status, Controls.TailStack); ContextPtr:BuildInstanceForControl("StatusInstance", m_tail.closed, Controls.TailStack)
	for _, instance in pairs(m_tail) do instance.Row:SetHide(true) end
	m_tail.status.RetryButton:RegisterCallback(Mouse.eLClick, function()
		if VoxDeorumDiploUI.driver ~= nil and VoxDeorumDiploUI.driver.onRetry ~= nil then VoxDeorumDiploUI.driver.onRetry() end
	end)
end

-- Apply the current phase to pooled tail rows and the centered status label.
local function refreshTail(reduction)
	m_animated = {}
	for _, instance in pairs(m_tail) do instance.Row:SetHide(true) end
	m_tail.status.RetryButton:SetHide(true); Controls.PanelStatus:SetHide(true)
	local bodyHidden = m_phase == "loading" or m_phase == "no-envoy"
	Controls.TranscriptScroll:SetHide(bodyHidden)
	if m_phase == "loading" then
		Controls.PanelStatus:SetHide(false); addAnimated(Controls.PanelStatus, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING") .. " ")
	elseif m_phase == "no-envoy" then
		Controls.PanelStatus:SetText(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NO_ENVOY")); Controls.PanelStatus:SetHide(false)
	elseif m_phase == "sending" then
		local text = type(m_phaseArg) == "string" and sanitizeText(m_phaseArg) or ""
		local prefix = text .. " (" .. Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_SENDING") .. " "
		bindTailMessage(m_tail.sending, m_activePlayerID, prefix .. "...)"); m_tail.sending.Row:SetHide(false)
		local control = m_tail.sending.RightText:IsHidden() and m_tail.sending.LeftText or m_tail.sending.RightText
		addAnimated(control, prefix, ")")
	elseif m_phase == "thinking" and not m_loadingEarlier then
		m_tail.status.Row:SetHide(false); addAnimated(m_tail.status.Text, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_THINKING") .. " ")
	elseif m_phase == "streaming" then
		bindTailMessage(m_tail.streaming, m_counterpartID, m_streamingText); m_tail.streaming.Row:SetHide(false)
	elseif (m_phase == "ack-timeout" or m_phase == "reply-timeout") and not m_loadingEarlier then
		local key = m_phase == "ack-timeout" and "TXT_KEY_VD_DIPLO_NOT_DELIVERED" or "TXT_KEY_VD_DIPLO_ENVOY_UNAVAILABLE"
		m_tail.status.Text:SetText(Locale.ConvertTextKey(key)); m_tail.status.RetryButton:SetHide(false); m_tail.status.Row:SetHide(false)
	end
	if m_loadingEarlier then
		m_tail.status.RetryButton:SetHide(true)
		m_tail.status.Row:SetHide(false); addAnimated(m_tail.status.Text, Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING_EARLIER") .. " ")
	end
	if not bodyHidden and isClosedThisTurn(m_rows, m_currentTurn) then
		m_tail.closed.Text:SetText(Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_CLOSED")); m_tail.closed.RetryButton:SetHide(true); m_tail.closed.Row:SetHide(false)
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

-- Apply visible input gating with an explanatory row.
local function refreshInput()
	local reason = nil
	if m_phase == "loading" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_LOADING")
	elseif m_phase == "no-envoy" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NO_ENVOY")
	elseif isClosedThisTurn(m_rows, m_currentTurn) then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_CLOSED")
	elseif m_phase == "ack-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_NOT_DELIVERED")
	elseif m_phase == "reply-timeout" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_ENVOY_UNAVAILABLE")
	elseif m_phase ~= "normal" then reason = Locale.ConvertTextKey("TXT_KEY_VD_DIPLO_BUSY") end
	Controls.InputFrame:SetHide(reason ~= nil); Controls.SendButton:SetHide(reason ~= nil); Controls.InputReason:SetHide(reason == nil); Controls.InputReason:SetText(reason or "")
	Controls.ProposeButton:SetDisabled(reason ~= nil)
end

-- Return whether the active player may declare war on the counterpart right now.
local function canDeclareWarNow()
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	if active == nil or other == nil then return false end
	local activeTeam, otherTeamID = Teams[active:GetTeam()], other:GetTeam()
	return not activeTeam:IsAtWar(otherTeamID) and activeTeam:CanDeclareWar(otherTeamID)
end

-- Update native war-action visibility.
local function refreshWarButton()
	Controls.WarButton:SetHide(not canDeclareWarNow())
end

-- Refresh row-dependent state without rebuilding durable instances.
local function refreshState(stickToBottom)
	local reduction = deriveActiveProposal(m_rows)
	Controls.HeaderTurn:SetText(turnLabel(m_currentTurn)); Controls.LoadEarlierButton:SetHide(not m_hasMore or m_phase == "loading" or m_phase == "no-envoy"); Controls.LoadEarlierButton:SetDisabled(m_loadingEarlier)
	refreshTail(reduction); refreshInput(); refreshWarButton(); reflowTranscript(stickToBottom)
end

-- Perform the full rebuild reserved for open, reset, and prepend.
local function rebuildRows(stickToBottom)
	Controls.TranscriptStack:DestroyAllChildren(); m_rowInstances, m_lastBuiltTurn = {}, nil
	for _, row in ipairs(m_rows) do buildRowInstance(row) end
	refreshState(stickToBottom)
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

-- Change the turn used by header and closure derivation.
local function setCurrentTurn(turn)
	local stick = isAtBottom(); m_currentTurn = tonumber(turn) or Game.GetGameTurn(); refreshState(stick)
end

-- Tick animated labels and the active driver.
local function onUpdate(delta)
	m_dotSeconds = m_dotSeconds + delta
	if m_dotSeconds >= 0.45 then m_dotSeconds, m_dotCount = 0, (m_dotCount % 3) + 1; for _, entry in ipairs(m_animated) do applyAnimated(entry) end end
	if VoxDeorumDiploUI.driver ~= nil and VoxDeorumDiploUI.driver.onUpdate ~= nil then VoxDeorumDiploUI.driver.onUpdate(delta) end
end

-- Post one native diplomacy notification.
local function postNotification(playerID, counterpartID, summary, message)
	local player = Players[playerID]; if player == nil then return false end
	player:AddNotificationName(NOTIFICATION_NAME, sanitizeText(message), sanitizeText(summary), -1, -1, counterpartID, counterpartID); return true
end

-- Track diplomacy notifications in both directions.
local function onNotificationAdded(id, notificationType, tooltip, summary, gameValue, extraGameData, playerID)
	local expected = NotificationTypes and NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY
	if expected == nil or notificationType ~= expected or playerID ~= Game.GetActivePlayer() then return end
	m_notificationIDs[gameValue] = m_notificationIDs[gameValue] or {}; m_notificationIDs[gameValue][id] = true; m_notificationOwner[id] = gameValue
end

-- Prune indexes after native or programmatic removal.
local function onNotificationRemoved(id)
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
	return other ~= nil and other:IsAlive() and not other:IsMinorCiv() and not other:IsBarbarian()
end

-- Show the dormant addin and ask the driver to populate it.
local function showPanel(counterpartID)
	if not isValidCounterpart(counterpartID) then return end
	m_activePlayerID, m_counterpartID, m_currentTurn, m_warPromptOpen = Game.GetActivePlayer(), counterpartID, Game.GetGameTurn(), false
	Controls.WarDim:SetHide(true); reset(nil); ContextPtr:SetHide(false); ContextPtr:SetUpdate(onUpdate)
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onOpen ~= nil then driver.onOpen(m_counterpartID, m_activePlayerID) end
end

-- Hide the addin without mutating the conversation.
local function hidePanel()
	m_warPromptOpen = false
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onHide ~= nil then driver.onHide() end
	Controls.WarDim:SetHide(true); ContextPtr:ClearUpdate(); ContextPtr:SetHide(true)
end

-- Open from the leader-screen action.
local function onConverseOpen(counterpartID) showPanel(counterpartID) end

-- Open only valid notification targets, then dismiss their pair notifications.
local function onNotificationActivated(notificationID, counterpartID, extra)
	if not isValidCounterpart(counterpartID) then return end
	UI.RemoveNotification(notificationID); dismissPairNotifications(counterpartID); showPanel(counterpartID)
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
	if not inputIsLocked() then LuaEvents.VoxDeorumOpenDealScreen(m_counterpartID, nil, nil) end
end

-- Show the native-war confirmation overlay.
local function onDeclareWar() m_warPromptOpen = true; Controls.WarDim:SetHide(false) end

-- Cancel native-war confirmation.
local function cancelDeclareWar() m_warPromptOpen = false; Controls.WarDim:SetHide(true) end

-- Confirm native war against current team state.
local function confirmDeclareWar()
	if canDeclareWarNow() then Network.SendChangeWar(Players[m_counterpartID]:GetTeam(), true) end
	cancelDeclareWar(); refreshWarButton()
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

-- Clear updates if another context hides the panel.
local function showHideHandler(isHide, isInit)
	if isHide and not isInit then ContextPtr:ClearUpdate() end
end

-- Expose the stable interface shared by mock and transport drivers.
VoxDeorumDiploUI = { reset = reset, setRows = setRows, appendRow = appendRow, prependRows = prependRows, setPhase = setPhase, setStreamingText = setStreamingText, setHasMore = setHasMore, setCurrentTurn = setCurrentTurn, driver = {} }

buildTailPool()
Game.RegisterFunction("VoxDeorumPostNotification", postNotification)
Events.NotificationAdded.Add(onNotificationAdded); Events.NotificationRemoved.Add(onNotificationRemoved)
LuaEvents.VoxDeorumDiploOpen.Add(onConverseOpen); LuaEvents.VoxDeorumDiplomacyNotificationActivated.Add(onNotificationActivated)
Controls.CloseButton:RegisterCallback(Mouse.eLClick, hidePanel); Controls.GoodbyeButton:RegisterCallback(Mouse.eLClick, hidePanel)
Controls.LoadEarlierButton:RegisterCallback(Mouse.eLClick, onLoadEarlier); Controls.InputBox:RegisterCallback(onInputChanged); Controls.SendButton:RegisterCallback(Mouse.eLClick, onSend)
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onProposeDeal); Controls.WarButton:RegisterCallback(Mouse.eLClick, onDeclareWar)
Controls.WarYesButton:RegisterCallback(Mouse.eLClick, confirmDeclareWar); Controls.WarNoButton:RegisterCallback(Mouse.eLClick, cancelDeclareWar)
ContextPtr:SetInputHandler(inputHandler); ContextPtr:SetShowHideHandler(showHideHandler)
layoutPanel(); Events.SystemUpdateUI.Add(onSystemUpdateUI)

include("VoxDeorumDiploPanelMock")
