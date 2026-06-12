-- Vox Deorum human-control decision panel -- stage 5 (keep-status-quo only).
--
-- Auto-binds to VoxDeorumHumanPanel.xml. The addin always loads but stays
-- dormant until the strategist's present-decision tool fires
-- LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson). On a keep-
-- status-quo submission it fires Game.BroadcastEvent("HumanDecision", {...}),
-- which travels the existing DLL -> bridge -> mcp-server -> strategist path
-- (the same fire-and-forget idiom VoxDeorumTest.lua uses for render events).
--
-- Stage 5 ignores optionsJson (no option categories yet); the rationale field
-- and the keep-status-quo action are the whole panel. Submit is wired but stays
-- disabled until later stages add stage-able option categories.

local m_playerID = -1
local m_turn = -1
local m_acceptedTimer = nil        -- nil when not animating the accepted state
local ACCEPTED_HOLD_SECONDS = 2.5  -- how long the "submitted" overlay lingers

-- Dormant on load: the panel only appears on a decision turn.
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

-- Per-frame timer that retires the accepted overlay and hides the panel,
-- returning the participant to the auto-playing game (the "waiting" state).
local function onUpdate(fDTime)
	if m_acceptedTimer == nil then return end
	m_acceptedTimer = m_acceptedTimer - fDTime
	if m_acceptedTimer <= 0 then
		m_acceptedTimer = nil
		ContextPtr:ClearUpdate()
		ContextPtr:SetHide(true)
	end
end

-- A decision is due: reset to the pending state and show the panel.
local function showPending(playerID, turn)
	m_playerID = playerID
	m_turn = turn
	m_acceptedTimer = nil
	ContextPtr:ClearUpdate()
	Controls.AcceptedOverlay:SetHide(true)
	Controls.RationaleBox:ClearString()
	Controls.StatusLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_STATUS_PENDING", turn)
	refreshButtons()
	ContextPtr:SetHide(false)
end

local function submitStatusQuo()
	if not hasRationale() then return end

	Game.BroadcastEvent("HumanDecision", {
		PlayerID  = m_playerID,
		Turn      = m_turn,
		StatusQuo = true,
		Rationale = Controls.RationaleBox:GetText(),
	})

	-- Show the accepted confirmation, then auto-hide (accepted -> waiting).
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

-- Keep the panel modal while a decision is pending: swallow Escape so it cannot
-- be dismissed into the game menu mid-decision (there is no reopen control yet).
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE then
		return true
	end
	return false
end
ContextPtr:SetInputHandler(inputHandler)
