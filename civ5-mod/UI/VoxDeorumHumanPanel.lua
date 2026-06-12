-- Vox Deorum human-control decision panel -- stage 5 (keep-status-quo only),
-- revised to the approved mockup's trigger-button + hidable-dialog model.
--
-- Auto-binds to VoxDeorumHumanPanel.xml. The addin always loads but stays
-- dormant until the strategist's present-decision tool fires
-- LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson).
--
-- The decision does NOT pop the dialog open. Instead a single-line trigger
-- button appears in the native end-turn ("PLEASE WAIT") slot above the minimap,
-- standing in for that button. We use our own widget rather than forking
-- Community Patch's ActionInfoPanel/EndTurnButton: that button lives in a
-- separate UI context an addin cannot reach and is already overridden by Vox
-- Populi, so replacing it would mean re-forking an upstream file (the cost stage
-- 6 rejected for the native screens). Instead alignToEndTurnButton copies the
-- native button's live size/offset onto our trigger so it lands in exactly that
-- slot. The human clicks the trigger to OPEN the dialog; that click
-- is the start of their deliberation -- the decision timer the later plans
-- record (spec section 4's wall-clock starts when the human chooses to engage,
-- not merely when the decision is surfaced). The strategist-side telemetry
-- wiring lands with those plans; here the trigger is the explicit start point.
--
-- The dialog is hidable (Hide button or Esc) so the human can inspect the world
-- without losing the typed rationale; the trigger stays until a decision is
-- submitted. On a keep-status-quo submission it fires
-- Game.BroadcastEvent("HumanDecision", {...}) -- the same fire-and-forget idiom
-- VoxDeorumTest.lua uses -- shows the accepted overlay, then retires the dialog
-- and trigger for a small "auto-playing" chip reporting the last decision.
--
-- Stage 5 ignores optionsJson (no option categories yet); the rationale field
-- and the keep-status-quo action are the whole panel. Submit is wired but stays
-- disabled until later stages add stage-able option categories. The rationale
-- field pre-fills with last turn's rationale, so Keep Status Quo is not blocked
-- on retyping one each turn (the human can still edit or replace it).

local m_playerID = -1
local m_turn = -1
local m_acceptedTimer = nil          -- nil when not animating the accepted state
local m_deliberationStarted = false  -- has the human opened the dialog this turn?
local m_lastRationale = ""           -- last submitted rationale, pre-filled next turn
local ACCEPTED_HOLD_SECONDS = 2.5    -- how long the "submitted" overlay lingers

-- Dormant on load: nothing shows until a decision turn.
ContextPtr:SetHide(true)

-- A rationale is required: keeping the status quo is recorded as a real decision
-- with the human's rationale (never the "[skipped]" sentinel), so it must be
-- annotated like any other.
local function hasRationale()
	local text = Controls.RationaleBox:GetText()
	return text ~= nil and string.match(text, "%S") ~= nil
end

local function refreshButtons()
	Controls.StatusQuoButton:SetDisabled(not hasRationale())
	-- No option categories exist in stage 5, so there is nothing to stage and
	-- submit; the button is present (per the approved mockup) but inert until
	-- stages 6-7 add the categories.
	Controls.SubmitButton:SetDisabled(true)
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

-- A decision is due: reset to the pending state and show the trigger button
-- (NOT the dialog -- the human opens it themselves, starting the timer).
local function showPending(playerID, turn)
	m_playerID = playerID
	m_turn = turn
	m_acceptedTimer = nil
	m_deliberationStarted = false
	ContextPtr:ClearUpdate()
	Controls.AcceptedOverlay:SetHide(true)
	Controls.AutoplayChip:SetHide(true)
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

	-- Pre-fill the chip the participant returns to once the overlay clears.
	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP", m_turn)

	-- Show the accepted confirmation, then retire to the auto-playing chip.
	Controls.AcceptedOverlay:SetHide(false)
	m_acceptedTimer = ACCEPTED_HOLD_SECONDS
	ContextPtr:SetUpdate(onUpdate)
end

-- Inbound: the strategist (via present-decision) signals a pending decision.
LuaEvents.VoxDeorumHumanDecision.Add(function(playerID, turn, optionsJson)
	showPending(playerID, turn)
end)

-- The rationale EditBox change callback fires as the participant types; enabling
-- Keep Status Quo only once a rationale is present.
Controls.RationaleBox:RegisterCallback(function() refreshButtons() end)
Controls.StatusQuoButton:RegisterCallback(Mouse.eLClick, submitStatusQuo)
Controls.SubmitButton:RegisterCallback(Mouse.eLClick, submitStatusQuo)
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
