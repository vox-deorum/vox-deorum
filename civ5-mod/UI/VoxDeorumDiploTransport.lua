-- Registers the temporary diplomacy push transport and Lua.log probe listeners.
-- TODO(stage-04): Replace the temporary push transport and remove Lua.log probes.

VoxDeorumDiploTransport = VoxDeorumDiploTransport or {}

local m_registered = false

-- Dispatch a Begin push into this panel context.
local function dispatchBegin(playerID, counterpartID, turn, meta)
	LuaEvents.VoxDeorumDiploBegin(playerID, counterpartID, turn, meta)
	return true
end

-- Dispatch a Messages push into this panel context.
local function dispatchMessages(playerID, counterpartID, batch)
	LuaEvents.VoxDeorumDiploMessages(playerID, counterpartID, batch)
	return true
end

-- Dispatch a Status push into this panel context.
local function dispatchStatus(playerID, counterpartID, status)
	LuaEvents.VoxDeorumDiploStatus(playerID, counterpartID, status)
	return true
end

-- Dispatch a Delta push into this panel context.
local function dispatchDelta(playerID, counterpartID, text)
	LuaEvents.VoxDeorumDiploDelta(playerID, counterpartID, text)
	return true
end

-- Register one DLL-callable push function.
local function registerPushFunction(name, handler)
	local ok, errorMessage = pcall(Game.RegisterFunction, name, handler)
	if not ok then
		print("[VDDiploTransport] Registration failed for " .. name .. ": " .. tostring(errorMessage))
	end
	return ok
end

-- Register the push functions once after all DLL bindings succeed.
function VoxDeorumDiploTransport.EnsureRegistered()
	if m_registered then return end
	if Game == nil or type(Game.RegisterFunction) ~= "function" then
		print("[VDDiploTransport] Game.RegisterFunction is unavailable")
		return
	end

	local beginRegistered = registerPushFunction("VoxDeorumDiploBegin", dispatchBegin)
	local messagesRegistered = registerPushFunction("VoxDeorumDiploMessages", dispatchMessages)
	local statusRegistered = registerPushFunction("VoxDeorumDiploStatus", dispatchStatus)
	local deltaRegistered = registerPushFunction("VoxDeorumDiploDelta", dispatchDelta)
	local registered = beginRegistered and messagesRegistered and statusRegistered and deltaRegistered
	m_registered = registered
	print("[VDDiploTransport] Push registration complete=" .. tostring(registered))
end

-- Print a temporary Begin probe to Lua.log.
local function onBegin(playerID, counterpartID, turn, meta)
	meta = type(meta) == "table" and meta or {}
	print("[VDDiploTransport] Begin player=" .. tostring(playerID) ..
		" counterpart=" .. tostring(counterpartID) ..
		" turn=" .. tostring(turn) ..
		" hasEnvoy=" .. tostring(meta.hasEnvoy) ..
		" busy=" .. tostring(meta.busy) ..
		" hasMore=" .. tostring(meta.hasMore))
end

-- Print a temporary Messages probe to Lua.log.
local function onMessages(playerID, counterpartID, batch)
	batch = type(batch) == "table" and batch or {}
	local messages = type(batch.messages) == "table" and batch.messages or {}
	print("[VDDiploTransport] Messages player=" .. tostring(playerID) ..
		" counterpart=" .. tostring(counterpartID) ..
		" mode=" .. tostring(batch.mode) ..
		" hasMore=" .. tostring(batch.hasMore) ..
		" count=" .. tostring(#messages))
	for _, row in ipairs(messages) do
		print("[VDDiploTransport] Row id=" .. tostring(row.ID) ..
			" speaker=" .. tostring(row.SpeakerID) ..
			" type=" .. tostring(row.MessageType) ..
			" turn=" .. tostring(row.Turn) ..
			" content=" .. tostring(row.Content))
	end
end

-- Print a temporary Status probe to Lua.log.
local function onStatus(playerID, counterpartID, status)
	status = type(status) == "table" and status or {}
	print("[VDDiploTransport] Status player=" .. tostring(playerID) ..
		" counterpart=" .. tostring(counterpartID) ..
		" state=" .. tostring(status.state) ..
		" detail=" .. tostring(status.detail))
end

-- Print a temporary Delta probe to Lua.log.
local function onDelta(playerID, counterpartID, text)
	print("[VDDiploTransport] Delta player=" .. tostring(playerID) ..
		" counterpart=" .. tostring(counterpartID) ..
		" text=" .. tostring(text))
end

-- TODO(stage-04): Remove the temporary Lua.log probe listeners.
LuaEvents.VoxDeorumDiploBegin.Add(onBegin)
LuaEvents.VoxDeorumDiploMessages.Add(onMessages)
LuaEvents.VoxDeorumDiploStatus.Add(onStatus)
LuaEvents.VoxDeorumDiploDelta.Add(onDelta)
