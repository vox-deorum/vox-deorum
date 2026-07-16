-- Vox Deorum leader-screen conversation launcher.
--
-- The context is loaded by both supported LeaderHeadRoot variants. Its one
-- control is moved into the live native action stack without replacing any
-- native diplomacy action.

local m_diploPlayerID = -1
local m_embedded = false
local m_actionStack = nil

ContextPtr:SetHide(true)

-- Return whether the current leader is a met, living major civilization.
local function canConverse(playerID)
	local activePlayerID = Game.GetActivePlayer()
	local activePlayer = Players[activePlayerID]
	local otherPlayer = Players[playerID]
	if activePlayer == nil or otherPlayer == nil or playerID == activePlayerID then return false end
	if not otherPlayer:IsAlive() or otherPlayer:IsMinorCiv() or otherPlayer:IsBarbarian() then return false end
	return Teams[activePlayer:GetTeam()]:IsHasMet(otherPlayer:GetTeam())
end

-- Reparent the button and remember the live native stack for later reflow.
local function reparentButton(discuss)
	m_actionStack = discuss:GetParent()
	Controls.ConverseButton:ChangeParent(m_actionStack)
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
	local discuss = ContextPtr:LookUpControl("../DiscussButton")
	if discuss == nil or discuss:GetParent() == nil then return false end
	local ok = pcall(reparentButton, discuss)
	if not ok then return false end
	m_embedded = true
	ContextPtr:SetHide(true)
	setButtonHidden(true)
	return true
end

-- Retry embedding while the leader screen finishes constructing its controls.
local function onUpdate()
	if embedButton() then
		ContextPtr:ClearUpdate()
		setButtonHidden(not canConverse(m_diploPlayerID))
	end
end

-- Track the leader currently shown by the native diplomacy scene.
local function onAILeaderMessage(diploPlayerID)
	m_diploPlayerID = diploPlayerID or -1
	if embedButton() then
		setButtonHidden(not canConverse(m_diploPlayerID))
	else
		setButtonHidden(true)
		ContextPtr:SetUpdate(onUpdate)
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
