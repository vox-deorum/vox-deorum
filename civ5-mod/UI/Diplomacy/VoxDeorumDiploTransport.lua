-- Vox Deorum diplomacy panel transport driver.
--
-- Owns both directions of the panel's wire contract: it registers the four
-- DLL-callable push functions, broadcasts the three outbound panel events, and
-- translates every push into the VoxDeorumDiploUI surface.
-- Wire contract: docs/plans/interactive-diplomacy/07-ingame-panel/specs.md.

VoxDeorumDiploTransport = VoxDeorumDiploTransport or {}

-- Two-tier responsiveness backstop: nothing arrived at all, then nothing arrived
-- for a long time after the request was acknowledged.
local ACK_TIMEOUT_SECONDS = 10
local REPLY_TIMEOUT_SECONDS = 90
local MAX_TEXT_LENGTH = 2000
-- Agent activity states carry no content across the boundary, only a label.
local STATUS_LABEL_KEYS = {
	composing = "TXT_KEY_VD_DIPLO_BUSY",
	reasoning = "TXT_KEY_VD_DIPLO_THINKING",
	tool = "TXT_KEY_VD_DIPLO_ADVISORS",
}

local m_registered = false
-- False while the offline mock sandbox owns the panel: no registration, no
-- broadcast, and every push is ignored so a late live reply cannot leak in.
local m_active = true
local m_open = false
local m_playerID, m_counterpartID = -1, -1
-- "idle" = nothing outstanding, "opening"/"sending" = awaiting acknowledgement,
-- "running" = acknowledged and a turn is in flight for this pair.
local m_state = "idle"
local m_ackSeconds, m_silenceSeconds = 0, 0
local m_uiPhase = "loading"
local m_lastText = nil
local m_lowestRowID = nil

-- Fire one LuaEvent, recording a throwing listener in Lua.log before rethrowing,
-- so the DLL reports the push as failed and the server-side transport can react.
local function fireGuarded(eventName, dispatch)
	local ok, errorMessage = pcall(dispatch)
	if not ok then
		print("[VDDiploTransport] " .. eventName .. " listener error: " .. tostring(errorMessage))
		error(errorMessage, 0)
	end
	return true
end

-- Dispatch a Begin push into this panel context.
local function dispatchBegin(playerID, counterpartID, turn, meta)
	return fireGuarded("Begin", function()
		LuaEvents.VoxDeorumDiploBegin(playerID, counterpartID, turn, meta)
	end)
end

-- Dispatch a Messages push into this panel context.
local function dispatchMessages(playerID, counterpartID, batch)
	return fireGuarded("Messages", function()
		LuaEvents.VoxDeorumDiploMessages(playerID, counterpartID, batch)
	end)
end

-- Dispatch a Status push into this panel context.
local function dispatchStatus(playerID, counterpartID, status)
	return fireGuarded("Status", function()
		LuaEvents.VoxDeorumDiploStatus(playerID, counterpartID, status)
	end)
end

-- Dispatch a Delta push into this panel context.
local function dispatchDelta(playerID, counterpartID, text)
	return fireGuarded("Delta", function()
		LuaEvents.VoxDeorumDiploDelta(playerID, counterpartID, text)
	end)
end

-- Register one DLL-callable push function.
local function registerPushFunction(name, handler)
	local ok, errorMessage = pcall(Game.RegisterFunction, name, handler)
	if not ok then
		print("[VDDiploTransport] Registration failed for " .. name .. ": " .. tostring(errorMessage))
	end
	return ok
end

-- Register the push functions once after all DLL bindings succeed. Never called
-- at context load: that reaches CvConnectionService before Setup() and crashes
-- the game, so the panel drives this from its presentation instead.
function VoxDeorumDiploTransport.EnsureRegistered()
	if m_registered or not m_active then return end
	if Game == nil or type(Game.RegisterFunction) ~= "function" then
		print("[VDDiploTransport] Game.RegisterFunction is unavailable")
		return
	end

	local beginRegistered = registerPushFunction("VoxDeorumDiploBegin", dispatchBegin)
	local messagesRegistered = registerPushFunction("VoxDeorumDiploMessages", dispatchMessages)
	local statusRegistered = registerPushFunction("VoxDeorumDiploStatus", dispatchStatus)
	local deltaRegistered = registerPushFunction("VoxDeorumDiploDelta", dispatchDelta)
	local registered = beginRegistered and messagesRegistered and statusRegistered and deltaRegistered
	m_registered = registered
	print("[VDDiploTransport] Push registration complete=" .. tostring(registered))
end

-- Change the panel phase and remember it, so later pushes can tell a live
-- streaming draft from an idle transcript without querying the panel.
local function setPhase(phase, labelKey)
	m_uiPhase = phase
	VoxDeorumDiploUI.setPhase(phase, labelKey)
end

-- Build the common outbound payload for the effective seat, computed once per event.
local function basePayload()
	local seat = VoxDeorumSeat.EffectiveSeat()
	local payload = { PlayerID = seat, CounterpartID = m_counterpartID, Turn = Game.GetGameTurn() }
	-- AsObserver is the literal true or absent; the event schema rejects false.
	if VoxDeorumSeat.IsPureObserver() then payload.AsObserver = true end
	m_playerID = seat
	return payload
end

-- Broadcast one panel event. generateId is mandatory: an id-less event crashes
-- the mcp-server handler (the VoxDeorumHumanPanel HumanDecision precedent).
local function broadcast(name, payload)
	local ok, errorMessage = pcall(Game.BroadcastEvent, name, payload, true)
	if not ok then print("[VDDiploTransport] " .. name .. " broadcast failed: " .. tostring(errorMessage)) end
	return ok
end

-- Ask the server for a full read-only reflush of this pair. The last message is
-- forgotten here: once a reflush is the outstanding request, a later retry must
-- repeat that reflush and never resend an already committed message.
local function requestReflush()
	m_state, m_ackSeconds, m_silenceSeconds, m_lowestRowID, m_lastText = "opening", 0, 0, nil, nil
	VoxDeorumDiploUI.setInlineError(nil)
	setPhase("loading")
	if not broadcast("DiplomacyPanelOpened", basePayload()) then
		m_state = "idle"; setPhase("ack-timeout")
	end
end

-- Start a conversation: the panel has already cleared its log for this pair.
local function onOpen(counterpartID, activePlayerID)
	m_open, m_counterpartID, m_lastText = true, counterpartID, nil
	if not m_active then return end
	requestReflush()
end

-- Send one panel message optimistically and start the acknowledgement tier.
local function onSend(text)
	if not m_active or not m_open then return end
	local clean = VoxDeorumDealUtils.StripDelimiter(text)
	if string.len(clean) > MAX_TEXT_LENGTH then
		-- The panel's input box already caps this; clamp anyway so an oversized
		-- send fails the event schema at neither edge.
		print("[VDDiploTransport] Clamping an oversized panel message")
		clean = string.sub(clean, 1, MAX_TEXT_LENGTH)
	end
	if string.match(clean, "^%s*$") ~= nil then return end
	local payload = basePayload()
	payload.Text = clean
	m_lastText = clean
	m_state, m_ackSeconds, m_silenceSeconds = "sending", 0, 0
	-- A new request retires the previous failure reason.
	VoxDeorumDiploUI.setInlineError(nil)
	setPhase("sending", clean)
	if not broadcast("DiplomacyChatMessage", payload) then
		m_state = "idle"; setPhase("ack-timeout")
	end
end

-- Retry the tier that timed out. An acknowledgement failure means nothing was
-- delivered, so it repeats the original request; a reply-silence failure only
-- re-requests the read-only reflush, because a committed message must never be
-- sent twice to recover a lost stream.
local function onRetry()
	if not m_active or not m_open then return end
	if m_uiPhase == "ack-timeout" and m_lastText ~= nil then onSend(m_lastText); return end
	requestReflush()
end

-- Page older history from the oldest row the panel currently holds.
local function onLoadEarlier()
	if not m_active or not m_open then return end
	-- BeforeID is a required field, so an empty transcript has no older page to
	-- ask for; clear the panel's inline loading row instead of leaving it spinning.
	if m_lowestRowID == nil then VoxDeorumDiploUI.prependRows({}, false); return end
	local payload = basePayload()
	payload.BeforeID = m_lowestRowID
	if not broadcast("DiplomacyTranscriptRequest", payload) then VoxDeorumDiploUI.prependRows({}, false) end
end

-- Stop tracking a pair the player has left; its pushes no longer match.
local function onHide()
	m_open, m_state, m_lastText = false, "idle", nil
end

-- Drive both timeout tiers from the panel's per-frame update.
local function onUpdate(delta)
	if not m_active or not m_open then return end
	if m_state == "opening" or m_state == "sending" then
		m_ackSeconds = m_ackSeconds + delta
		if m_ackSeconds >= ACK_TIMEOUT_SECONDS then m_state = "idle"; setPhase("ack-timeout") end
	elseif m_state == "running" then
		m_silenceSeconds = m_silenceSeconds + delta
		if m_silenceSeconds >= REPLY_TIMEOUT_SECONDS then m_state = "idle"; setPhase("reply-timeout") end
	end
end

-- Leave the live conversation offline while the mock sandbox owns the panel.
local function setActive(isActive)
	m_active = isActive == true
	if m_active then return end
	m_open, m_state, m_lastText = false, "idle", nil
end

-- Return whether a push belongs to the pair the panel currently has open.
local function isOpenPair(playerID, counterpartID)
	return m_active and m_open and playerID == m_playerID and counterpartID == m_counterpartID
end

-- Any push for the open pair acknowledges the transport and resets reply silence.
local function noteInbound()
	m_ackSeconds, m_silenceSeconds = 0, 0
	if m_state == "sending" then m_state = "running" end
end

-- Track the oldest row held for the pair so paging has an exclusive cursor.
local function trackRowIDs(rows)
	for _, row in ipairs(rows) do
		if type(row.ID) == "number" and (m_lowestRowID == nil or row.ID < m_lowestRowID) then m_lowestRowID = row.ID end
	end
end

-- Retire the optimistic "sending" bubble once the player's own committed row
-- echoes back in a batch. Turn-end is decided solely by the terminal status
-- pushed behind the rows (see onStatus).
local function applyBatchPhase(rows)
	if m_uiPhase ~= "sending" then return end
	for _, row in ipairs(rows) do
		if row.SpeakerID == m_playerID then setPhase("thinking"); return end
	end
end

-- Start a reflush: clear the pair log and apply the three server-only facts.
local function onBegin(playerID, counterpartID, turn, meta)
	if not isOpenPair(playerID, counterpartID) then return end
	meta = type(meta) == "table" and meta or {}
	m_lowestRowID, m_ackSeconds, m_silenceSeconds = nil, 0, 0
	VoxDeorumDiploUI.reset(meta)
	VoxDeorumDiploUI.setCurrentTurn(turn)
	VoxDeorumDiploUI.setHasMore(meta.hasMore)
	if meta.hasEnvoy == false then
		m_state, m_uiPhase = "idle", "no-envoy"
	elseif meta.busy == true then
		-- A reopen during a live turn must say so immediately: no draft is replayed.
		m_state = "running"; setPhase("thinking", "TXT_KEY_VD_DIPLO_BUSY")
	else
		m_state, m_uiPhase = "idle", "normal"
	end
end

-- Apply one transcript batch; the panel deduplicates rows by ID.
local function onMessages(playerID, counterpartID, batch)
	if not isOpenPair(playerID, counterpartID) then return end
	batch = type(batch) == "table" and batch or {}
	local rows = type(batch.messages) == "table" and batch.messages or {}
	noteInbound()
	if batch.mode == "prepend" then
		VoxDeorumDiploUI.prependRows(rows, batch.hasMore)
		trackRowIDs(rows)
		return
	end
	if batch.hasMore ~= nil then VoxDeorumDiploUI.setHasMore(batch.hasMore) end
	for _, row in ipairs(rows) do VoxDeorumDiploUI.appendRow(row) end
	trackRowIDs(rows)
	applyBatchPhase(rows)
end

-- Map live agent activity onto the panel's phase and inline status surfaces.
local function onStatus(playerID, counterpartID, status)
	if not isOpenPair(playerID, counterpartID) then return end
	status = type(status) == "table" and status or {}
	noteInbound()
	if status.state == "idle" or status.state == "error" then
		-- The turn's terminal status: the single authority that a turn has ended.
		m_state = "idle"
		if status.state == "error" then VoxDeorumDiploUI.setInlineError(status.detail) end
		setPhase("normal")
		return
	end
	local labelKey = STATUS_LABEL_KEYS[status.state]
	if labelKey == nil then return end
	m_state = "running"
	-- A status arriving between deltas must not drop the streamed draft.
	if m_uiPhase == "streaming" then return end
	setPhase("thinking", labelKey)
end

-- Render the accumulated reply so far; re-rendering the same text is idempotent.
local function onDelta(playerID, counterpartID, text)
	if not isOpenPair(playerID, counterpartID) then return end
	noteInbound()
	-- A delta that arrives after the durable final row is stale: the transcript
	-- already shows the committed reply.
	if m_state ~= "running" then return end
	if m_uiPhase ~= "streaming" then setPhase("streaming") end
	VoxDeorumDiploUI.setStreamingText(text)
end

-- A deal action dispatched from the deal screen runs a turn on this pair's
-- thread just like a panel send; arm the same acknowledgement tiers for it.
local function onDealDispatched(payload)
	if type(payload) ~= "table" or not isOpenPair(payload.playerID, payload.counterpartID) then return end
	-- m_lastText must not survive into this action: an ack-timeout Retry here must
	-- reflush, never resend a chat message that was already committed.
	m_state, m_ackSeconds, m_silenceSeconds, m_lastText = "sending", 0, 0, nil
	VoxDeorumDiploUI.setInlineError(nil)
	setPhase("thinking")
end

VoxDeorumDiploTransport.Driver = {
	onOpen = onOpen, onSend = onSend, onRetry = onRetry, onLoadEarlier = onLoadEarlier,
	onUpdate = onUpdate, onHide = onHide, setActive = setActive,
}

VoxDeorumDiploUI.registerDriver("real", VoxDeorumDiploTransport.Driver)
LuaEvents.VoxDeorumDiploBegin.Add(onBegin)
LuaEvents.VoxDeorumDiploMessages.Add(onMessages)
LuaEvents.VoxDeorumDiploStatus.Add(onStatus)
LuaEvents.VoxDeorumDiploDelta.Add(onDelta)
LuaEvents.VoxDeorumDealActionDispatched.Add(onDealDispatched)
