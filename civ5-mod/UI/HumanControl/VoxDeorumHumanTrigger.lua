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
	if autoplay == nil or autoplay <= 0 then return false end
	local player = Players[Game.GetActivePlayer()]
	return player ~= nil and player:IsObserver()
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

-- LOG-ONLY diagnostics. Event processing is halted while frozen, so listening for
-- popup events is NOT a reliable trigger (these only fire when a refresh happens
-- to be in flight). We keep these purely to trace whether/when the events fire --
-- the actual mechanism is the explicit fire+poke in vdOpenScreen below. Do NOT
-- poke from here.
Events.SerialEventGameMessagePopup.Add(function(popupInfo)
	vdLog("trace SerialEventGameMessagePopup: Type=" .. tostring(popupInfo and popupInfo.Type))
end)
Events.SearchForPediaEntry.Add(function(...)
	vdLog("trace SearchForPediaEntry fired")
end)

-- ===================================================== Strategist screen buttons
-- EUI's top-panel buttons are input-dead while frozen, so these are OUR working
-- buttons over the top bar. Each one fires the screen's native popup event to
-- queue it, then immediately pokes the diplo refresh (force=true) to process and
-- promote it -- no reliance on the (halted) event pipeline.
-- Context name of the screen we currently have open, so we can CLOSE it before
-- opening the next (you must leave a modal before entering it). We close by direct
-- UIManager:DequeuePopup -- a synchronous call that works while the event pipeline
-- is halted, and (unlike re-firing the toggle) is NOT undone when the poke's
-- leaderhead momentarily hides the screen (a hidden screen's Data1=1 toggle
-- RE-OPENS it, which is why the toggle approach failed).
local m_vdOpenCtx = nil

local function vdCloseScreen(ctxName)
	if ctxName == nil then return end
	local ctx = ContextPtr:LookUpControl("/InGame/" .. ctxName)
	if ctx ~= nil then
		pcall(function() UIManager:DequeuePopup(ctx) end)
		vdLog("  closed previous: /InGame/" .. ctxName)
	else
		vdLog("  previous ctx NOT FOUND: /InGame/" .. ctxName)
	end
end

local function vdOpenScreen(label, fire, ctxName)
	vdLog("vdOpenScreen: " .. tostring(label))
	local reopening = (m_vdOpenCtx ~= nil and m_vdOpenCtx == ctxName)
	if m_vdOpenCtx ~= nil then vdCloseScreen(m_vdOpenCtx); m_vdOpenCtx = nil end
	if reopening then return end  -- clicking the open screen just closes it
	pcall(fire)
	m_vdOpenCtx = ctxName
	vdScheduleFlush(true)
end

-- Observer-aware args, copied from EUI ImprovedTopPanel/TopPanel.lua. The override
-- player (the civ the human is observing) is whose data each screen should show.
local function vdOverride()
	local o = Game.GetObserverUIOverridePlayer()
	if o == nil or o < 0 then o = Game.GetActivePlayer() end
	return o
end
local function vdIsObserver()
	local p = Players[Game.GetActivePlayer()]
	return (p ~= nil and p:IsObserver()) and 1 or 0
end

-- control ID -> { label, fire, ctxName }. fire() raises the screen's popup event;
-- ctxName is the screen context's path under /InGame, used to dequeue it on close.
local VD_SCREENS = {
	VDScreenPedia        = { "Civilopedia",  function() Events.SearchForPediaEntry("") end, "CivilopediaScreen" },
	VDScreenDemographics = { "Demographics", function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_DEMOGRAPHICS, Data1 = 1 } end, "Demographics" },
	VDScreenTech         = { "Tech Tree",    function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_TECH_TREE, Data1 = 1, Data2 = -1, Data4 = vdIsObserver(), Data5 = vdOverride() } end, "TechTree" },
	VDScreenPolicy       = { "Policies",     function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_CHOOSEPOLICY, Data1 = 1, Data3 = vdIsObserver(), Data4 = vdOverride() } end, "SocialPolicyPopup" },
	VDScreenEconomic     = { "Economic",     function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_ECONOMIC_OVERVIEW, Data1 = 1 } end, "EconomicOverview" },
	VDScreenMilitary     = { "Military",     function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_MILITARY_OVERVIEW, Data1 = 1 } end, "MilitaryOverview" },
	VDScreenReligion     = { "Religion",     function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_RELIGION_OVERVIEW, Data1 = 1 } end, "ReligionOverview" },
	VDScreenCulture      = { "Culture",      function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_CULTURE_OVERVIEW, Data1 = 1, Data2 = 4 } end, "CultureOverview" },
	VDScreenTrade        = { "Trade Routes", function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_TRADE_ROUTE_OVERVIEW, Data1 = 1 } end, "TradeRouteOverview" },
	VDScreenCorp         = { "Corporations", function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_MODDER_5, Data1 = 1 } end, "CorporationsOverview" },
	VDScreenEspionage    = { "Espionage",    function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_ESPIONAGE_OVERVIEW, Data1 = 1 } end, "EspionageOverview" },
	VDScreenDiplo        = { "Diplomacy",    function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_DIPLOMATIC_OVERVIEW, Data1 = 1 } end, "DiploRelationships" },
	VDScreenVassal       = { "Vassals",      function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_MODDER_11, Data1 = 1 } end, "VassalageOverview" },
	VDScreenVictory      = { "Victory",      function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_VICTORY_INFO, Data1 = 1 } end, "VictoryProgress" },
	VDScreenLeague       = { "League",       function() Events.SerialEventGameMessagePopup{ Type = ButtonPopupTypes.BUTTONPOPUP_LEAGUE_OVERVIEW, Data1 = 1 } end, "LeagueOverview" },
}

for id, def in pairs(VD_SCREENS) do
	local ctrl = Controls[id]
	if ctrl ~= nil then
		ctrl:RegisterCallback(Mouse.eLClick, function() vdOpenScreen(def[1], def[2], def[3]) end)
	end
end

-- Reparent the strip INTO the EUI top-panel context so it sits above that
-- context's own frame (which otherwise occludes/consumes clicks for a strip
-- parented under it on WorldView) and shares the top panel's input layer. The top
-- panel does not exist when this addin's Lua first runs, so this is retried (via
-- vdShowScreenBar) until it succeeds.
local m_vdScreenBarEmbedded = false
local function vdEnsureScreenBar()
	if m_vdScreenBarEmbedded then return true end
	local topPanel = ContextPtr:LookUpControl("/InGame/TopPanel")
	local parent = topPanel or ContextPtr:LookUpControl("/InGame/WorldView")
	if parent == nil then return false end
	local ok = pcall(function() Controls.VDScreenBar:ChangeParent(parent) end)
	if ok then
		m_vdScreenBarEmbedded = true
		vdLog("screen bar embedded onto " .. (topPanel ~= nil and "/InGame/TopPanel" or "/InGame/WorldView"))
	end
	return ok
end

-- Hide EUI's round overview-launcher buttons (DiploCorner's button stack:
-- Diplomacy/Vassal/League/Espionage/etc.) that our strip replaces, or restore
-- them when our strip is not up. Keep the menu (TopPanel) and the met-civ leader
-- icons (DiploList, a sibling), so toggle the stack, NOT the whole DiploCorner
-- context. Idempotent and kept separate from the one-time embed so it can be
-- re-asserted after EUI/JFD rebuild the corner on an observed-civ switch. Best-
-- effort: if the path does not resolve (unnamed wrappers) this is a no-op.
local function vdSetEuiOverviewHidden(hidden)
	pcall(function()
		local stack = ContextPtr:LookUpControl("/InGame/WorldView/DiploCorner/DiploCornerStack")
		if stack ~= nil then stack:SetHide(hidden) end
	end)
end

-- Human-strategist mode pins the observer view to the human's seat via
-- Game.SetObserverUIOverridePlayer (set before autoplay, serialized in saves); pure AI
-- observation sets no override. That override is the mod's signal that a human owns a seat,
-- so the strip and its EUI-button hiding apply only then. Mirrors the vdOverride idiom above.
local function vdHumanStrategist()
	local o = Game.GetObserverUIOverridePlayer()
	return o ~= nil and o >= 0
end

-- Show the strip only in human-strategist mode (override present) and only during the
-- strategist freeze: observer + AI autoplay (vdNeedsFlush), the same state that gates the
-- poke. EUI's own overview buttons are hidden only while our replacement is actually up. In
-- pure AI observation there is no override, so we bail out and never touch the observer UI.
local function vdShowScreenBar()
	if not vdHumanStrategist() then return end
	vdEnsureScreenBar()
	local show = vdNeedsFlush()
	Controls.VDScreenBar:SetHide(not show)
	vdSetEuiOverviewHidden(show)
end
local function vdHideScreenBar()
	Controls.VDScreenBar:SetHide(true)
end

-- Evaluate now, then re-evaluate on the game-lifecycle events that bring the strip up in
-- human-strategist mode: LoadScreenClose (game becomes interactive; also the embed retry) and
-- GameplaySetActivePlayer (fires when autoplay activation switches the active seat to the
-- observer). All of these are no-ops in pure observation, where vdShowScreenBar bails on the
-- missing override.
vdShowScreenBar()
if Events ~= nil then
	if Events.LoadScreenClose ~= nil then Events.LoadScreenClose.Add(vdShowScreenBar) end
	if Events.GameplaySetActivePlayer ~= nil then Events.GameplaySetActivePlayer.Add(vdShowScreenBar) end
end

-- Human-strategist mode (when a human owns a seat) still tucks the strip away
-- behind its modal decision panel and restores it afterward; harmless no-ops in
-- pure AI-strategist observation where these events never fire.
LuaEvents.VoxDeorumHumanDecision.Add(vdShowScreenBar)
LuaEvents.VoxDeorumHumanPanelHidden.Add(vdShowScreenBar)
LuaEvents.VoxDeorumHumanPanelSubmitted.Add(vdShowScreenBar)
LuaEvents.VoxDeorumHumanPanelOpened.Add(vdHideScreenBar)
LuaEvents.VoxDeorumHumanPanelSubmitting.Add(vdHideScreenBar)

vdLog("strategist screen buttons loaded")
