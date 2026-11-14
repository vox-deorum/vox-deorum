-- Vox Deorum diplomacy conversation panel.
-- Bubble design adapted with credit to @schnetziomi5's diplomacy-message-log modmod.
-- Deal reduction mirrors vox-agents/src/utils/diplomacy/deal/deal-reduce.ts.

include("IconSupport")
include("VoxDeorumSeat")
include("VoxDeorumDealUtils")

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
local m_isPureObserver = false
local PENDING_POKE_TIMEOUT = 3.0
local m_presentation = nil -- nil | "pending" | "leader" | "static"
local m_sceneLeaderID = -1
local m_pendingCounterpartID, m_pendingSeconds = -1, 0
local m_dealScreenPriorPresentation = nil
local m_inlineError = nil
-- Two installed drivers, one active: the real transport ships by default and the
-- offline mock sandbox replaces it while VoxDeorumUseMockDrivers is true.
local m_drivers, m_driverKind, m_driverMissReported = {}, "real", {}

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
	Controls.MainGrid:SetSizeVal(screenW, targetH); Controls.ContentColumn:SetSizeVal(columnW, targetH); Controls.ContentColumn:SetOffsetVal(columnX, 0)
	Controls.TranscriptScroll:SetSizeVal(transcriptW, transcriptH); Controls.TranscriptBar:SetSizeY(math.max(200, transcriptH - 42))
	Controls.TranscriptStack:SetSizeX(rowW); Controls.TailStack:SetSizeX(rowW); Controls.FooterDivider:SetSizeX(transcriptW)
	Controls.HeaderBar:SetSizeX(transcriptW); Controls.HeaderRule:SetSizeX(transcriptW)
	Controls.HeaderLeftTitle:SetTruncateWidth(headerTitleW); Controls.HeaderRightTitle:SetTruncateWidth(headerTitleW)
	Controls.HeaderBar:ReprocessAnchoring()
	Controls.InputFrame:SetSizeX(inputW); Controls.InputFrameBorder:SetSizeVal(inputW + 4, 42); Controls.InputBox:SetSizeX(inputW - 20)
	Controls.InputStatusSlot:SetSizeVal(inputStatusW, 38); Controls.InputReason:SetWrapWidth(math.max(320, inputStatusW - 160))
	Controls.MainGrid:ReprocessAnchoring(); Controls.ContentColumn:ReprocessAnchoring(); Controls.TranscriptScroll:CalculateInternalSize()
end

-- Strip the named-pipe delimiter from text and fold punctuation the Civ 5 font cannot
-- draw. Folding first means a fullwidth "！＠＃＄％＾！" cannot fold into a live
-- delimiter behind the strip. Every panel surface routes through here -- bubbles, deal
-- summaries, the streaming and optimistic tails, inline errors, and the input box --
-- so both directions normalize identically and the input box shows the player the
-- exact punctuation their message will carry.
local function sanitizeText(value)
	-- Bound to one value: StripDelimiter tail-returns gsub's replacement count too.
	local clean = VoxDeorumDealUtils.StripDelimiter(VoxDeorumDealUtils.FoldUnrenderablePunctuation(value))
	return clean
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

-- Port the Web per-proposal outcome reducer (deriveProposalOutcomes). Every proposal keeps its own
-- resolved fate plus the rows that answered it, so a card that was accepted still says so once a
-- later proposal supersedes it -- reading status off the active reduction alone silently demoted it
-- to "Expired" and left the acceptance visible only in the standalone outcome rows.
local function deriveProposalOutcomes(rows)
	local outcomes, latestID = {}, nil
	for _, row in ipairs(rows) do
		if row.MessageType == "deal-proposal" or row.MessageType == "deal-counter" then
			outcomes[row.ID] = { status = "open", responses = {}, superseded = false }
			latestID = row.ID
		end
	end
	for id, outcome in pairs(outcomes) do outcome.superseded = id ~= latestID end
	for _, row in ipairs(rows) do
		local outcome = outcomes[answeredProposalID(row) or -1]
		if outcome ~= nil then
			if row.MessageType == "deal-enacted" then
				table.insert(outcome.responses, row); outcome.status = "enacted"
			elseif row.MessageType == "deal-accept" then
				table.insert(outcome.responses, row)
				if outcome.status ~= "enacted" then outcome.status = "accepted" end
			elseif row.MessageType == "deal-reject" then
				table.insert(outcome.responses, row)
				if outcome.status == "open" then outcome.status = "rejected" end
			end
		end
	end
	return outcomes
end

-- Return whether a row is a deal outcome, which belongs inside the proposal card it answers rather
-- than in a bubble of its own.
local function isDealOutcomeRow(row)
	local t = row and row.MessageType
	return t == "deal-accept" or t == "deal-enacted" or t == "deal-reject"
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

local ITEM_ICONS = {
	GOLD = "[ICON_GOLD]", GOLD_PER_TURN = "[ICON_GOLD]", CITIES = "[ICON_CAPITAL]",
	TECHS = "[ICON_RESEARCH]", MAPS = "[ICON_TRADE]", OPEN_BORDERS = "[ICON_MOVES]",
	DEFENSIVE_PACT = "[ICON_STRENGTH]", RESEARCH_AGREEMENT = "[ICON_RESEARCH]",
	PEACE_TREATY = "[ICON_PEACE]", THIRD_PARTY_PEACE = "[ICON_PEACE]",
	THIRD_PARTY_WAR = "[ICON_WAR]", ALLOW_EMBASSY = "[ICON_DIPLOMAT]",
	DECLARATION_OF_FRIENDSHIP = "[ICON_TEAM]", VOTE_COMMITMENT = "[ICON_INFLUENCE]",
	VASSALAGE = "[ICON_SILVER_FIST]", VASSALAGE_REVOKE = "[ICON_SILVER_FIST]",
}

-- Format an optional deal duration consistently.
local function durationSuffix(duration)
	return duration and (" (" .. tostring(duration) .. " turns)") or ""
end

-- Format one canonical trade item.
local function itemLabel(item)
	local kind, duration = item.itemType, durationSuffix(item.duration)
	local icon = ITEM_ICONS[kind]
	local prefix = icon and (icon .. " ") or ""
	if kind == "GOLD" then return prefix .. tostring(item.amount or 0) .. " Gold" end
	if kind == "GOLD_PER_TURN" then return prefix .. tostring(item.amount or 0) .. " Gold per Turn" .. duration end
	if kind == "RESOURCES" then
		local resource = item.resourceID ~= nil and GameInfo.Resources[item.resourceID] or nil
		local resourceIcon = resource and resource.IconString or nil
		local resourcePrefix = resourceIcon ~= nil and resourceIcon ~= "" and (resourceIcon .. " ") or ""
		return resourcePrefix .. tostring(item.quantity or 0) .. " " .. (item.name or ("Resource #" .. tostring(item.resourceID))) .. duration
	end
	if kind == "THIRD_PARTY_PEACE" then return prefix .. "Peace with " .. (item.name or prettyType(kind)) .. duration end
	if kind == "THIRD_PARTY_WAR" then return prefix .. "War with " .. (item.name or prettyType(kind)) .. duration end
	if kind == "ALLOW_EMBASSY" then return prefix .. "Embassy" .. duration end
	if kind == "DECLARATION_OF_FRIENDSHIP" then return prefix .. "Declaration of Friendship" .. duration end
	if kind == "VOTE_COMMITMENT" then
		local votes = item.numVotes ~= nil and (" (" .. tostring(item.numVotes) .. " votes)") or ""
		return prefix .. (item.name or prettyType(kind)) .. votes .. duration
	end
	if kind == "VASSALAGE_REVOKE" then return prefix .. "Revoke Vassalage" .. duration end
	return prefix .. (item.name or prettyType(kind)) .. duration
end

-- Format one canonical promise term.
local function promiseLabel(promise)
	local names = { MILITARY = "Won't attack / will move troops away", EXPANSION = "Won't settle near you", BORDER = "Won't buy plots near your cities", NO_DIGGING = "Won't dig your antiquity sites", COOP_WAR = "Will join a cooperative war" }
	local duration = durationSuffix(promise.duration)
	return "[ICON_DIPLOMAT] Promise: " .. (names[promise.promiseType] or prettyType(promise.promiseType)) .. duration
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

-- Open one deal card with the explicit mode derived by the transcript reducer.
local function openDeal(row, mode)
	if mode ~= "incoming" and mode ~= "own" then return end
	local deal = row.Payload and row.Payload.Deal or nil
	if deal == nil then return end
	m_inlineError = nil
	local proposalID = (mode == "incoming" or mode == "own") and row.ID or nil
	LuaEvents.VoxDeorumOpenDealScreen({
		counterpartID = m_counterpartID,
		mode = mode,
		deal = deal,
		proposalMessageID = proposalID,
	})
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
	instance.TheyHeader:SetOffsetY(dealTop + 2); instance.YouHeader:SetOffsetY(dealTop + 2)
	instance.TheyGive:SetOffsetY(dealTop + 24); instance.YouGive:SetOffsetY(dealTop + 24); instance.DealDivider:SetOffsetY(dealTop - 2)
	local termsHeight = math.max(instance.TheyGive:GetSizeY(), instance.YouGive:GetSizeY())
	instance.DealDivider:SetSizeY(termsHeight + 28)
	-- The outcome line sits under the terms, above the pending strip.
	local termsBottom = dealTop + 24 + termsHeight
	local outcomeHeight = 0
	if not instance.Outcome:IsHidden() then
		instance.Outcome:SetOffsetY(termsBottom + 6)
		outcomeHeight = instance.Outcome:GetSizeY() + 8
	end
	sizeBubble(instance, termsBottom + outcomeHeight + (pending and 30 or 14))
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
	instance.DealDivider:SetHide(not isDeal); instance.Pending:SetHide(true); instance.Outcome:SetHide(true)
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
	instance.CardButton:SetDisabled(true); instance.CardButton:SetAlpha(row.Pending and 0.55 or 1)
	return isDeal
end

-- Build one durable row and at most one turn separator. Outcome rows are skipped the same way
-- hidden trigger tokens are: refreshDealRow folds their text into the proposal card instead.
local function buildRowInstance(row)
	if isSpecialRow(row.Content) or isDealOutcomeRow(row) then return end
	if m_lastBuiltTurn ~= row.Turn then
		local turn = {}; ContextPtr:BuildInstanceForControl("TurnInstance", turn, Controls.TranscriptStack); turn.Row:SetSizeX(m_geometry.rowWidth); turn.Text:SetText(turnLabel(row.Turn))
	end
	m_lastBuiltTurn = row.Turn
	local instance = {}; ContextPtr:BuildInstanceForControl("MessageInstance", instance, Controls.TranscriptStack)
	local record = { row = row, controls = instance, mode = nil }; bindStaticRow(row, instance)
	m_rowInstances[row.ID] = record
end

-- Return whether text and deal input are currently locked.
local function inputIsLocked()
	return isClosedThisTurn(m_rows, m_currentTurn) or m_phase ~= "normal"
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

-- Collect the answering side's own words for one proposal. A deal-enacted row carries fixed
-- boilerplate the status label already states, so only accept/reject lines are surfaced.
local function outcomeText(outcome)
	local lines = {}
	for _, response in ipairs(outcome.responses) do
		if response.MessageType ~= "deal-enacted" then
			local text = sanitizeText(response.Content)
			if string.match(text, "^%s*$") == nil then table.insert(lines, text) end
		end
	end
	if #lines == 0 then return nil end
	return table.concat(lines, "[NEWLINE]")
end

-- Refresh one proposal card in place, including the outcome that resolved it.
local function refreshDealRow(row, reduction, outcomes)
	local record = m_rowInstances[row.ID]
	if record == nil then return end
	local instance = record.controls
	local outcome = outcomes[row.ID] or { status = "open", responses = {}, superseded = false }
	-- A resolved proposal keeps its own outcome; only one that was never answered reads as expired.
	local status = outcome.status
	if status == "open" and outcome.superseded then status = "superseded" end
	local pending = pendingProposalID(reduction) == row.ID
	local textControl = row.SpeakerID == m_activePlayerID and instance.RightText or instance.LeftText
	textControl:SetText(dealSummary(row, status))
	local outcomeLine = outcomeText(outcome)
	instance.Outcome:SetHide(outcomeLine == nil)
	if outcomeLine ~= nil then
		instance.Outcome:SetWrapWidth(m_geometry.textWrapWidth); instance.Outcome:SetText(outcomeLine)
	end
	resizeDealBubble(instance, pending)
	instance.Pending:SetHide(not pending)
	if pending then addAnimated(instance.Pending, Locale.ConvertTextKey(pendingLabelKey()) .. " ") end
	local canRespond = not outcome.superseded and outcome.status == "open" and not pending and isBoundActorCurrent() and not inputIsLocked()
	record.mode = canRespond and (row.SpeakerID == m_activePlayerID and "own" or "incoming") or nil
	instance.CardButton:SetDisabled(pending or not canRespond); instance.CardButton:SetAlpha((pending or row.Pending) and 0.55 or 1)
	if canRespond then instance.CardButton:RegisterCallback(Mouse.eLClick, function() openDeal(record.row, record.mode) end) end
end

-- Refresh every proposal after a row or phase change.
local function refreshDealRows(reduction)
	local outcomes = deriveProposalOutcomes(m_rows)
	for _, row in ipairs(reduction.proposals) do refreshDealRow(row, reduction, outcomes) end
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
	elseif m_phase == "streaming" and m_streamingText ~= "" then
		bindTailMessage(m_tail.streaming, m_counterpartID, m_streamingText); m_tail.streaming.Row:SetHide(false)
	end
	if m_inlineError ~= nil then
		m_tail.status.Row:SetSizeX(m_geometry.rowWidth); m_tail.status.Text:SetWrapWidth(m_geometry.rowWidth - 60)
		m_tail.status.Row:SetHide(false); m_tail.status.Text:SetText(m_inlineError)
	elseif m_loadingEarlier then
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
	elseif m_phase ~= "normal" then
		-- Only the thinking phase carries a label key; every other phase argument
		-- is data (the optimistic send text, a pending proposal ID).
		local labelKey = m_phase == "thinking" and type(m_phaseArg) == "string" and m_phaseArg or "TXT_KEY_VD_DIPLO_THINKING"
		reason, animated = Locale.ConvertTextKey(labelKey), true
	end
	Controls.InputFrame:SetHide(reason ~= nil); Controls.SendButton:SetHide(reason ~= nil); Controls.InputStatusSlot:SetHide(reason == nil); Controls.InputReason:SetHide(reason == nil)
	if animated then addAnimated(Controls.InputReason, reason .. " ") else Controls.InputReason:SetText(reason or "") end
	local canRetry = (m_phase == "ack-timeout" or m_phase == "reply-timeout") and not m_loadingEarlier
	Controls.InputRetryButton:SetHide(not canRetry)
	local canInteractWithDeals = isBoundActorCurrent()
	Controls.ProposeButton:SetHide(not canInteractWithDeals)
	Controls.ProposeButton:SetDisabled(reason ~= nil or not canInteractWithDeals)
	reflowActionStack()
end

-- Return whether the war action is offered at all. Declaring routes through the native
-- BUTTONPOPUP_DECLAREWARMOVE popup, whose Yes handler acts for Game.GetActivePlayer() -- so the
-- pinned-observer strategist seat, which would declare for the wrong player, is not offered it.
local function warActionAvailable()
	if VoxDeorumSeat.IsPureObserver() or isHumanStrategist() or not isBoundActorCurrent() then return false end
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	if active == nil or other == nil then return false end
	return not Teams[active:GetTeam()]:IsAtWar(other:GetTeam())
end

-- Update the war action on the native model: visible whenever the action applies, disabled with the
-- blocking reason when it is illegal. Mirrors LeaderHeadRoot's peace-branch gating. Note a
-- Declaration of Friendship never blocks war in VP -- the native popup surfaces it as a backstab
-- warning instead, which is one reason we defer to that popup rather than confirming inline.
local function refreshWarButton()
	local available = warActionAvailable()
	Controls.WarButton:SetHide(not available)
	if available then
		local activeTeam, otherTeamID = Teams[Players[m_activePlayerID]:GetTeam()], Players[m_counterpartID]:GetTeam()
		-- Always pass the originating player: the two-argument Lua wrapper reads both stack slots, so
		-- omitting it would send player 0 rather than NO_PLAYER.
		local canDeclare = activeTeam:CanDeclareWar(otherTeamID, m_activePlayerID)
		Controls.WarButton:SetDisabled(not canDeclare)
		local tooltip = "TXT_KEY_DIPLO_DECLARES_WAR_TT"
		if not canDeclare then
			if activeTeam:IsVassalOfSomeone() then
				-- IsVassal takes a team, not a player; native LeaderHeadRoot passes a player ID here and
				-- only gets away with it while the two IDs happen to coincide.
				tooltip = activeTeam:IsVassal(otherTeamID) and "TXT_KEY_DIPLO_DECLARE_WAR_VASSAL_BLOCKED_MASTER_TT" or "TXT_KEY_DIPLO_DECLARE_WAR_VASSAL_BLOCKED_TT"
			elseif activeTeam:IsForcePeace(otherTeamID) then tooltip = "TXT_KEY_DIPLO_MAY_NOT_ATTACK"
			elseif activeTeam:IsWarBlockedByPeaceTreaty(otherTeamID) then tooltip = "TXT_KEY_DIPLO_MAY_NOT_ATTACK_DP"
			else tooltip = "TXT_KEY_DIPLO_MAY_NOT_ATTACK_MOD" end
		end
		Controls.WarButton:SetToolTipString(Locale.ConvertTextKey(tooltip))
	end
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
	m_inlineError = nil
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
	-- The durable row supersedes the streamed draft; the phase itself ends only on
	-- the turn's terminal status.
	if m_phase == "streaming" then m_streamingText = "" end
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
	if m_phase == "streaming" and m_streamingText ~= "" then
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

-- Show one transient failure reason in the transcript tail; nil clears it.
local function setInlineError(text)
	local clean = text ~= nil and sanitizeText(text) or ""
	m_inlineError = string.match(clean, "^%s*$") == nil and colorText(clean, "COLOR_NEGATIVE_TEXT") or nil
	refreshState(isAtBottom())
end

-- Mock-only seam: present the offline sandbox as a pure observer would see it.
local function setMockPureObserver(flag)
	m_isPureObserver = flag == true
	populateHeader(); rebuildRows(isAtBottom())
end

-- Drain the bridge's incoming Lua queue on the game core's behalf.
--
-- The engine stops ticking CvGame::update while the leaderhead scene is up, and every
-- game-core pump point for CvConnectionService hangs off that tick. So for as long as the
-- player sits in this conversation nothing routes the server's pushes: the Lua call never
-- returns, neither end raises an error, and the panel just reaches its transport
-- acknowledgement timeout. The UI thread keeps running here, so this context pumps for it.
-- Absent on a DLL older than the binding, in which case we degrade to that same stall.
local function pumpConnection()
	if type(Game.ProcessConnectionMessages) ~= "function" then return end
	local ok, errorMessage = pcall(Game.ProcessConnectionMessages)
	if not ok then print("[VDDiploPanel] Connection pump failed: " .. tostring(errorMessage)) end
end

-- Tick animated labels and the active driver.
local function onUpdate(delta)
	-- Pump before the driver ticks, so a push landing this frame is applied before the
	-- timeout that would otherwise have blamed it for silence.
	pumpConnection()
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
	-- The bridge always posts after a successful outcome, so one for the pair the
	-- player is already reading would only pile up behind the open panel. The mock
	-- posts its own smoke notification on open, which is a seam, not an outcome.
	if m_driverKind == "real" and m_presentation ~= nil and gameValue == m_counterpartID then UI.RemoveNotification(id) end
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
	-- Register DLL push functions whenever a valid panel presentation begins.
	if VoxDeorumDiploTransport ~= nil and type(VoxDeorumDiploTransport.EnsureRegistered) == "function" then
		VoxDeorumDiploTransport.EnsureRegistered()
	end
	cancelPending()
	local wasQueued = m_presentation == "leader"
	m_activePlayerID, m_counterpartID, m_currentTurn = VoxDeorumSeat.EffectiveSeat(), counterpartID, Game.GetGameTurn()
	m_isPureObserver = VoxDeorumSeat.IsPureObserver()
	populateHeader()
	m_presentation = mode
	Controls.MainGrid:SetHide(false)
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
	m_presentation, m_inlineError = nil, nil
	local driver = VoxDeorumDiploUI.driver
	if driver ~= nil and driver.onHide ~= nil then driver.onHide() end
	ContextPtr:ClearUpdate()
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

-- Demote the conversation beneath the deal screen while retaining its live state.
local function demotePanelForDeal()
	if m_dealScreenPriorPresentation ~= nil or m_presentation == nil or m_presentation == "pending" then return end
	m_dealScreenPriorPresentation = m_presentation
	if m_presentation == "leader" then demoteToStatic() end
end

-- Restore the conversation and optionally show a deal-open failure inline.
local function restorePanelAfterDeal(errorText, errorIsLiteral)
	local prior = m_dealScreenPriorPresentation
	m_dealScreenPriorPresentation = nil
	if errorText ~= nil then
		local message = errorIsLiteral and tostring(errorText) or Locale.ConvertTextKey(errorText)
		m_inlineError = colorText(sanitizeText(message), "COLOR_NEGATIVE_TEXT")
	end
	if prior ~= nil and m_presentation ~= nil then
		if prior == "leader" and m_sceneLeaderID == m_counterpartID then
			m_presentation = "leader"
			UIManager:QueuePopup(ContextPtr, PopupPriority.LeaderTrade)
			ContextPtr:SetHide(false)
		else
			m_presentation = "static"
			ContextPtr:SetHide(false)
		end
	end
	if errorText ~= nil and m_presentation ~= nil then refreshState(true) end
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

-- The native declare-war popup reports no result, so this is how a declaration reaches us.
-- Over the live scene the audience is over once war is declared: close and leave it. Otherwise
-- just re-gate the button, which the new war state now hides.
local function onWarStateChanged(teamID, otherTeamID, atWar)
	if m_presentation == nil or m_counterpartID < 0 or m_activePlayerID < 0 then return end
	local active, other = Players[m_activePlayerID], Players[m_counterpartID]
	if active == nil or other == nil then return end
	local activeTeamID, counterpartTeamID = active:GetTeam(), other:GetTeam()
	-- Only react to the pair this panel is about.
	if not ((teamID == activeTeamID and otherTeamID == counterpartTeamID) or (teamID == counterpartTeamID and otherTeamID == activeTeamID)) then return end
	if atWar and m_presentation == "leader" then
		hidePanel()
		pcall(function() UI.SetLeaderHeadRootUp(false); UI.RequestLeaveLeader() end)
	else
		refreshWarButton()
	end
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
	if isBoundActorCurrent() and not inputIsLocked() then
		m_inlineError = nil
		LuaEvents.VoxDeorumOpenDealScreen({ counterpartID = m_counterpartID, mode = "author" })
	end
end

-- Hand the declaration to the native popup, the way every other VP surface does. It carries the
-- consequence dossier our inline confirmation could not (friendship and denouncement counters,
-- defensive pacts, deals and trade routes that will be severed) and its Yes handler raises
-- FROM_UI_DIPLO_EVENT_HUMAN_DECLARES_WAR, so the leaderhead mood no longer goes stale on us.
-- There is no callback, so the outcome arrives through onWarStateChanged below.
local function onDeclareWar()
	if not warActionAvailable() then return end
	if not Teams[Players[m_activePlayerID]:GetTeam()]:CanDeclareWar(Players[m_counterpartID]:GetTeam(), m_activePlayerID) then return end
	UI.AddPopup{ Type = ButtonPopupTypes.BUTTONPOPUP_DECLAREWARMOVE, Data1 = Players[m_counterpartID]:GetTeam(), Option1 = true }
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
		hidePanel()
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

-- Install one named driver table, activating it when it matches the current mode.
-- Include order no longer decides which driver wins: this context does.
local function registerDriver(kind, driver)
	if (kind ~= "real" and kind ~= "mock") or type(driver) ~= "table" then return end
	m_drivers[kind] = driver
	if kind ~= m_driverKind then return end
	VoxDeorumDiploUI.driver = driver
	if type(driver.setActive) == "function" then driver.setActive(true) end
end

-- Swap the active driver. Every switch, in either direction, closes the panel and
-- clears its transcript, so mock rows can never be mistaken for durable ones and a
-- live pending action can never be resolved by the sandbox.
local function setMockDrivers(useMock)
	local wanted = useMock == true and "mock" or "real"
	if wanted == m_driverKind then return end
	local driver = m_drivers[wanted]
	if driver == nil then
		if not m_driverMissReported[wanted] then
			m_driverMissReported[wanted] = true
			print("Vox Deorum: no " .. wanted .. " conversation driver is registered; keeping " .. m_driverKind)
		end
		return
	end
	local previous = m_drivers[m_driverKind]
	hidePanel()
	if previous ~= nil and type(previous.setActive) == "function" then previous.setActive(false) end
	m_driverKind, VoxDeorumDiploUI.driver = wanted, driver
	if type(driver.setActive) == "function" then driver.setActive(true) end
	reset(nil)
end

-- Expose the stable interface shared by mock and transport drivers.
VoxDeorumDiploUI = { reset = reset, setRows = setRows, appendRow = appendRow, prependRows = prependRows, setPhase = setPhase, setStreamingText = setStreamingText, setHasMore = setHasMore, setCurrentTurn = setCurrentTurn, setInlineError = setInlineError, setMockPureObserver = setMockPureObserver, registerDriver = registerDriver, driver = {} }

buildTailPool()
Events.NotificationAdded.Add(onNotificationAdded); Events.NotificationRemoved.Add(onNotificationRemoved)
Events.AILeaderMessage.Add(onPanelAILeaderMessage); Events.LeavingLeaderViewMode.Add(onPanelLeavingLeaderView)
Events.WarStateChanged.Add(onWarStateChanged)
LuaEvents.VoxDeorumDiploOpen.Add(onConverseOpen); LuaEvents.VoxDeorumDiplomacyNotificationActivated.Add(onNotificationActivated)
-- One shared toggle moves this context and the deal screen together.
LuaEvents.VoxDeorumUseMockDrivers.Add(setMockDrivers)
LuaEvents.VoxDeorumDiploPanelDemoteForDeal.Add(demotePanelForDeal); LuaEvents.VoxDeorumDiploPanelRestoreAfterDeal.Add(restorePanelAfterDeal)
Controls.GoodbyeButton:RegisterCallback(Mouse.eLClick, hidePanel)
Controls.LoadEarlierButton:RegisterCallback(Mouse.eLClick, onLoadEarlier); Controls.InputBox:RegisterCallback(onInputChanged); Controls.SendButton:RegisterCallback(Mouse.eLClick, onSend)
-- Retry a timed-out request through whichever conversation driver is active.
Controls.InputRetryButton:RegisterCallback(Mouse.eLClick, function()
	if VoxDeorumDiploUI.driver ~= nil and VoxDeorumDiploUI.driver.onRetry ~= nil then VoxDeorumDiploUI.driver.onRetry() end
end)
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onProposeDeal); Controls.WarButton:RegisterCallback(Mouse.eLClick, onDeclareWar)
ContextPtr:SetInputHandler(inputHandler); ContextPtr:SetShowHideHandler(showHideHandler)
layoutPanel(); Events.SystemUpdateUI.Add(onSystemUpdateUI)

include("VoxDeorumDiploTransport")
include("VoxDeorumDiploPanelMock")
