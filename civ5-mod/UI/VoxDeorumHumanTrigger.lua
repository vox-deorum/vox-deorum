-- Vox Deorum human-control trigger widget.
--
-- Kept separate from VoxDeorumHumanPanel.lua so hiding the decision panel can
-- hide that entire modal context. This small context remains available for
-- reopening the panel without sitting on top of normal Civ/VP popup dialogs.

local m_turn = -1

ContextPtr:SetHide(true)

-- Drop the trigger into the native end-turn ("PLEASE WAIT") button's slot. EUI
-- repositions that button whenever the minimap resizes, so copy its live
-- geometry and apply the same local correction used by the panel fallback.
local function alignToEndTurnButton()
	pcall(function()
		local endTurn = ContextPtr:LookUpControl("../WorldView/ActionInfoPanel/EndTurnButton")
		if endTurn == nil then return end
		local w, h = endTurn:GetSizeVal()
		local x, y = endTurn:GetOffsetVal()
		if not w or not h or w <= 0 or h <= 0 then return end
		local fallbackW = Controls.TriggerButton:GetSizeVal()
		if fallbackW ~= nil and w < fallbackW then w = fallbackW end
		-- Bleed 2px over the native end-turn button so our SmallButton frame fully
		-- covers it (the 9-grid renders ~1px inset, leaving the native frame
		-- peeking out otherwise); shift the offset 1px to keep the bleed centered.
		Controls.TriggerButton:SetSizeVal(w + 2, h + 2)
		Controls.TriggerButton:SetOffsetVal(x + 31, y - 23)
		Controls.AutoplayChip:SetSizeVal(w, 38)
		Controls.AutoplayChip:SetOffsetVal(x + 32, y - 24)
	end)
end

-- Show the pending-decision trigger in the end-turn slot.
local function showTrigger()
	alignToEndTurnButton()
	Controls.AutoplayChip:SetHide(true)
	Controls.TriggerButton:SetHide(false)
	ContextPtr:SetHide(false)
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
	alignToEndTurnButton()
	Controls.TriggerButton:SetHide(true)
	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP_DECISION", m_turn, summary or "")
	Controls.AutoplayChip:SetHide(false)
	ContextPtr:SetHide(false)
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
