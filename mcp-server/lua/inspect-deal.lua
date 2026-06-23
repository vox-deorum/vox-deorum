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
-- The range is enriched so the Web board can read like the in-game trade screen
-- (stage 4): candidates carry game-facing display names, resources carry a category
-- (luxury/strategic/bonus), and every candidate carries its own structural legality +
-- reason so a STRUCTURALLY IMPOSSIBLE candidate stays visible (red) instead of being
-- dropped. The response also carries the game's default deal duration and the list of
-- eligible promise targets (third parties) with their display names and major/minor
-- kind. Numeric IDs are always present as fallbacks when a name cannot be resolved.
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
--     range = { [tostring(playerID)] = <side range>, ... },
--     defaultDuration = <int>,
--     promiseTargets = { { playerID, teamID, name, kind }, ... }
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

-- The in-game trade screen's resource buckets: luxury / strategic / other (bonus).
local function resourceCategory(row)
  local cls = row.ResourceClassType
  if cls == "RESOURCECLASS_LUXURY" then
    return "luxury"
  elseif cls == "RESOURCECLASS_RUSH" or cls == "RESOURCECLASS_MODERN" then
    return "strategic"
  end
  return "bonus"
end

-- Display name for a player: a major civ's short description, or "City-State <name>"
-- for a minor. Returns nil when the player can't be resolved (caller keeps the ID).
local function playerDisplayName(p)
  if p == nil then return nil end
  if p:IsMinorCiv() then return "City-State " .. p:GetName() end
  return p:GetCivilizationShortDescription()
end

-- Map each team to a representative living player, so third-party teams can be named.
local teamRep = {}
for pid = 0, GameDefines.MAX_CIV_PLAYERS - 1 do
  local p = Players[pid]
  if p and p:IsAlive() and not p:IsBarbarian() then
    local tid = p:GetTeam()
    if teamRep[tid] == nil then teamRep[tid] = p end
  end
end
local function teamDisplayName(tid)
  return playerDisplayName(teamRep[tid])
end

-- Always pass the human-to-human override at arg position 9, padding the data args.
local function canTrade(deal, giver, receiver, enum, d1, d2, d3, flag1)
  return deal:IsPossibleToTradeItem(giver, receiver, enum, d1 or -1, d2 or -1, d3 or -1, flag1 or false, true)
end

-- Structural legality + reason for a candidate, under the human-to-human override.
-- The reason is read only when illegal and is returned raw (the TS layer strips tags).
local function legalityOf(deal, giver, receiver, enum, d1, d2, d3, flag1)
  local legal = canTrade(deal, giver, receiver, enum, d1, d2, d3, flag1)
  local reason = ""
  if not legal then
    reason = deal:GetReasonsItemUntradeable(giver, receiver, enum, d1 or -1, d2 or -1, d3 or -1, flag1 or false, true) or ""
  end
  return legal, reason
end

-- A single-shot toggle candidate (open borders, embassy, pacts, …): legality + reason.
local function toggleCandidate(deal, giver, receiver, enum, d1, d2)
  local legal, reason = legalityOf(deal, giver, receiver, enum, d1, d2)
  return { legal = legal, reason = reason }
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

-- Enumerate what `giver` could put on the table for `receiver`. Unlike the in-game
-- screen, structurally impossible candidates are KEPT (flagged with legality + reason)
-- so the Web board can show them red and disabled rather than silently dropping them.
-- Per-item value is computed on demand when a candidate is added as a proposed term.
local function enumerateSide(deal, giver, receiver)
  local pGiver = Players[giver]
  local pReceiver = Players[receiver]
  local giverTeam = Teams[pGiver:GetTeam()]
  local receiverTeam = Teams[pReceiver:GetTeam()]
  local out = {}

  -- Gold / gold-per-turn: legality + reason ride alongside the amount metadata.
  do
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_GOLD, 1)
    out.gold = { available = legal, reason = reason, max = pGiver:GetGold() }
  end
  do
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_GOLD_PER_TURN, 1, DEFAULT_DURATION)
    out.goldPerTurn = { available = legal, reason = reason }
  end

  out.maps = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_MAPS, DEFAULT_DURATION)
  out.openBorders = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_OPEN_BORDERS, DEFAULT_DURATION)
  out.defensivePact = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_DEFENSIVE_PACT, DEFAULT_DURATION)
  out.researchAgreement = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_RESEARCH_AGREEMENT, DEFAULT_DURATION)
  out.peaceTreaty = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_PEACE_TREATY, DEFAULT_DURATION)
  out.allowEmbassy = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_ALLOW_EMBASSY, DEFAULT_DURATION)
  out.declarationOfFriendship = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP, DEFAULT_DURATION)
  out.vassalage = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE)
  out.vassalageRevoke = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE_REVOKE)

  -- Resources the giver actually holds (>0 available). A currently-impossible one
  -- (e.g. a duplicate-luxury import) stays in the list, flagged with its reason.
  local resources = {}
  for row in GameInfo.Resources() do
    local rid = row.ID
    local avail = pGiver:GetNumResourceAvailable(rid, false)
    if avail > 0 then
      local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_RESOURCES, rid, 1)
      table.insert(resources, {
        resourceID = rid,
        name = Locale.ConvertTextKey(row.Description),
        category = resourceCategory(row),
        quantityAvailable = avail,
        legal = legal,
        reason = reason,
      })
    end
  end
  out.resources = resources

  -- The giver's own cities; the capital and sapped/blockaded cities remain visible but flagged.
  local cities = {}
  for city in pGiver:Cities() do
    local x, y = city:GetX(), city:GetY()
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_CITIES, x, y)
    table.insert(cities, { cityID = city:GetID(), name = city:GetName(), x = x, y = y, legal = legal, reason = reason })
  end
  out.cities = cities

  -- Technologies the giver knows and the receiver lacks (the natural candidate set the
  -- in-game screen offers); each carries legality so brokering-blocked techs show red.
  local techs = {}
  for row in GameInfo.Technologies() do
    local tid = row.ID
    if pGiver:HasTech(tid) and not pReceiver:HasTech(tid) then
      local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_TECHS, tid)
      table.insert(techs, { techID = tid, name = Locale.ConvertTextKey(row.Description), legal = legal, reason = reason })
    end
  end
  out.techs = techs

  -- Third-party peace / war over teams BOTH sides have met (the stock screen's set, which
  -- never reveals a civ one party hasn't met). Currently-impossible rows stay, flagged,
  -- instead of being dropped.
  local tpPeace, tpWar = {}, {}
  for tid = 0, GameDefines.MAX_CIV_TEAMS - 1 do
    local team = Teams[tid]
    if team and team:IsAlive()
        and tid ~= pGiver:GetTeam() and tid ~= pReceiver:GetTeam()
        and giverTeam:IsHasMet(tid) and receiverTeam:IsHasMet(tid) then
      local pLegal, pReason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_PEACE, tid, DEFAULT_DURATION)
      local wLegal, wReason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_WAR, tid)
      local name = teamDisplayName(tid)
      table.insert(tpPeace, { teamID = tid, name = name, legal = pLegal, reason = pReason })
      table.insert(tpWar, { teamID = tid, name = name, legal = wLegal, reason = wReason })
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

-- Eligible promise targets: every other living civ (third parties), with display name,
-- major/minor kind, and structural eligibility for the targeted promises so the board can
-- offer only valid targets (using the game's own checks rather than reimplemented logic):
--   * Coop War (major target): BOTH principals must have a valid coop-war target.
--   * Bully/Attack City-State (minor target): the RECIPIENT must protect the minor.

-- Whether a coop war between the two principals against targetID is structurally valid,
-- mirroring CanRequestCoopWar's request-phase check (bAtWarException = false) for EACH
-- principal but WITHOUT its Declaration-of-Friendship prerequisite (bypassed on the agent
-- path). It DOES keep CanRequestCoopWar's other structural guard — a coop war already
-- PREPARING between the two against this target is not a fresh, proposable target (the
-- ONGOING case is already excluded by IsValidCoopWarTarget, since both are then at war).
-- pcall-guarded: a DLL build without IsValidCoopWarTarget yields nil (field omitted) rather
-- than erroring, so inspection degrades gracefully until the new binding ships.
local function coopWarEligible(targetID)
  local okA, a = pcall(function() return Players[playerAID]:IsValidCoopWarTarget(targetID, false) end)
  local okB, b = pcall(function() return Players[playerBID]:IsValidCoopWarTarget(targetID, false) end)
  if not okA or not okB then return nil end
  if not (a and b) then return false end
  local preparing = CoopWarStates.COOP_WAR_STATE_PREPARING
  if Players[playerAID]:GetCoopWarAcceptedState(playerBID, targetID) == preparing
      or Players[playerBID]:GetCoopWarAcceptedState(playerAID, targetID) == preparing then
    return false
  end
  return true
end

-- Which of the two principals currently protect minorID, i.e. valid recipients of a
-- "stop bullying / don't attack my protected city-state" promise targeting it.
local function protectingPrincipals(minorID)
  local out = {}
  if Players[playerAID]:IsProtectingMinor(minorID) then table.insert(out, playerAID) end
  if Players[playerBID]:IsProtectingMinor(minorID) then table.insert(out, playerBID) end
  return out
end

-- Only expose a third party BOTH principals have met, so a target's name never leaks a
-- civ one side hasn't discovered (same rule the trade third-party lists use above).
local aTeam = Teams[Players[playerAID]:GetTeam()]
local bTeam = Teams[Players[playerBID]:GetTeam()]

local promiseTargets = {}
for pid = 0, GameDefines.MAX_CIV_PLAYERS - 1 do
  if pid ~= playerAID and pid ~= playerBID then
    local p = Players[pid]
    if p and p:IsAlive() and not p:IsBarbarian() then
      local tTeam = p:GetTeam()
      if aTeam:IsHasMet(tTeam) and bTeam:IsHasMet(tTeam) then
        local isMinor = p:IsMinorCiv()
        local entry = {
          playerID = pid,
          teamID = tTeam,
          name = playerDisplayName(p),
          kind = isMinor and "minor" or "major",
        }
        if isMinor then
          -- Omit when neither principal protects it: an empty array is ambiguous over the
          -- Lua/JSON boundary, and absence reads the same to the UI's optional-chained filter.
          local protectors = protectingPrincipals(pid)
          if #protectors > 0 then entry.protectingPlayerIDs = protectors end
        else
          entry.coopWarEligible = coopWarEligible(pid)
        end
        table.insert(promiseTargets, entry)
      end
    end
  end
end

return { items = items, range = range, defaultDuration = DEFAULT_DURATION, promiseTargets = promiseTargets }
