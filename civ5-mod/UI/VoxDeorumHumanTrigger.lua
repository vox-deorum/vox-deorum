-- Vox Deorum human-control trigger widget.
--
-- Kept separate from VoxDeorumHumanPanel.lua so hiding the decision panel can
-- hide that entire modal context. This small context remains available for
-- reopening the panel without sitting on top of normal Civ/VP popup dialogs.

local m_turn = -1
local m_embeddedInActionInfo = false
local m_triggerFallbackW = Controls.TriggerButton:GetSizeVal()

ContextPtr:SetHide(true)

-- Move the live controls into the native ActionInfoPanel. The addin context is
-- loaded above WorldView, so leaving it visible while a decision is pending can
-- interfere with normal popup routing even though it only draws one button.
local function embedInActionInfoPanel()
	if m_embeddedInActionInfo then return true end
	local actionInfo = ContextPtr:LookUpControl("/InGame/WorldView/ActionInfoPanel")
	if actionInfo == nil then return false end
	local ok = pcall(function()
		Controls.TriggerButton:ChangeParent(actionInfo)
		Controls.AutoplayChip:ChangeParent(actionInfo)
	end)
	if not ok then return false end
	m_embeddedInActionInfo = true
	ContextPtr:SetHide(true)
	return true
end

-- Drop the trigger into the native end-turn ("PLEASE WAIT") button's slot. EUI
-- repositions that button whenever the minimap resizes, so copy its live
-- geometry. When embedded, both controls share ActionInfoPanel coordinates; the
-- older addin-context fallback keeps its historical local correction.
local function alignToEndTurnButton()
	local embedded = embedInActionInfoPanel()
	pcall(function()
		local endTurn = ContextPtr:LookUpControl("/InGame/WorldView/ActionInfoPanel/EndTurnButton")
		if endTurn == nil then return end
		local w, h = endTurn:GetSizeVal()
		local x, y = endTurn:GetOffsetVal()
		if not w or not h or w <= 0 or h <= 0 then return end
		local fallbackW = m_triggerFallbackW
		if fallbackW ~= nil and w < fallbackW then w = fallbackW end
		-- Bleed 2px over the native end-turn button so our SmallButton frame fully
		-- covers it (the 9-grid renders ~1px inset, leaving the native frame
		-- peeking out otherwise); shift the offset 1px to keep the bleed centered.
		Controls.TriggerButton:SetSizeVal(w + 2, h + 2)
		Controls.AutoplayChip:SetSizeVal(w, 38)
		if embedded then
			Controls.TriggerButton:SetOffsetVal(x - 1, y - 1)
			Controls.AutoplayChip:SetOffsetVal(x, y)
		else
			Controls.TriggerButton:SetOffsetVal(x + 31, y - 23)
			Controls.AutoplayChip:SetOffsetVal(x + 32, y - 24)
		end
	end)
	return embedded
end

-- Show the pending-decision trigger in the end-turn slot.
local function showTrigger()
	local embedded = alignToEndTurnButton()
	Controls.AutoplayChip:SetHide(true)
	Controls.TriggerButton:SetHide(false)
	ContextPtr:SetHide(embedded)
end

-- Hide this tiny context while the full decision panel is open or submitting.
local function hideWidget()
	Controls.TriggerButton:SetHide(true)
	Controls.AutoplayChip:SetHide(true)
	ContextPtr:SetHide(true)
end

-- Show the last-decision chip after the panel's accepted overlay retires.
local function showAutoplayChip(turn, summary)
	m_turn = turn or m_turn
	local embedded = alignToEndTurnButton()
	Controls.TriggerButton:SetHide(true)
	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP_DECISION", m_turn, summary or "")
	Controls.AutoplayChip:SetHide(false)
	ContextPtr:SetHide(embedded)
end

-- A decision is pending; the main panel stores the report while this context
-- presents the reopen/open affordance.
LuaEvents.VoxDeorumHumanDecision.Add(function(playerID, turn, options)
	m_turn = turn
	showTrigger()
end)

-- The full panel has been hidden, so restore the trigger for reopening.
LuaEvents.VoxDeorumHumanPanelHidden.Add(function()
	showTrigger()
end)

-- The full panel is visible or submitting; keep the trigger context out of the
-- way so it does not cover the modal dialog or popup stack.
LuaEvents.VoxDeorumHumanPanelOpened.Add(hideWidget)
LuaEvents.VoxDeorumHumanPanelSubmitting.Add(hideWidget)

-- The decision was accepted; show a small status chip until the next pending
-- decision replaces it.
LuaEvents.VoxDeorumHumanPanelSubmitted.Add(showAutoplayChip)

-- Ask the modal panel to open; it owns all staged state and validation.
Controls.TriggerButton:RegisterCallback(Mouse.eLClick, function()
	LuaEvents.VoxDeorumHumanOpenPanel()
end)

-- ===================================================== Native-screen auto-flush
-- In human-strategist mode the game is frozen under AI autoplay with the view
-- pinned to an override player. The EXE will QUEUE ordinary screen popups
-- (Demographics, Tech Tree, Social Policy, Civilopedia, the overviews, ...) but
-- never PROMOTES them, so the human can submit decisions yet cannot look
-- anything up. The proven (and only reliable) un-sticker is the "diplo poke":
-- open a leaderhead, then leave it the instant it activates; leaving drains the
-- popup queue and the pending screen finally appears.
--
-- The native top-panel buttons and F-key hotkeys already fire the correct,
-- observer-aware popup events, so we do not rebuild any screen logic -- we just
-- listen for a screen popup (or a Civilopedia search) and attach a poke to flush
-- whatever was queued. The whitelist below is deliberately limited to read-only
-- overview screens so we never poke on decision dialogs, notifications,
-- production/tech choosers, gift confirms, or genuine leaderheads.

-- DIAGNOSTIC (temporary): trace which part of the auto-flush path runs. Read in
-- Logs/Lua.log filtered on "[VDFlush]". Remove once the flow is confirmed.
local function vdLog(msg)
	print("[VDFlush] " .. tostring(msg))
end

-- First alive major civ that isn't the active player -- a leaderhead target.
local function vdFindDiploTarget()
	local ap = Game.GetActivePlayer()
	for i = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		local p = Players[i]
		if p ~= nil and p:IsAlive() and i ~= ap then return i end
	end
	return nil
end

-- True only when BOTH hold: AI autoplay is running AND the active seat is an
-- observer. That is exactly the frozen human-strategist state where the EXE
-- queues but never promotes screen popups. Outside it (a real turn-active human,
-- or autoplay off) native popups show on their own and we must not poke.
local function vdNeedsFlush()
	local autoplay = Game.GetAIAutoPlay()
	local ap = Game.GetActivePlayer()
	local player = Players[ap]
	local isObserver = (player ~= nil) and player:IsObserver()
	vdLog("vdNeedsFlush: autoplay=" .. tostring(autoplay)
		.. " activePlayer=" .. tostring(ap)
		.. " isObserver=" .. tostring(isObserver))
	if autoplay == nil or autoplay <= 0 then return false end
	return player ~= nil and isObserver
end

-- Set while a poke's leaderhead is open; cleared on auto-leave. A single poke
-- flushes every popup queued in the same window, and guards against re-entry.
local m_vdFlushInFlight = false
-- Armed by a poke so the AILeaderMessage handler only leaves the leaderhead WE
-- opened, never a genuine AI-initiated one.
local m_vdLeaveArmed = false

-- True between our poke's leave request and the leaderhead actually tearing down,
-- so the cursor reset below only fires for the leaderhead WE opened.
local m_vdPokeLeaving = false

-- Fires once the leaderhead actually activates, so the leave happens AFTER the
-- screen's OnPopup has queued itself (the order that drains the queue).
Events.AILeaderMessage.Add(function()
	vdLog("AILeaderMessage fired: leaveArmed=" .. tostring(m_vdLeaveArmed))
	if not m_vdLeaveArmed then return end
	m_vdLeaveArmed = false
	m_vdPokeLeaving = true
	local ok = pcall(function() UI.RequestLeaveLeader() end)
	vdLog("RequestLeaveLeader ok=" .. tostring(ok))
	m_vdFlushInFlight = false
end)

-- LeaderHeadRoot captures the cursor on show and restores it on hide
-- (LeaderHeadRoot.lua:356/432). Our synthetic open+immediate-leave happens while
-- the engine's busy/loading cursor (1) is up, so LeaderHeadRoot captures busy and
-- restores busy when it tears down -- leaving the pointer stuck. This event fires
-- during that teardown; our addin registers after base UI, so this handler runs
-- after LeaderHeadRoot's restore in the same dispatch and gets the last word.
Events.LeavingLeaderViewMode.Add(function()
	if not m_vdPokeLeaving then return end
	m_vdPokeLeaving = false
	pcall(function() UIManager:SetUICursor(0) end)
	vdLog("LeavingLeaderViewMode: cursor reset to default after poke")
end)

-- Open+leave a leaderhead to drain the queued screen popup. Coalesces: while a
-- poke is in flight, further requests are ignored; the next screen the human
-- opens after the leave gets its own poke.
local function vdScheduleFlush(force)
	vdLog("vdScheduleFlush: entered (inFlight=" .. tostring(m_vdFlushInFlight)
		.. ", force=" .. tostring(force) .. ")")
	if m_vdFlushInFlight then vdLog("  -> skip: poke already in flight"); return end
	if not force and not vdNeedsFlush() then vdLog("  -> skip: gate (vdNeedsFlush) false"); return end
	-- A popup already up means this event is most likely a toggle-CLOSE; skip the
	-- poke to avoid a pointless leaderhead flicker. Bypassed when forced (test).
	local popupUp = false
	pcall(function() popupUp = UI.IsPopupUp() end)
	vdLog("  UI.IsPopupUp=" .. tostring(popupUp))
	if not force and popupUp then vdLog("  -> skip: popup already up"); return end
	local target = vdFindDiploTarget()
	vdLog("  diplo target=" .. tostring(target))
	if target == nil then vdLog("  -> skip: no diplo target"); return end
	m_vdFlushInFlight = true
	m_vdLeaveArmed = true
	local ok = pcall(function() Players[target]:DoBeginDiploWithHuman() end)
	vdLog("  DoBeginDiploWithHuman(" .. tostring(target) .. ") ok=" .. tostring(ok))
	if not ok then
		m_vdFlushInFlight = false
		m_vdLeaveArmed = false
	end
end

-- Cross-context manual flush hook. The decision panel lives in a separate Lua
-- context and (unlike the native top panel while frozen) DOES receive input, so
-- it can drive a poke through here as a controlled test pathway. `force` skips
-- the gate/popup-up checks so we can isolate the poke mechanism itself.
LuaEvents.VoxDeorumHumanRequestFlush.Add(function(force)
	vdLog("VoxDeorumHumanRequestFlush received (force=" .. tostring(force) .. ")")
	vdScheduleFlush(force)
end)

-- Read-only overview screens reachable while the human is observing. All of
-- these are opened via Events.SerialEventGameMessagePopup with a ButtonPopupType
-- (from the native top panel, an F-key hotkey, or Game.DoControl).
local VD_FLUSH_TYPES = {
	[ButtonPopupTypes.BUTTONPOPUP_DEMOGRAPHICS]         = true,
	[ButtonPopupTypes.BUTTONPOPUP_TECH_TREE]            = true,
	[ButtonPopupTypes.BUTTONPOPUP_CHOOSEPOLICY]         = true,
	[ButtonPopupTypes.BUTTONPOPUP_ECONOMIC_OVERVIEW]    = true,
	[ButtonPopupTypes.BUTTONPOPUP_MILITARY_OVERVIEW]    = true,
	[ButtonPopupTypes.BUTTONPOPUP_RELIGION_OVERVIEW]    = true,
	[ButtonPopupTypes.BUTTONPOPUP_DIPLOMATIC_OVERVIEW]  = true,
	[ButtonPopupTypes.BUTTONPOPUP_VICTORY_INFO]         = true,
	[ButtonPopupTypes.BUTTONPOPUP_WHOS_WINNING]         = true,
	[ButtonPopupTypes.BUTTONPOPUP_LEAGUE_OVERVIEW]      = true,
	[ButtonPopupTypes.BUTTONPOPUP_CULTURE_OVERVIEW]     = true,
	[ButtonPopupTypes.BUTTONPOPUP_TRADE_ROUTE_OVERVIEW] = true,
	[ButtonPopupTypes.BUTTONPOPUP_ESPIONAGE_OVERVIEW]   = true,
}

-- A whitelisted screen popup was fired; flush it. Our flush (RequestLeaveLeader)
-- runs later, on the next AILeaderMessage frame, so it always lands after the
-- screen's synchronous QueuePopup regardless of listener order. The poke raises
-- AILeaderMessage (not SerialEventGameMessagePopup), so it never re-arms us.
Events.SerialEventGameMessagePopup.Add(function(popupInfo)
	local ptype = popupInfo and popupInfo.Type
	local whitelisted = (popupInfo ~= nil) and (VD_FLUSH_TYPES[popupInfo.Type] == true)
	vdLog("SerialEventGameMessagePopup: Type=" .. tostring(ptype)
		.. " whitelisted=" .. tostring(whitelisted))
	if whitelisted then
		vdScheduleFlush()
	end
end)

-- Civilopedia opens via SearchForPediaEntry rather than a ButtonPopupType.
Events.SearchForPediaEntry.Add(function(...)
	vdLog("SearchForPediaEntry fired")
	vdScheduleFlush()
end)

vdLog("auto-flush module loaded")
