-- Shared active-seat helpers for observer-aware Vox Deorum UI contexts.

VoxDeorumSeat = VoxDeorumSeat or {}

-- Return the civilization seat represented by the active UI.
function VoxDeorumSeat.EffectiveSeat()
	local activePlayerID = Game.GetActivePlayer()
	local activePlayer = Players[activePlayerID]
	if activePlayer ~= nil and activePlayer:IsObserver() then
		local overridePlayerID = Game.GetObserverUIOverridePlayer()
		if overridePlayerID ~= nil and overridePlayerID >= 0 then return overridePlayerID end
	end
	return activePlayerID
end

-- Return whether the active UI is observing without a civilization-seat override.
function VoxDeorumSeat.IsPureObserver()
	local activePlayer = Players[Game.GetActivePlayer()]
	if activePlayer == nil or not activePlayer:IsObserver() then return false end
	local overridePlayerID = Game.GetObserverUIOverridePlayer()
	return overridePlayerID == nil or overridePlayerID < 0
end
