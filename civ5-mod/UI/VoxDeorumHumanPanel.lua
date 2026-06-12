-- Vox Deorum human-control decision panel -- stage 6 (one real option category:
-- Next Research), building on stage 5's trigger-button + hidable-dialog model.
--
-- Auto-binds to VoxDeorumHumanPanel.xml. The addin always loads but stays
-- dormant until the strategist's present-decision tool fires
-- LuaEvents.VoxDeorumHumanDecision(playerID, turn, options). `options` is the
-- Flavor-mode OptionsReport delivered as a Lua table: present-decision hands the
-- report to the bridge as a structured value and the DLL converts it to a table
-- (ConvertJsonToLuaValue), so we read options.Options.Technologies and
-- options.Technology directly -- no JSON parsing in Lua.
--
-- The decision does NOT pop the dialog open. Instead a single-line trigger
-- button appears in the native end-turn ("PLEASE WAIT") slot above the minimap,
-- standing in for that button. We use our own widget rather than forking
-- Community Patch's ActionInfoPanel/EndTurnButton: that button lives in a
-- separate UI context an addin cannot reach and is already overridden by Vox
-- Populi, so replacing it would mean re-forking an upstream file. Instead
-- alignToEndTurnButton copies the native button's live size/offset onto our
-- trigger so it lands in exactly that slot. The human clicks the trigger to OPEN
-- the dialog; that click is the start of their deliberation (spec section 4's
-- wall-clock starts when the human chooses to engage). The strategist-side
-- telemetry wiring lands with a later plan; here the trigger is the start point.
--
-- The dialog renders the Next Research single-select list, pre-filled from the
-- report and tagged on the current selection. Picking a technology different
-- from the current one stages a change and enables Submit, which fires
-- Game.BroadcastEvent("HumanDecision", { Technology = ... }). Keep Status Quo is
-- still available for "no change". A non-empty rationale is required before
-- either action; the rationale pre-fills with last turn's so Keep Status Quo is
-- not blocked on retyping one each turn. The dialog is hidable (Hide button or
-- Esc) without discarding the typed rationale; the trigger reopens it.

include("IconSupport")  -- IconHookup, for the per-technology icons

local m_playerID = -1
local m_turn = -1
local m_acceptedTimer = nil          -- nil when not animating the accepted state
local m_deliberationStarted = false  -- has the human opened the dialog this turn?
local m_lastRationale = ""           -- last submitted rationale, pre-filled next turn
local ACCEPTED_HOLD_SECONDS = 2.5    -- how long the "submitted" overlay lingers

-- Research selection state for the current decision turn.
local m_currentTech = nil   -- the player's current forced research (display name), or nil
local m_selectedTech = nil  -- the row the human currently has highlighted, or nil
local m_techButtons = {}    -- { { name = displayName, ctrl = instanceControls }, ... }

-- Lazily-built map from a technology's localized display name to its
-- GameInfo.Technologies row (for icon art). The report keys techs by the same
-- localized name (mcp-server's get-options uses the DB Description), so matching
-- on Locale.Lookup(row.Description) lines them up.
local m_nameToTech = nil

-- Dormant on load: nothing shows until a decision turn.
ContextPtr:SetHide(true)

-- A rationale is required: keeping the status quo (or choosing research) is
-- recorded as a real decision with the human's rationale (never the "[skipped]"
-- sentinel), so it must be annotated like any other.
local function hasRationale()
	local text = Controls.RationaleBox:GetText()
	return text ~= nil and string.match(text, "%S") ~= nil
end

-- The staged research change, or nil when the highlighted row is the current
-- selection (or nothing is highlighted) -- i.e. nothing to submit.
local function stagedTech()
	if m_selectedTech ~= nil and m_selectedTech ~= m_currentTech then
		return m_selectedTech
	end
	return nil
end

local function refreshButtons()
	local rationale = hasRationale()
	-- Keep Status Quo records a real decision, so it only needs a rationale.
	Controls.StatusQuoButton:SetDisabled(not rationale)
	-- Submit needs a staged change (a different technology) and a rationale.
	Controls.SubmitButton:SetDisabled(not (stagedTech() ~= nil and rationale))
end

-- Highlight a research row (single-select): show its pulse, hide the others, and
-- recompute the buttons. Picking the current selection again leaves nothing
-- staged (handled by stagedTech), so Submit stays disabled.
local function selectTech(name)
	m_selectedTech = name
	for _, entry in ipairs(m_techButtons) do
		entry.ctrl.SelectionAnim:SetHide(entry.name ~= name)
	end
	refreshButtons()
end

-- Build the display-name -> GameInfo.Technologies row map once, for icon lookup.
local function buildTechMap()
	if m_nameToTech ~= nil then return end
	m_nameToTech = {}
	for row in GameInfo.Technologies() do
		local label = Locale.Lookup(row.Description)
		if label ~= nil and label ~= "" then
			m_nameToTech[label] = row
		end
	end
end

-- Tear down the previous turn's option rows.
local function clearResearchList()
	Controls.ResearchStack:DestroyAllChildren()
	m_techButtons = {}
end

-- Render the Next Research single-select list from the report. Defensive: a nil
-- or empty options table shows the "no options, keep status quo" note rather
-- than breaking the panel, so the human can always at least keep the status quo.
local function populateResearch(options)
	clearResearchList()
	m_currentTech = nil
	m_selectedTech = nil

	local techs = options and options.Options and options.Options.Technologies
	local current = options and options.Technology or nil
	local currentNext = current and current.Next or nil
	local currentRationale = current and current.Rationale or nil
	if currentNext ~= nil and currentNext ~= "None" then
		m_currentTech = currentNext
	end

	-- Collect the available technology names (JSON-object keys arrive as an
	-- unordered Lua table, so gather then sort for a stable display).
	local names = {}
	if type(techs) == "table" then
		for name in pairs(techs) do
			table.insert(names, name)
		end
	end

	if #names == 0 then
		Controls.ResearchScroll:SetHide(true)
		Controls.ResearchEmpty:SetHide(false)
		return
	end
	Controls.ResearchEmpty:SetHide(true)
	Controls.ResearchScroll:SetHide(false)

	buildTechMap()

	-- Order by tech-tree column (era progression), then name, so the list reads
	-- early -> late like the tech tree rather than in hash order.
	table.sort(names, function(a, b)
		local ra, rb = m_nameToTech[a], m_nameToTech[b]
		local ga = ra and ra.GridX or 999
		local gb = rb and rb.GridX or 999
		if ga ~= gb then return ga < gb end
		return a < b
	end)

	for _, name in ipairs(names) do
		local row = m_nameToTech[name]
		local ctrl = {}
		ContextPtr:BuildInstanceForControl("ResearchInstance", ctrl, Controls.ResearchStack)

		-- Icon (real tech art; hide gracefully if the lookup fails).
		local hasIcon = false
		if row ~= nil and IconHookup ~= nil then
			hasIcon = IconHookup(row.PortraitIndex, 45, row.IconAtlas, ctrl.Icon)
		end
		ctrl.Icon:SetHide(not hasIcon)

		-- Name, with a "current" tag on the player's current selection.
		local nameText = name
		if name == m_currentTech then
			nameText = nameText .. " " .. Locale.Lookup("TXT_KEY_VD_HUMAN_RESEARCH_CURRENT_TAG")
		end
		ctrl.Name:SetText(nameText)

		-- Help text (the same the LLM receives). Convert real newlines from the
		-- report into the markup the label renders, and prepend the earlier
		-- rationale on the current selection.
		local help = tostring(techs[name] or ""):gsub("[\r\n]+", "[NEWLINE]")
		if name == m_currentTech and currentRationale ~= nil and currentRationale ~= "" then
			help = Locale.Lookup("TXT_KEY_VD_HUMAN_RESEARCH_EARLIER_RATIONALE", currentRationale)
				.. "[NEWLINE]" .. help
		end
		ctrl.Help:SetText(help)

		-- Size the row (and its highlights) to fit the wrapped help text.
		local rowH = math.max(58, 32 + ctrl.Help:GetSizeY() + 8)
		ctrl.Box:SetSizeY(rowH)
		ctrl.Button:SetSizeY(rowH)
		ctrl.SelectionAnim:SetSizeY(rowH)
		ctrl.SelectionAnimHL:SetSizeY(rowH)
		ctrl.MouseOverAnim:SetSizeY(rowH)
		ctrl.MouseOverAnimHL:SetSizeY(rowH)
		ctrl.SelectionAnim:SetHide(true)

		local techName = name
		ctrl.Button:RegisterCallback(Mouse.eLClick, function() selectTech(techName) end)

		table.insert(m_techButtons, { name = name, ctrl = ctrl })
	end

	Controls.ResearchStack:CalculateSize()
	Controls.ResearchStack:ReprocessAnchoring()
	Controls.ResearchScroll:CalculateInternalSize()

	-- Pre-select the current research (radio-style), if it is in the list.
	if m_currentTech ~= nil then
		selectTech(m_currentTech)
	end
end

-- Show/hide the dialog (dim backdrop + grid) as a unit, leaving the corner
-- trigger in place so a hidden dialog can be reopened.
local function setDialogShown(shown)
	Controls.DialogDim:SetHide(not shown)
	Controls.MainGrid:SetHide(not shown)
end

-- Open the dialog. The first open of a decision turn marks the start of the
-- human's deliberation -- the decision timer the later plans record. The
-- strategist-side wiring lands with those plans; this is the explicit start
-- point (and is intentionally separate from the decision merely being surfaced).
local function openDialog()
	if not m_deliberationStarted then
		m_deliberationStarted = true
		-- Later plans: signal deliberation start to the strategist here.
	end
	setDialogShown(true)
end

-- Hide the dialog without discarding the typed rationale; the trigger button
-- remains so the human can reopen it. The game stays paused throughout.
local function hideDialog()
	setDialogShown(false)
end

-- Per-frame timer that retires the accepted overlay, swaps the trigger for the
-- auto-playing chip, and returns the participant to the auto-playing game.
local function onUpdate(fDTime)
	if m_acceptedTimer == nil then return end
	m_acceptedTimer = m_acceptedTimer - fDTime
	if m_acceptedTimer <= 0 then
		m_acceptedTimer = nil
		ContextPtr:ClearUpdate()
		setDialogShown(false)
		Controls.AcceptedOverlay:SetHide(true)
		Controls.TriggerButton:SetHide(true)
		Controls.AutoplayChip:SetHide(false)
	end
end

-- Drop our trigger into the native end-turn ("PLEASE WAIT") button's slot. EUI
-- repositions that button whenever the minimap resizes (MiniMapPanel.lua), so
-- rather than hardcode pixels we copy its live size and offset onto our widget,
-- effectively overriding it. The XML geometry is the fallback when the native
-- button can't be reached (non-EUI layout, or the cross-context lookup fails).
-- Wrapped in pcall so a missing control or method never breaks the panel.
local function alignToEndTurnButton()
	pcall(function()
		local endTurn = ContextPtr:LookUpControl("../WorldView/ActionInfoPanel/EndTurnButton")
		if endTurn == nil then return end
		local w, h = endTurn:GetSizeVal()
		local x, y = endTurn:GetOffsetVal()
		if not w or not h or w <= 0 or h <= 0 then return end
		Controls.TriggerButton:SetSizeVal(w, h)
		Controls.TriggerButton:SetOffsetVal(x, y)
		Controls.AutoplayChip:SetSizeVal(w, 38)
		Controls.AutoplayChip:SetOffsetVal(x, y)
	end)
end

-- A decision is due: reset to the pending state, render the options, and show
-- the trigger button (NOT the dialog -- the human opens it, starting the timer).
local function showPending(playerID, turn, options)
	m_playerID = playerID
	m_turn = turn
	m_acceptedTimer = nil
	m_deliberationStarted = false
	ContextPtr:ClearUpdate()
	Controls.AcceptedOverlay:SetHide(true)
	Controls.AutoplayChip:SetHide(true)
	populateResearch(options)
	-- Pre-fill last turn's rationale so Keep Status Quo is not blocked on
	-- retyping a rationale every turn; the human can edit or replace it. The
	-- first decision (no prior rationale) starts empty and must be typed once.
	if m_lastRationale ~= "" then
		Controls.RationaleBox:SetText(m_lastRationale)
	else
		Controls.RationaleBox:ClearString()
	end
	Controls.StatusLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_STATUS_PENDING", turn)
	refreshButtons()
	setDialogShown(false)
	alignToEndTurnButton()
	Controls.TriggerButton:SetHide(false)
	ContextPtr:SetHide(false)
end

-- Show the accepted confirmation, then retire to the auto-playing chip. Callers
-- set the chip label and the overlay's sub-line for the specific decision first.
local function enterAcceptedState()
	Controls.AcceptedOverlay:SetHide(false)
	m_acceptedTimer = ACCEPTED_HOLD_SECONDS
	ContextPtr:SetUpdate(onUpdate)
end

local function submitStatusQuo()
	if not hasRationale() then return end

	-- Remember this rationale so the next decision turn pre-fills it.
	m_lastRationale = Controls.RationaleBox:GetText()

	-- Pass generateId = true so the DLL attaches a real turn-scoped event id;
	-- HumanDecision flows through the mcp-server's main event handling (unlike
	-- the id-less render-event broadcasts), and an id-less event would crash its
	-- handler before the decision ever reaches the strategist.
	Game.BroadcastEvent("HumanDecision", {
		PlayerID  = m_playerID,
		Turn      = m_turn,
		StatusQuo = true,
		Rationale = m_lastRationale,
	}, true)

	-- Pre-fill the chip / overlay the participant returns to once it clears.
	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP", m_turn)
	Controls.AcceptedSub:LocalizeAndSetText("TXT_KEY_VD_HUMAN_ACCEPTED_SUB")
	enterAcceptedState()
end

local function submitDecision()
	local tech = stagedTech()
	if tech == nil or not hasRationale() then return end

	-- Remember this rationale so the next decision turn pre-fills it.
	m_lastRationale = Controls.RationaleBox:GetText()

	-- Fire the chosen research back as a HumanDecision; the human-strategist maps
	-- Technology onto set-research with this rationale. generateId = true for the
	-- same reason as keep-status-quo above.
	Game.BroadcastEvent("HumanDecision", {
		PlayerID  = m_playerID,
		Turn      = m_turn,
		Technology = tech,
		Rationale = m_lastRationale,
	}, true)

	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP_RESEARCH", m_turn, tech)
	Controls.AcceptedSub:LocalizeAndSetText("TXT_KEY_VD_HUMAN_ACCEPTED_SUB_RESEARCH", tech)
	enterAcceptedState()
end

-- Inbound: the strategist (via present-decision) signals a pending decision and
-- hands over the turn's options as a Lua table.
LuaEvents.VoxDeorumHumanDecision.Add(function(playerID, turn, options)
	showPending(playerID, turn, options)
end)

-- The rationale EditBox change callback fires as the participant types; enabling
-- the action buttons only once a rationale is present.
Controls.RationaleBox:RegisterCallback(function() refreshButtons() end)
Controls.StatusQuoButton:RegisterCallback(Mouse.eLClick, submitStatusQuo)
Controls.SubmitButton:RegisterCallback(Mouse.eLClick, submitDecision)
Controls.TriggerButton:RegisterCallback(Mouse.eLClick, openDialog)
Controls.HideButton:RegisterCallback(Mouse.eLClick, hideDialog)

-- Escape hides the open dialog (back to the trigger) instead of falling through
-- to the game menu; while a submission is animating it is swallowed; and when
-- the dialog is already hidden it is left alone, so Escape behaves normally
-- while the human inspects the paused world.
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE then
		if m_acceptedTimer ~= nil then
			return true
		end
		if not Controls.MainGrid:IsHidden() then
			hideDialog()
			return true
		end
	end
	return false
end
ContextPtr:SetInputHandler(inputHandler)
