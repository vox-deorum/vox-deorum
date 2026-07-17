-- Post-Notification Lua Script
-- Raises a native Vox Deorum notification on a player's notification panel.
-- A counterpartID >= 0 makes the notification open the diplomacy conversation on
-- click; a counterpartID of -1 (no counterpart) makes it show `message` in a text
-- dialog on click. `message` is stored as the notification tooltip, which the
-- diplomacy panel caches for that click-to-show path.

local player = Players[playerID]
if player == nil or NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY == nil then
    return false
end

local notificationID = player:AddNotificationName("NOTIFICATION_VOX_DEORUM_DIPLOMACY", message, summary, -1, -1, counterpartID, counterpartID)
return notificationID ~= nil and notificationID >= 0
