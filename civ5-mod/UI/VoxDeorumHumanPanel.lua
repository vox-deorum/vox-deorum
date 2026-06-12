-- Vox Deorum human-control decision panel -- stage 5 (keep-status-quo only),
-- revised to the approved mockup's trigger-button + hidable-dialog model.
--
-- Auto-binds to VoxDeorumHumanPanel.xml. The addin always loads but stays
-- dormant until the strategist's present-decision tool fires
-- LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson).
--
-- The decision does NOT pop the dialog open. Instead a trigger button appears
-- in the bottom-right action slot, standing in for the native "PLEASE WAIT"
-- button. We use our own corner widget rather than forking Community Patch's
-- ActionInfoPanel/EndTurnButton: that button lives in a separate UI context an
-- addin cannot reach and is already overridden by Vox Populi, so replacing it
-- would mean re-forking an upstream file (the cost stage 6 rejected for the
-- native screens). The human clicks the trigger to OPEN the dialog; that click
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
-- disabled until later stages add stage-able option categories.

local m_playerID = -1
local m_turn = -1
local m_acceptedTimer = nil          -- nil when not animating the accepted state
local m_deliberationStarted = false  -- has the human opened the dialog this turn?
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
	Controls.RationaleBox:ClearString()
	Controls.StatusLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_STATUS_PENDING", turn)
	Controls.TriggerSub:LocalizeAndSetText("TXT_KEY_VD_HUMAN_TRIGGER_SUB", turn)
	refreshButtons()
	setDialogShown(false)
	Controls.TriggerButton:SetHide(false)
	ContextPtr:SetHide(false)
end

local function submitStatusQuo()
	if not hasRationale() then return end

	-- Pass generateId = true so the DLL attaches a real turn-scoped event id;
	-- HumanDecision flows through the mcp-server's main event handling (unlike
	-- the id-less render-event broadcasts), and an id-less event would crash its
	-- handler before the decision ever reaches the strategist.
	Game.BroadcastEvent("HumanDecision", {
		PlayerID  = m_playerID,
		Turn      = m_turn,
		StatusQuo = true,
		Rationale = Controls.RationaleBox:GetText(),
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
