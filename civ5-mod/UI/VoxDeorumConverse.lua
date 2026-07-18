-- Vox Deorum leader-screen conversation launcher.
--
-- The context is loaded by both supported LeaderHeadRoot variants. Its one
-- control is moved into the live native action stack without replacing any
-- native diplomacy action.

include("VoxDeorumSeat")

local DISCUSS_BUTTON_PATHS = {
	"../DiscussButton",
	"../RootOptions/DiscussButton",
	"../RootOptions/PrimaryStack/ButtonStack/DiscussButton",
}
local m_diploPlayerID = -1
local m_embedded = false
local m_actionStack = nil
local m_resolvedPathLogged = false
local m_fallbackLogged = false

ContextPtr:SetHide(true)

-- Return whether the current leader is a met, living major civilization.
local function canConverse(playerID)
	local activePlayerID = VoxDeorumSeat.EffectiveSeat()
	local activePlayer = Players[activePlayerID]
	local otherPlayer = Players[playerID]
	if activePlayer == nil or otherPlayer == nil or playerID == activePlayerID then return false end
	if not otherPlayer:IsAlive() or otherPlayer:IsMinorCiv() or otherPlayer:IsBarbarian() then return false end
	return Teams[activePlayer:GetTeam()]:IsHasMet(otherPlayer:GetTeam())
end

-- Reparent the button and remember the live native stack for later reflow.
local function reparentButton(discuss, parent)
	m_actionStack = parent
	Controls.ConverseButton:ChangeParent(m_actionStack)
end

-- Return the first Discuss control whose native parent is available.
local function findDiscussButton()
	for _, path in ipairs(DISCUSS_BUTTON_PATHS) do
		local lookupOK, discuss = pcall(ContextPtr.LookUpControl, ContextPtr, path)
		if lookupOK and discuss ~= nil then
			local parentOK, parent = pcall(discuss.GetParent, discuss)
			if parentOK and parent ~= nil then return discuss, parent, path end
		end
	end
	return nil, nil, nil
end

-- Anchor the launcher near the (3a) action area when its unnamed stack is opaque.
local function reparentToRootOptions(rootOptions)
	-- This fallback cannot join or reflow the unnamed native stack, so its
	-- explicit position is intentionally tied to the (3a) RootOptions layout.
	m_actionStack = nil
	Controls.ConverseButton:ChangeParent(rootOptions)
	Controls.ConverseButton:SetAnchor("R,B")
	Controls.ConverseButton:SetOffsetVal(40, 250)
end

-- Recalculate the remembered native stack after a visibility change.
local function recalculateActionStack()
	if m_actionStack == nil then return end
	m_actionStack:CalculateSize()
	m_actionStack:ReprocessAnchoring()
end

-- Change launcher visibility and immediately reflow its native parent stack.
local function setButtonHidden(isHidden)
	Controls.ConverseButton:SetHide(isHidden)
	pcall(recalculateActionStack)
end

-- Move the launcher beside Discuss once LeaderHeadRoot has built that stack.
local function embedButton()
	if m_embedded then return true end
	local discuss, parent, path = findDiscussButton()
	if discuss ~= nil then
		local ok = pcall(reparentButton, discuss, parent)
		if not ok then return false end
		if not m_resolvedPathLogged then
			print("Vox Deorum: Converse button embedded through " .. path)
			m_resolvedPathLogged = true
		end
	else
		local lookupOK, rootOptions = pcall(ContextPtr.LookUpControl, ContextPtr, "../RootOptions")
		if not lookupOK or rootOptions == nil or not pcall(reparentToRootOptions, rootOptions) then return false end
		if not m_fallbackLogged then
			print("Vox Deorum: Converse button used the RootOptions fallback because the unnamed action stack was opaque")
			m_fallbackLogged = true
		end
	end
	m_embedded = true
	ContextPtr:SetHide(true)
	setButtonHidden(true)
	return true
end

-- Track the leader currently shown by the native diplomacy scene.
local function onAILeaderMessage(diploPlayerID)
	m_diploPlayerID = diploPlayerID or -1
	if embedButton() then
		setButtonHidden(not canConverse(m_diploPlayerID))
	else
		setButtonHidden(true)
	end
end

-- Leave the native leader scene, then open Vox Deorum for the tracked leader.
local function onConverseClicked()
	if not canConverse(m_diploPlayerID) then return end
	setButtonHidden(true)
	UI.SetLeaderHeadRootUp(false)
	UI.RequestLeaveLeader()
	LuaEvents.VoxDeorumDiploOpen(m_diploPlayerID)
end

Controls.ConverseButton:RegisterCallback(Mouse.eLClick, onConverseClicked)
Events.AILeaderMessage.Add(onAILeaderMessage)
