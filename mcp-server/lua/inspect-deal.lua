-- Read-only inspection of a (possibly empty) proposed deal between two major civs.
--
-- Builds a TRANSIENT scratch deal (UI.GetScratchDeal, exactly as the in-game trade
-- screen does), reads back per-term legality + reasons + both-direction AI value for
-- the proposed items, and enumerates the full tradable range each side could put on
-- the table. Per-term legality/reasons use the human-to-human override directly;
-- scratch-deal context is best-effort for terms the stock Add* helpers accept. The
-- scratch deal is NEVER activated and is cleared on the way out, so this leaves no
-- trace on game state (specs.md §4, stage 3 is read-only).
--
-- Args:
--   playerAID, playerBID : the two major-civ player IDs
--   proposedItems        : array of structured trade items (see deal-schema.ts).
--                          May be empty/nil (an empty deal still yields the range).
--
-- Returns one table:
--   {
--     items = { { fromPlayerID, toPlayerID, itemType, legal, reason,
--                 valueToGiver, valueToReceiver, unknown? }, ... },
--     range = { [tostring(playerID)] = <side range>, ... }
--   }
-- Legality/reasons are computed with bTreatAsHumanToHuman = true so the preview
-- matches what stage-6 enactment will allow.

local TI = TradeableItems
local DEFAULT_DURATION = Game.GetDealDuration()

-- itemType string -> TradeableItems enum value
local ENUM = {
  GOLD = TI.TRADE_ITEM_GOLD,
  GOLD_PER_TURN = TI.TRADE_ITEM_GOLD_PER_TURN,
  MAPS = TI.TRADE_ITEM_MAPS,
  RESOURCES = TI.TRADE_ITEM_RESOURCES,
  CITIES = TI.TRADE_ITEM_CITIES,
  OPEN_BORDERS = TI.TRADE_ITEM_OPEN_BORDERS,
  DEFENSIVE_PACT = TI.TRADE_ITEM_DEFENSIVE_PACT,
  RESEARCH_AGREEMENT = TI.TRADE_ITEM_RESEARCH_AGREEMENT,
  PEACE_TREATY = TI.TRADE_ITEM_PEACE_TREATY,
  THIRD_PARTY_PEACE = TI.TRADE_ITEM_THIRD_PARTY_PEACE,
  THIRD_PARTY_WAR = TI.TRADE_ITEM_THIRD_PARTY_WAR,
  ALLOW_EMBASSY = TI.TRADE_ITEM_ALLOW_EMBASSY,
  DECLARATION_OF_FRIENDSHIP = TI.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP,
  VOTE_COMMITMENT = TI.TRADE_ITEM_VOTE_COMMITMENT,
  TECHS = TI.TRADE_ITEM_TECHS,
  VASSALAGE = TI.TRADE_ITEM_VASSALAGE,
  VASSALAGE_REVOKE = TI.TRADE_ITEM_VASSALAGE_REVOKE,
}

-- Always pass the human-to-human override at arg position 9, padding the data args.
local function canTrade(deal, giver, receiver, enum, d1, d2, d3, flag1)
  return deal:IsPossibleToTradeItem(giver, receiver, enum, d1 or -1, d2 or -1, d3 or -1, flag1 or false, true)
end

-- For a structured item resolve, for its giver:
--   d1,d2,d3,flag1            -> IsPossibleToTradeItem / GetReasonsItemUntradeable
--   v1,v2,v3,vflag1,vdur      -> GetTradeItemValue (duration is a separate arg there)
--   add(deal)                 -> push the item onto the scratch deal
-- Returns nil for an unrecognized item type.
local function resolveItem(item, giver)
  local t = item.itemType
  local dur = item.duration or DEFAULT_DURATION
  if t == "GOLD" then
    local amt = item.amount or 0
    return amt, -1, -1, false, amt, -1, -1, false, -1,
      function(d) d:AddGoldTrade(giver, amt) end
  elseif t == "GOLD_PER_TURN" then
    local amt = item.amount or 0
    return amt, dur, -1, false, amt, -1, -1, false, dur,
      function(d) d:AddGoldPerTurnTrade(giver, amt, dur) end
  elseif t == "MAPS" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddMapTrade(giver) end
  elseif t == "RESOURCES" then
    local r = item.resourceID or -1
    local q = item.quantity or 0
    return r, q, -1, false, r, q, -1, false, dur,
      function(d) d:AddResourceTrade(giver, r, q, dur) end
  elseif t == "CITIES" then
    local pCity = Players[giver]:GetCityByID(item.cityID or -1)
    local x = pCity and pCity:GetX() or -1
    local y = pCity and pCity:GetY() or -1
    return x, y, -1, false, x, y, -1, false, -1,
      function(d) d:AddCityTrade(giver, item.cityID or -1) end
  elseif t == "OPEN_BORDERS" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddOpenBorders(giver, dur) end
  elseif t == "DEFENSIVE_PACT" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddDefensivePact(giver, dur) end
  elseif t == "RESEARCH_AGREEMENT" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddResearchAgreement(giver, dur) end
  elseif t == "PEACE_TREATY" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddPeaceTreaty(giver, dur) end
  elseif t == "THIRD_PARTY_PEACE" then
    local tm = item.thirdPartyTeamID or -1
    return tm, dur, -1, false, tm, -1, -1, false, -1,
      function(d) d:AddThirdPartyPeace(giver, tm, dur) end
  elseif t == "THIRD_PARTY_WAR" then
    local tm = item.thirdPartyTeamID or -1
    return tm, -1, -1, false, tm, -1, -1, false, -1,
      function(d) d:AddThirdPartyWar(giver, tm) end
  elseif t == "ALLOW_EMBASSY" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddAllowEmbassy(giver) end
  elseif t == "DECLARATION_OF_FRIENDSHIP" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddDeclarationOfFriendship(giver) end
  elseif t == "VOTE_COMMITMENT" then
    local rid = item.resolutionID or -1
    local vc = item.voteChoice or -1
    local nv = item.numVotes or 1
    local rp = item.repeal or false
    return rid, vc, nv, rp, rid, vc, nv, rp, -1,
      function(d) d:AddVoteCommitment(giver, rid, vc, nv, rp) end
  elseif t == "TECHS" then
    local tech = item.techID or -1
    return tech, -1, -1, false, tech, -1, -1, false, -1,
      function(d) d:AddTechTrade(giver, tech) end
  elseif t == "VASSALAGE" then
    return -1, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddVassalageTrade(giver) end
  elseif t == "VASSALAGE_REVOKE" then
    return -1, -1, -1, false, -1, -1, -1, false, -1,
      function(d) d:AddRevokeVassalageTrade(giver) end
  end
  return nil
end

-- Enumerate what `giver` could put on the table for `receiver`, gating each candidate
-- through IsPossibleToTradeItem (human-to-human semantics), exactly as the trade screen
-- filters its lists. Returns identity + legality only; per-item value is computed on
-- demand when the candidate is added as a proposed term.
local function enumerateSide(deal, giver, receiver)
  local pGiver = Players[giver]
  local out = {}

  out.gold = { available = canTrade(deal, giver, receiver, TI.TRADE_ITEM_GOLD, 1), max = pGiver:GetGold() }
  out.goldPerTurn = { available = canTrade(deal, giver, receiver, TI.TRADE_ITEM_GOLD_PER_TURN, 1, DEFAULT_DURATION) }

  out.maps = canTrade(deal, giver, receiver, TI.TRADE_ITEM_MAPS, DEFAULT_DURATION)
  out.openBorders = canTrade(deal, giver, receiver, TI.TRADE_ITEM_OPEN_BORDERS, DEFAULT_DURATION)
  out.defensivePact = canTrade(deal, giver, receiver, TI.TRADE_ITEM_DEFENSIVE_PACT, DEFAULT_DURATION)
  out.researchAgreement = canTrade(deal, giver, receiver, TI.TRADE_ITEM_RESEARCH_AGREEMENT, DEFAULT_DURATION)
  out.peaceTreaty = canTrade(deal, giver, receiver, TI.TRADE_ITEM_PEACE_TREATY, DEFAULT_DURATION)
  out.allowEmbassy = canTrade(deal, giver, receiver, TI.TRADE_ITEM_ALLOW_EMBASSY, DEFAULT_DURATION)
  out.declarationOfFriendship = canTrade(deal, giver, receiver, TI.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP, DEFAULT_DURATION)
  out.vassalage = canTrade(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE)
  out.vassalageRevoke = canTrade(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE_REVOKE)

  -- Resources the giver actually has available to trade
  local resources = {}
  for row in GameInfo.Resources() do
    local rid = row.ID
    local avail = pGiver:GetNumResourceAvailable(rid, false)
    if avail > 0 and canTrade(deal, giver, receiver, TI.TRADE_ITEM_RESOURCES, rid, 1) then
      table.insert(resources, { resourceID = rid, quantityAvailable = avail })
    end
  end
  out.resources = resources

  -- The giver's own tradeable cities
  local cities = {}
  for city in pGiver:Cities() do
    local x, y = city:GetX(), city:GetY()
    if canTrade(deal, giver, receiver, TI.TRADE_ITEM_CITIES, x, y) then
      table.insert(cities, { cityID = city:GetID(), name = city:GetName(), x = x, y = y })
    end
  end
  out.cities = cities

  -- Technologies the giver can hand over (recipient can research and lacks)
  local techs = {}
  for row in GameInfo.Technologies() do
    local tid = row.ID
    if canTrade(deal, giver, receiver, TI.TRADE_ITEM_TECHS, tid) then
      table.insert(techs, { techID = tid })
    end
  end
  out.techs = techs

  -- Third-party peace / war, by team
  local tpPeace, tpWar = {}, {}
  for tid = 0, GameDefines.MAX_CIV_TEAMS - 1 do
    local team = Teams[tid]
    if team and team:IsAlive() then
      if canTrade(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_PEACE, tid, DEFAULT_DURATION) then
        table.insert(tpPeace, { teamID = tid })
      end
      if canTrade(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_WAR, tid) then
        table.insert(tpWar, { teamID = tid })
      end
    end
  end
  out.thirdPartyPeace = tpPeace
  out.thirdPartyWar = tpWar

  -- NOTE: vote-commitment enumeration is intentionally omitted from the range (it
  -- needs live World Congress resolution context the deal screen builds separately).
  -- Vote commitments are still fully supported as explicit proposed terms.

  return out
end

-- City valuation dereferences the map plot, so unresolved city coordinates must never
-- be passed to GetTradeItemValue.
local function hasUnresolvedCityCoordinates(item, resolved)
  return item.itemType == "CITIES" and (resolved.v1 == nil or resolved.v1 < 0 or resolved.v2 == nil or resolved.v2 < 0)
end

local deal = UI.GetScratchDeal()
if deal == nil then
  return { error = "no scratch deal available" }
end

proposedItems = proposedItems or {}

-- Populate the scratch deal first so ordinary terms get the same cross-item context the
-- game uses, then evaluate every term directly with human-to-human legality. Stock
-- Add* helpers can still refuse override-only terms; those terms are inspected, but
-- cannot contribute to scratch context until the enactment path adds override-aware
-- construction.
deal:ClearItems()
deal:SetFromPlayer(playerAID)
deal:SetToPlayer(playerBID)

local resolved = {}
for i, item in ipairs(proposedItems) do
  local giver = item.fromPlayerID
  local d1, d2, d3, f1, v1, v2, v3, vf1, vdur, addfn = resolveItem(item, giver)
  resolved[i] = {
    item = item, giver = giver,
    d1 = d1, d2 = d2, d3 = d3, f1 = f1,
    v1 = v1, v2 = v2, v3 = v3, vf1 = vf1, vdur = vdur,
  }
  if d1 ~= nil and addfn then addfn(deal) end
end

local items = {}
for i, r in ipairs(resolved) do
  local item = r.item
  local giver = r.giver
  local receiver = (giver == playerAID) and playerBID or playerAID
  local enum = ENUM[item.itemType]
  if enum == nil or r.d1 == nil then
    items[i] = {
      fromPlayerID = giver, toPlayerID = receiver, itemType = tostring(item.itemType),
      legal = false, reason = "Unknown item type", valueToGiver = 0, valueToReceiver = 0, unknown = true,
    }
  else
    local unresolvedCity = hasUnresolvedCityCoordinates(item, r)
    local legal = false
    if not unresolvedCity then
      legal = deal:IsPossibleToTradeItem(giver, receiver, enum, r.d1, r.d2, r.d3, r.f1, true)
    end
    local reason = ""
    if unresolvedCity then
      reason = "City ID could not be resolved for the giving player."
    elseif not legal then
      reason = deal:GetReasonsItemUntradeable(giver, receiver, enum, r.d1, r.d2, r.d3, r.f1, true)
    end
    local vGive, vReceive = 0, 0
    if not unresolvedCity then
      vGive, vReceive = deal:GetTradeItemValue(giver, receiver, enum, r.v1, r.v2, r.v3, r.vf1, r.vdur)
    end
    items[i] = {
      fromPlayerID = giver, toPlayerID = receiver, itemType = item.itemType,
      legal = legal, reason = reason or "",
      valueToGiver = vGive, valueToReceiver = vReceive,
    }
  end
end

-- Enumerate the tradable range for each side against an empty deal context (so the
-- proposed items don't pollute it), then leave the scratch deal clean.
deal:ClearItems()
deal:SetFromPlayer(playerAID)
deal:SetToPlayer(playerBID)

local range = {}
range[tostring(playerAID)] = enumerateSide(deal, playerAID, playerBID)
range[tostring(playerBID)] = enumerateSide(deal, playerBID, playerAID)

deal:ClearItems()

return { items = items, range = range }
