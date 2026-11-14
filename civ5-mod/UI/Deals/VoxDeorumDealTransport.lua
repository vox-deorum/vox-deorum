-- Vox Deorum deal-screen transport driver.
--
-- Broadcasts DiplomacyDealAction and resolves the mounted editor from the durable
-- transcript rows the panel-owned transport re-fires. This is a separate Lua
-- context, so it cannot read the panel's globals; LuaEvents do cross contexts, and
-- the panel's registration serves both. It registers no DLL-callable function.
-- Wire shape: mcp-server/src/knowledge/schema/events/DiplomacyDealAction.ts.

-- Retract is a local driver intent only: the wire vocabulary has no retract, and
-- the store lets either endpoint speak deal-reject.
local WIRE_ACTIONS = { propose = "propose", counter = "counter", accept = "accept", reject = "reject", retract = "reject" }

-- False while the offline mock sandbox owns the deal screen: no broadcast, and
-- every durable row is ignored so a live outcome cannot resolve a scripted editor.
local m_active = true
local m_counterpartID = -1
local m_pending = nil
local m_maxRowID = 0

-- Resolve one user-facing text key.
local function text(key) return Locale.ConvertTextKey(key) end

-- Rewrite one human-side endpoint onto the effective seat. Third-party fields
-- (a Coop War target) are never rewritten.
local function seatEndpoint(playerID, seat, counterpartID)
	if playerID == counterpartID then return counterpartID end
	return seat
end

-- Serialize the edited deal with every human-side endpoint on the effective seat.
local function seatDeal(deal, seat, counterpartID)
	local out = VoxDeorumDealUtils.DeepCopy(deal)
	for _, item in ipairs(out.items or {}) do
		item.fromPlayerID = seatEndpoint(item.fromPlayerID, seat, counterpartID)
		item.toPlayerID = seatEndpoint(item.toPlayerID, seat, counterpartID)
	end
	for _, promise in ipairs(out.promises or {}) do
		promise.promiserID = seatEndpoint(promise.promiserID, seat, counterpartID)
		promise.recipientID = seatEndpoint(promise.recipientID, seat, counterpartID)
	end
	return out
end

-- Complete the single pending action through the screen's own resolver.
local function resolvePending(success, reason)
	m_pending = nil
	LuaEvents.VoxDeorumDealActionResolved({ success = success, reason = reason })
end

-- Emit one canonical deal action and record what must acknowledge it. A raised
-- error is the screen's own failure path: it restores the mounted editor.
local function onAction(packet)
	if not m_active then error(text("TXT_KEY_VD_DEAL_ERROR_NO_DRIVER"), 0) end
	local action = type(packet) == "table" and WIRE_ACTIONS[packet.kind] or nil
	if action == nil or m_counterpartID < 0 then error(text("TXT_KEY_VD_DEAL_ERROR_ACTION_FAILED"), 0) end
	local seat = VoxDeorumSeat.EffectiveSeat()
	local payload = { PlayerID = seat, CounterpartID = m_counterpartID, Turn = Game.GetGameTurn(), Action = action }
	-- AsObserver is the literal true or absent; the event schema rejects false.
	if VoxDeorumSeat.IsPureObserver() then payload.AsObserver = true end
	local proposalID = nil
	if packet.kind == "propose" or packet.kind == "counter" then
		if type(packet.deal) ~= "table" then error(text("TXT_KEY_VD_DEAL_ERROR_ACTION_FAILED"), 0) end
		payload.Deal = seatDeal(packet.deal, seat, m_counterpartID)
		local message = payload.Deal.message
		if type(message) == "string" and message ~= "" then payload.Text = message end
		-- Counter carries the mounted proposal as the backend's stale-submission guard.
		if packet.kind == "counter" then proposalID = packet.expectedProposalID end
	else
		proposalID = packet.proposalMessageID
	end
	-- Every action but propose must name the proposal it answers, or the event is
	-- refused at the archive boundary and nothing would ever acknowledge it.
	if packet.kind ~= "propose" and type(proposalID) ~= "number" then error(text("TXT_KEY_VD_DEAL_ERROR_ACTION_FAILED"), 0) end
	if proposalID ~= nil then payload.ProposalMessageID = proposalID end
	m_pending = { seat = seat, counterpartID = m_counterpartID, kind = packet.kind, proposalID = proposalID, floorID = m_maxRowID }
	-- generateId is mandatory: an id-less event crashes the mcp-server handler.
	local ok, errorMessage = pcall(Game.BroadcastEvent, "DiplomacyDealAction", payload, true)
	if not ok then m_pending = nil; error(tostring(errorMessage), 0) end
	-- A deal action runs a turn on the pair's thread just like a panel send; the
	-- panel transport arms its acknowledgement tiers off this announcement.
	LuaEvents.VoxDeorumDealActionDispatched({ playerID = seat, counterpartID = m_counterpartID })
end

-- Adopt the mounted pair and drop any earlier pending action.
local function onOpen(request)
	m_pending = nil
	m_counterpartID = type(request) == "table" and type(request.counterpartID) == "number" and request.counterpartID or -1
end

-- Leave the live transport offline while the mock sandbox owns the deal screen.
local function setActive(isActive)
	m_active = isActive == true
	if not m_active then m_pending, m_counterpartID = nil, -1 end
end

-- Return whether one durable row acknowledges the pending action.
local function rowResolvesPending(row)
	if m_pending == nil or type(row) ~= "table" or type(row.ID) ~= "number" then return false end
	local answered = type(row.Payload) == "table" and row.Payload.ProposalMessageID or nil
	local kind = m_pending.kind
	if kind == "propose" or kind == "counter" then
		-- The committed caller row: proposal and counter rows carry no answered ID,
		-- so the author plus a row newer than the whole transcript identifies it.
		local expected = kind == "propose" and "deal-proposal" or "deal-counter"
		return row.MessageType == expected and row.SpeakerID == m_pending.seat and row.ID > m_pending.floorID
	end
	if answered ~= m_pending.proposalID then return false end
	if kind == "accept" then
		-- Acceptance is only settled once the deal is also enacted.
		if row.MessageType == "deal-accept" then m_pending.sawAccept = true end
		if row.MessageType == "deal-enacted" then m_pending.sawEnacted = true end
		return m_pending.sawAccept == true and m_pending.sawEnacted == true
	end
	-- Reject and retract: the backend's idempotent path re-pushes the existing
	-- rejection row, which is a valid acknowledgement, so neither the author nor a
	-- row-ID floor applies here.
	return row.MessageType == "deal-reject"
end

-- Resolve the mounted editor from the durable rows pushed for the pending pair.
local function onMessages(playerID, counterpartID, batch)
	if not m_active then return end
	batch = type(batch) == "table" and batch or {}
	local rows = type(batch.messages) == "table" and batch.messages or {}
	for _, row in ipairs(rows) do
		if type(row) == "table" and type(row.ID) == "number" and row.ID > m_maxRowID then m_maxRowID = row.ID end
	end
	if m_pending == nil or playerID ~= m_pending.seat or counterpartID ~= m_pending.counterpartID then return end
	-- Older history can never acknowledge a new action.
	if batch.mode == "prepend" then return end
	for _, row in ipairs(rows) do
		if rowResolvesPending(row) then resolvePending(true, nil); return end
	end
end

-- Fail the pending action on a reported transport or action error.
local function onStatus(playerID, counterpartID, status)
	if not m_active or m_pending == nil then return end
	if playerID ~= m_pending.seat or counterpartID ~= m_pending.counterpartID then return end
	if type(status) ~= "table" or status.state ~= "error" then return end
	resolvePending(false, status.detail)
end

VoxDeorumDealUI.registerDriver("real", { onOpen = onOpen, onAction = onAction, setActive = setActive })
LuaEvents.VoxDeorumDiploMessages.Add(onMessages)
LuaEvents.VoxDeorumDiploStatus.Add(onStatus)
