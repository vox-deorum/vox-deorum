-- Checksum the ID and Type of every row in the named GameInfo tables.
-- The MCP server computes the same checksum from Civ5DebugDatabase.db (tableChecksum in database/manager.ts)
-- to prove its ID-to-name mappings match the live game. Keep the arithmetic in sync with that function.
local modulus = 2147483647
local results = {}

for tableName in string.gmatch(tableNames, "[^,]+") do
  local rows = {}
  local gameTable = GameInfo[tableName]
  if gameTable then
    for row in gameTable() do
      rows[#rows + 1] = { ID = row.ID, Type = row.Type }
    end
  end

  -- Fold the rows in ID order as one sequence, so swapped IDs change the checksum
  table.sort(rows, function(a, b) return a.ID < b.ID end)
  local checksum = 0
  for _, row in ipairs(rows) do
    local text = tostring(row.ID) .. ":" .. tostring(row.Type) .. ";"
    for i = 1, #text do
      checksum = (checksum * 31 + string.byte(text, i)) % modulus
    end
  end
  results[tableName] = { Count = #rows, Checksum = checksum }
end

return results
