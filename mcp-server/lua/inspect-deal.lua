-- Inspect (or, opt-in, ENACT) a (possibly empty) proposed deal between two major civs.
--
-- Builds a TRANSIENT scratch deal (UI.GetScratchDeal, exactly as the in-game trade
-- screen does), reads back per-term legality + reasons + both-direction AI value for
-- the proposed items, and enumerates the full tradable range each side could put on
-- the table. Per-term legality/reasons use the human-to-human override directly;
-- scratch-deal context is best-effort for terms the stock Add* helpers accept.
--
-- Two modes, chosen by the optional `enact` argument (the same defaulted-parameter
-- philosophy as the DLL overrides):
--   * READ-ONLY (enact absent): the scratch deal is NEVER activated and is cleared on
--     the way out, so this leaves no trace on game state (specs.md §4). The range is
--     enriched so the Web board can read like the in-game trade screen (stage 4):
--     candidates carry game-facing display names, resources carry a category
--     (luxury/strategic/bonus), and every candidate carries its own structural
--     legality + reason so a STRUCTURALLY IMPOSSIBLE candidate stays visible (red)
--     instead of being dropped. The response also carries the game's default deal
--     duration and the list of eligible promise targets (third parties). Numeric IDs
--     are always present as fallbacks when a name cannot be resolved.
--   * ENACT (enact present): the whole validate-then-write sequence runs in this ONE
--     atomic invocation (validation cannot go stale between check and act). Trade items
--     are built with the human-to-human override and every item and promise is validated
--     BEFORE any write; on refusal nothing is written. The trade items are enacted first
--     via Deal:Enact (the fallible step); if that fails, nothing else is written. Only on
--     a successful enactment are the promises applied via Player:SetPromise (best-effort,
--     no rollback, since structural validity is vetted up front). The range/promiseTargets
--     enumeration is skipped. (stage 6, the only gameplay write.)
--
-- Args:
--   playerAID, playerBID : the two major-civ player IDs
--   proposedItems        : array of structured trade items (see deal-schema.ts).
--                          May be empty/nil (an empty deal still yields the range).
--   enact                : OPTIONAL. Absent → read-only. Present (e.g. { promises = {...} })
--                          → enact mode; carries the deal's promise commitments
--                          ({ promiserID, recipientID, promiseType, targetPlayerID? }).
--
-- Returns (read-only) one table:
--   {
--     items = { { fromPlayerID, toPlayerID, itemType, legal, reason,
--                 valueToGiver, valueToReceiver, unknown? }, ... },
--     range = { [tostring(playerID)] = <side range>, ... },
--     defaultDuration = <int>,        -- standard deal duration (Game.GetDealDuration)
--     peaceDuration = <int>,          -- peace-deal duration (Game.GetPeaceDuration)
--     relationshipDuration = <int>,   -- DoF/denounce duration (Game.GetRelationshipDuration)
--     promiseTargets = { { playerID, teamID, name, kind }, ... }
--   }
-- Returns (enact mode) one table:
--   { enacted = <bool>, reasons = { <string>, ... }, items = <per-item legality> }
--   (reasons is present/non-empty only on refusal or a failed enactment).
-- Legality/reasons are computed with bTreatAsHumanToHuman = true so the read-only
-- preview matches exactly what enactment will allow.

local TI = TradeableItems
local DEFAULT_DURATION = Game.GetDealDuration()
-- Peace items (peace treaty / third-party peace) run for the game-speed peace-deal duration, and a
-- Declaration of Friendship lasts the relationship duration — both distinct from the standard deal
-- duration. CvGame exposes a direct accessor for each (GetPeaceDuration == getPeaceDealDuration;
-- GetRelationshipDuration == getRelationshipDuration).
local PEACE_DURATION = Game.GetPeaceDuration()
local RELATIONSHIP_DURATION = Game.GetRelationshipDuration()

-- Promise durations (turns). Only the promises the tactical AI actually honors are offered, and the
-- three standing ones expose a direct CvGame accessor (Military is flat; Expansion/Border scale by
-- game speed). Coop War's preparation countdown (COOP_WAR_SOON_COUNTER) has no accessor, so it is
-- read off the GameDefines table. Each is guarded so a DLL build lacking an accessor degrades to nil
-- (field omitted) rather than erroring.
local function safeDuration(fn)
  local ok, v = pcall(fn)
  if ok and type(v) == "number" then return v end
  return nil
end
local MILITARY_PROMISE_DURATION = safeDuration(function() return Game.GetMilitaryPromiseDuration() end)
local EXPANSION_PROMISE_DURATION = safeDuration(function() return Game.GetExpansionPromiseDuration() end)
local BORDER_PROMISE_DURATION = safeDuration(function() return Game.GetBorderPromiseDuration() end)
local COOP_WAR_PROMISE_DURATION = GameDefines and GameDefines.COOP_WAR_SOON_COUNTER or nil

-- Categories the current ruleset forbids ENTIRELY. These are hidden from the range (omitted),
-- not shown red, so the Web board and the negotiator both match the in-game trade screen, which
-- hides the whole pocket rather than disabling it. The conditions mirror VP-EUI TradeLogic.lua
-- (g_bAllowResearchAgreements / g_bDisableScience / g_bDisableTechTrading / g_bDisableVassalage).
local RA_ALLOWED        = (not Game.IsOption("GAMEOPTION_DISABLE_RESEARCH_AGREEMENTS"))
                          and (not Game.IsOption("GAMEOPTION_NO_SCIENCE"))
local TECH_ALLOWED      = Game.IsOption("GAMEOPTION_ENABLE_TECH_TRADING")
                          and (not Game.IsOption("GAMEOPTION_NO_SCIENCE"))
local VASSALAGE_ALLOWED = Game.IsOption("GAMEOPTION_ENABLE_VASSALAGE")

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
  -- pcall-guarded (like valueOf) so a term the stock checks throw on degrades to illegal with an
  -- empty reason (the TS layer supplies a structured fallback) rather than aborting the whole call.
  local ok, legal, reason = pcall(function()
    local isLegal = canTrade(deal, giver, receiver, enum, d1, d2, d3, flag1)
    local why = ""
    if not isLegal then
      why = deal:GetReasonsItemUntradeable(giver, receiver, enum, d1 or -1, d2 or -1, d3 or -1, flag1 or false, true) or ""
    end
    return isLegal, why
  end)
  if not ok then return false, "" end
  return legal, reason
end

-- Advisory both-direction value for a candidate (what the giver loses parting with it / what the
-- receiver gains taking it), via the same GetTradeItemValue the proposed-item path uses below. The
-- value args differ per item type (see resolveItem's v1..vdur); callers pass the matching ones.
-- pcall-guarded so a candidate the stock valuation refuses degrades to 0,0 rather than erroring.
local function valueOf(deal, giver, receiver, enum, v1, v2, v3, vf1, vdur)
  local ok, vGive, vReceive = pcall(function()
    return deal:GetTradeItemValue(giver, receiver, enum, v1 or -1, v2 or -1, v3 or -1, vf1 or false, vdur or -1)
  end)
  if not ok then return 0, 0 end
  return vGive or 0, vReceive or 0
end

-- A single-shot toggle candidate (open borders, embassy, pacts, …): legality + reason + advisory value.
-- `vdur` is the fixed game duration the term runs for (open borders / pacts / DoF / peace); pass it so
-- the advisory value is computed over the same horizon the term is actually offered at, matching the
-- proposed-item valuation. Non-duration toggles (maps, embassy, vassalage) pass nil (valued at -1).
local function toggleCandidate(deal, giver, receiver, enum, d1, d2, vdur)
  local legal, reason = legalityOf(deal, giver, receiver, enum, d1, d2)
  local vGive, vReceive = valueOf(deal, giver, receiver, enum, -1, -1, -1, false, vdur)
  return { legal = legal, reason = reason, valueToGiver = vGive, valueToReceiver = vReceive }
end

-- The fixed game duration for an item type. Durations are read-only game constants, never author-set:
-- any authored `duration` is IGNORED so legality/value are evaluated at the same length the deal is
-- stored and displayed at (mirrors durationForItemType in deal-schema.ts). Peace items run the
-- peace-deal duration; a Declaration of Friendship the relationship duration; everything else (incl.
-- the items whose duration arg the DLL ignores) the standard deal duration.
local function durationFor(itemType)
  if itemType == "PEACE_TREATY" or itemType == "THIRD_PARTY_PEACE" then
    return PEACE_DURATION
  elseif itemType == "DECLARATION_OF_FRIENDSHIP" then
    return RELATIONSHIP_DURATION
  end
  return DEFAULT_DURATION
end

-- For a structured item resolve, for its giver:
--   d1,d2,d3,flag1            -> IsPossibleToTradeItem / GetReasonsItemUntradeable
--   v1,v2,v3,vflag1,vdur      -> GetTradeItemValue (duration is a separate arg there)
--   add(deal, h2h)            -> push the item onto the scratch deal. h2h is the human-to-human
--                               override forwarded to the Add* constructor's internal guard: the
--                               enact path passes true so override-only items (e.g. two cities from
--                               one side) are actually added; read-only inspection passes false/nil,
--                               preserving stock scratch-deal context exactly.
-- Returns nil for an unrecognized item type.
local function resolveItem(item, giver)
  local t = item.itemType
  local dur = durationFor(t)
  if t == "GOLD" then
    local amt = item.amount or 0
    return amt, -1, -1, false, amt, -1, -1, false, -1,
      function(d, h2h) d:AddGoldTrade(giver, amt, h2h) end
  elseif t == "GOLD_PER_TURN" then
    local amt = item.amount or 0
    return amt, dur, -1, false, amt, -1, -1, false, dur,
      function(d, h2h) d:AddGoldPerTurnTrade(giver, amt, dur, h2h) end
  elseif t == "MAPS" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddMapTrade(giver, h2h) end
  elseif t == "RESOURCES" then
    local r = item.resourceID or -1
    local q = item.quantity or 0
    return r, q, -1, false, r, q, -1, false, dur,
      function(d, h2h) d:AddResourceTrade(giver, r, q, dur, h2h) end
  elseif t == "CITIES" then
    local pCity = Players[giver]:GetCityByID(item.cityID or -1)
    local x = pCity and pCity:GetX() or -1
    local y = pCity and pCity:GetY() or -1
    return x, y, -1, false, x, y, -1, false, -1,
      function(d, h2h) d:AddCityTrade(giver, item.cityID or -1, h2h) end
  elseif t == "OPEN_BORDERS" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddOpenBorders(giver, dur, h2h) end
  elseif t == "DEFENSIVE_PACT" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddDefensivePact(giver, dur, h2h) end
  elseif t == "RESEARCH_AGREEMENT" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddResearchAgreement(giver, dur, h2h) end
  elseif t == "PEACE_TREATY" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddPeaceTreaty(giver, dur, h2h) end
  elseif t == "THIRD_PARTY_PEACE" then
    local tm = item.thirdPartyTeamID or -1
    return tm, dur, -1, false, tm, -1, -1, false, -1,
      function(d, h2h) d:AddThirdPartyPeace(giver, tm, dur, h2h) end
  elseif t == "THIRD_PARTY_WAR" then
    local tm = item.thirdPartyTeamID or -1
    return tm, -1, -1, false, tm, -1, -1, false, -1,
      function(d, h2h) d:AddThirdPartyWar(giver, tm, h2h) end
  elseif t == "ALLOW_EMBASSY" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddAllowEmbassy(giver, h2h) end
  elseif t == "DECLARATION_OF_FRIENDSHIP" then
    return dur, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddDeclarationOfFriendship(giver, h2h) end
  elseif t == "VOTE_COMMITMENT" then
    local rid = item.resolutionID or -1
    local vc = item.voteChoice or -1
    local nv = item.numVotes or 1
    local rp = item.repeal or false
    return rid, vc, nv, rp, rid, vc, nv, rp, -1,
      function(d, h2h) d:AddVoteCommitment(giver, rid, vc, nv, rp, h2h) end
  elseif t == "TECHS" then
    local tech = item.techID or -1
    return tech, -1, -1, false, tech, -1, -1, false, -1,
      function(d, h2h) d:AddTechTrade(giver, tech, h2h) end
  elseif t == "VASSALAGE" then
    return -1, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddVassalageTrade(giver, h2h) end
  elseif t == "VASSALAGE_REVOKE" then
    return -1, -1, -1, false, -1, -1, -1, false, -1,
      function(d, h2h) d:AddRevokeVassalageTrade(giver, h2h) end
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

  -- The giver's net income per turn (CalculateGoldRate), surfaced so the menu can show how much
  -- gold-per-turn the side can sustainably commit (mirrors get-player-summary.lua).
  out.netGoldPerTurn = pGiver:CalculateGoldRate()

  -- Gold / gold-per-turn: legality + reason ride alongside the amount metadata.
  do
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_GOLD, 1)
    out.gold = { available = legal, reason = reason, max = pGiver:GetGold() }
  end
  do
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_GOLD_PER_TURN, 1, DEFAULT_DURATION)
    out.goldPerTurn = { available = legal, reason = reason }
  end

  -- The third arg after the enum is the legality duration; the trailing arg is the VALUE duration so
  -- advisory values are computed over each term's fixed game horizon (durationFor): open borders /
  -- defensive pact / research agreement run the deal duration, peace the peace duration, a Declaration
  -- of Friendship the relationship duration. Maps / embassy / vassalage carry no duration (nil).
  out.maps = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_MAPS, DEFAULT_DURATION)
  out.openBorders = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_OPEN_BORDERS, DEFAULT_DURATION, nil, DEFAULT_DURATION)
  out.defensivePact = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_DEFENSIVE_PACT, DEFAULT_DURATION, nil, DEFAULT_DURATION)
  out.peaceTreaty = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_PEACE_TREATY, DEFAULT_DURATION, nil, PEACE_DURATION)
  out.allowEmbassy = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_ALLOW_EMBASSY, DEFAULT_DURATION)
  out.declarationOfFriendship = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP, DEFAULT_DURATION, nil, RELATIONSHIP_DURATION)
  -- Research agreement / vassalage are ruleset-gated: omit entirely (hidden, not red) when the
  -- game option forbids them, so the field is simply absent over the bridge.
  if RA_ALLOWED then
    out.researchAgreement = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_RESEARCH_AGREEMENT, DEFAULT_DURATION, nil, DEFAULT_DURATION)
  end
  if VASSALAGE_ALLOWED then
    out.vassalage = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE)
    out.vassalageRevoke = toggleCandidate(deal, giver, receiver, TI.TRADE_ITEM_VASSALAGE_REVOKE)
  end

  -- Resources the giver actually holds (>0 available). A currently-impossible one
  -- (e.g. a duplicate-luxury import) stays in the list, flagged with its reason. Bonus
  -- resources (ResourceUsage 0) are NEVER tradeable, so they are hidden entirely — only
  -- strategic (1) and luxury (2) are enumerated, matching the in-game trade screen.
  local resources = {}
  for row in GameInfo.Resources() do
    local rid = row.ID
    local avail = pGiver:GetNumResourceAvailable(rid, false)
    if avail > 0 and (row.ResourceUsage == 1 or row.ResourceUsage == 2) then
      local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_RESOURCES, rid, 1)
      -- Value a single unit per turn (quantity 1), the menu's default offer quantity.
      local vGive, vReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_RESOURCES, rid, 1, -1, false, DEFAULT_DURATION)
      table.insert(resources, {
        resourceID = rid,
        name = Locale.ConvertTextKey(row.Description),
        category = resourceCategory(row),
        quantityAvailable = avail,
        legal = legal,
        reason = reason,
        valueToGiver = vGive,
        valueToReceiver = vReceive,
      })
    end
  end
  out.resources = resources

  -- The giver's own cities; the capital and sapped/blockaded cities remain visible but flagged.
  local cities = {}
  for city in pGiver:Cities() do
    local x, y = city:GetX(), city:GetY()
    local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_CITIES, x, y)
    -- City valuation dereferences the plot, so only value when the coordinates resolved.
    local vGive, vReceive = 0, 0
    if x >= 0 and y >= 0 then
      vGive, vReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_CITIES, x, y)
    end
    table.insert(cities, {
      cityID = city:GetID(), name = city:GetName(), x = x, y = y, legal = legal, reason = reason,
      population = city:GetPopulation(),
      hitPoints = city:GetMaxHitPoints() - city:GetDamage(),
      maxHitPoints = city:GetMaxHitPoints(),
      valueToGiver = vGive, valueToReceiver = vReceive,
    })
  end
  out.cities = cities

  -- Technologies the giver knows and the receiver lacks (the natural candidate set the
  -- in-game screen offers); each carries legality so brokering-blocked techs show red. Tech
  -- trading is ruleset-gated: when the option forbids it, the whole pocket is hidden (empty
  -- list) rather than shown red, matching the in-game screen. (Per-tech brokering blocks are a
  -- pairing rule and still surface as red legality when tech trading is allowed.)
  local techs = {}
  if TECH_ALLOWED then
    for row in GameInfo.Technologies() do
      local tid = row.ID
      if pGiver:HasTech(tid) and not pReceiver:HasTech(tid) then
        local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_TECHS, tid)
        local vGive, vReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_TECHS, tid)
        table.insert(techs, {
          techID = tid, name = Locale.ConvertTextKey(row.Description), legal = legal, reason = reason,
          valueToGiver = vGive, valueToReceiver = vReceive,
        })
      end
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
      local pvGive, pvReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_PEACE, tid)
      local wvGive, wvReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_THIRD_PARTY_WAR, tid)
      local name = teamDisplayName(tid)
      table.insert(tpPeace, { teamID = tid, name = name, legal = pLegal, reason = pReason, valueToGiver = pvGive, valueToReceiver = pvReceive })
      table.insert(tpWar, { teamID = tid, name = name, legal = wLegal, reason = wReason, valueToGiver = wvGive, valueToReceiver = wvReceive })
    end
  end
  out.thirdPartyPeace = tpPeace
  out.thirdPartyWar = tpWar

  -- World Congress vote commitments the giver could put on the table, enumerated exactly as
  -- the in-game trade screen does (TradeLogic.lua's UpdateLeagueVotes / RefreshPocketVotes):
  -- every in-session enact/repeal proposal expands into its voter choices. The committed vote
  -- count is the DLL's own GetPotentialVotesForMember(receiver, giver) — the giver's REMAINING
  -- starting votes (after existing commitments), adjusted by the receiver's diplomat presence —
  -- NOT simply all the giver's votes. pcall-guarded so a DLL build without the League bindings
  -- (or no active league) degrades to an empty list rather than erroring.
  local voteCommitments = {}
  pcall(function()
    if Game.GetNumActiveLeagues() <= 0 then return end
    local pLeague = Game.GetActiveLeague()
    if pLeague == nil then return end
    local numVotes = pLeague:GetPotentialVotesForMember(receiver, giver)

    -- One proposal expands into one entry per voter choice (its display name + that choice's
    -- text), each with the giver's vote count and its own structural legality.
    local function addProposal(t, decision, repeal, prefix)
      local baseName = pLeague:GetResolutionName(t.Type, t.ID, t.ProposerDecision, false) or ""
      for _, choice in ipairs(pLeague:GetChoicesForDecision(decision)) do
        local choiceText = pLeague:GetTextForChoice(decision, choice) or ""
        local name = prefix .. baseName
        if choiceText ~= "" then name = name .. ", " .. choiceText end
        local legal, reason = legalityOf(deal, giver, receiver, TI.TRADE_ITEM_VOTE_COMMITMENT, t.ID, choice, numVotes, repeal)
        local vGive, vReceive = valueOf(deal, giver, receiver, TI.TRADE_ITEM_VOTE_COMMITMENT, t.ID, choice, numVotes, repeal)
        table.insert(voteCommitments, {
          resolutionID = t.ID, voteChoice = choice, numVotes = numVotes,
          repeal = repeal, name = name, legal = legal, reason = reason,
          valueToGiver = vGive, valueToReceiver = vReceive,
        })
      end
    end

    -- Enact proposals: voter decision comes from each resolution's own definition.
    for _, t in ipairs(pLeague:GetEnactProposals()) do
      local decision = GameInfo.ResolutionDecisions[GameInfo.Resolutions[t.Type].VoterDecision].ID
      addProposal(t, decision, false, "")
    end
    -- Repeal proposals: always the shared "repeal" decision.
    local repealDecision = GameInfo.ResolutionDecisions["RESOLUTION_DECISION_REPEAL"].ID
    for _, t in ipairs(pLeague:GetRepealProposals()) do
      addProposal(t, repealDecision, true, "Repeal: ")
    end
  end)
  out.voteCommitments = voteCommitments

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

-- Enact mode is opt-in: the optional `enact` argument (absent in read-only inspection) carries the
-- deal's promise commitments and switches this invocation from "report legality/range" to "validate
-- everything, then write it for real". It is one atomic bridge invocation, so validation cannot go
-- stale between check and act. Everything before the first write is validation; there is NO rollback
-- (structural validity is fully vetted up front via the exposed reads), so a term a setter later
-- declines silently is simply left unenforced (see runEnact below).
local enactMode = (enact ~= nil)

-- Whether a coop war between the two deal principals against targetID is structurally valid (both
-- pass IsValidCoopWarTarget without the Declaration-of-Friendship prerequisite, and none is already
-- PREPARING between them against it). Returns nil when the IsValidCoopWarTarget binding is absent, so
-- inspection degrades gracefully. Defined here (not only for the range enumeration) so the enact
-- branch can reuse it for coop-war terms.
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

-- Enact mode (stage 6, the only gameplay write): validate every trade item and promise up front, then
-- write. On any structural problem nothing is written and { enacted = false, reasons } is returned.
-- The ordering is failure-safe: the trade items are enacted FIRST via Deal:Enact (the fallible step),
-- and only if that succeeds are the promises applied via Player:SetPromise. That way a refused or
-- failed enactment leaves game state untouched, and the no-rollback promise writes never outlive a
-- deal that did not go through. `resolved`/`items` are the per-item resolution/legality the caller has
-- already computed; the range/promiseTargets enumeration is skipped in this mode.
local function runEnact(resolved, items)
  local reasons = {}

  -- (a) Validate the ordinary trade items. Each must be structurally legal under the human-to-human
  --     override AND have actually joined the scratch deal (a silent constructor refusal means the
  --     deal we would Enact is incomplete). Unknown types and unresolved cities surface here too.
  for i, r in ipairs(resolved) do
    local it = items[i]
    local label = "Item " .. i .. " (" .. tostring(r.item.itemType) .. ")"
    if it.unknown then
      table.insert(reasons, label .. ": unknown item type")
    elseif not it.legal then
      table.insert(reasons, label .. ": " .. (it.reason ~= "" and it.reason or "not tradeable"))
    elseif not r.added then
      table.insert(reasons, label .. ": could not be added to the deal")
    end
  end

  -- (b) Validate the promise commitments and collect the ones to apply. A promise's two sides must be
  --     the two deal principals (distinct living majors). Coop-War twins (the two symmetrized
  --     directions of one joint war against the same target) are deduped to a single application.
  local function livingMajor(pid)
    local p = Players[pid]
    return p ~= nil and p:IsAlive() and not p:IsMinorCiv() and not p:IsBarbarian()
  end
  local standingApplies, coopApplies = {}, {}
  local seenCoop = {}
  for _, pr in ipairs(enact.promises or {}) do
    local kind = pr.promiseType
    local giver = pr.promiserID
    local recv = pr.recipientID
    local label = "Promise " .. tostring(kind)
    local principalsOk = livingMajor(giver) and livingMajor(recv)
      and ((giver == playerAID and recv == playerBID) or (giver == playerBID and recv == playerAID))
    if not principalsOk then
      table.insert(reasons, label .. ": promiser and recipient must be the two deal parties (distinct living majors)")
    elseif kind == "COOP_WAR" then
      local target = pr.targetPlayerID
      local key = tostring(target)
      if not seenCoop[key] then
        seenCoop[key] = true
        local elig = coopWarEligible(target)
        if elig == nil then
          table.insert(reasons, label .. ": cooperative-war eligibility unavailable")
        elseif not elig then
          table.insert(reasons, label .. ": not a valid cooperative-war target (" .. tostring(target) .. ")")
        else
          table.insert(coopApplies, pr)
        end
      end
      -- a duplicate twin is silently dropped (already represented by the first)
    else
      -- Not-already-made check via the exposed reads, where the game exposes one (they return -1 when
      -- the state is not MADE). Kinds without a made-read (No-Digging and the dormant kinds) are
      -- re-applied idempotently, a harmless no-op when the promise already exists.
      local alreadyMade = false
      if kind == "MILITARY" then
        alreadyMade = Players[recv]:GetNumTurnsMilitaryPromise(giver) >= 0
      elseif kind == "EXPANSION" then
        alreadyMade = Players[recv]:GetNumTurnsExpansionPromise(giver) >= 0
      elseif kind == "BORDER" then
        alreadyMade = Players[recv]:GetNumTurnsBorderPromise(giver) >= 0
      end
      if alreadyMade then
        table.insert(reasons, label .. ": already in effect for this pair")
      else
        table.insert(standingApplies, pr)
      end
    end
  end

  -- Refuse before any write if anything is structurally invalid: nothing has touched game state yet
  -- (only the transient scratch deal, cleared here).
  if #reasons > 0 then
    deal:ClearItems()
    return { enacted = false, reasons = reasons, items = items }
  end

  -- (c) Enact the trade items FIRST, the fallible and irreversible step. Their legality was checked in
  --     this same invocation so a false return is not expected, but if it does fail we refuse here,
  --     BEFORE applying any promise, so a failed enactment leaves game state untouched. Deal:Enact
  --     takes a copy of the deal, so the scratch deal is cleared right after.
  local ok = deal:Enact()
  deal:ClearItems()
  if not ok then
    return { enacted = false, reasons = { "The deal's trade items could not be enacted." }, items = items }
  end

  -- The trade items are enacted; now apply the promises, standing ones first and the side-effect-heavy
  -- Coop War last. Fire-and-forget: SetPromise returns nothing, so a setter that silently declines
  -- leaves that one term unenforced (accepted, since validity was vetted above and there is no rollback).
  for _, pr in ipairs(standingApplies) do
    Players[pr.recipientID]:SetPromise(pr.promiserID, pr.promiseType, pr.targetPlayerID or -1, true)
  end
  for _, pr in ipairs(coopApplies) do
    Players[pr.recipientID]:SetPromise(pr.promiserID, pr.promiseType, pr.targetPlayerID, true)
  end

  return { enacted = true, items = items }
end

-- Populate the scratch deal first so ordinary terms get the same cross-item context the game uses,
-- then evaluate every term directly with human-to-human legality. Read-only inspection uses stock
-- Add* (override off), so an override-only term is inspected but does not join the scratch context;
-- enact mode passes the override so it is actually added, and records the GetNumItems delta (`added`)
-- to catch a silent constructor refusal the legality read alone would miss.
deal:ClearItems()
deal:SetFromPlayer(playerAID)
deal:SetToPlayer(playerBID)

local resolved = {}
for i, item in ipairs(proposedItems) do
  local giver = item.fromPlayerID
  local d1, d2, d3, f1, v1, v2, v3, vf1, vdur, addfn = resolveItem(item, giver)
  local before = deal:GetNumItems()
  if d1 ~= nil and addfn then addfn(deal, enactMode) end
  resolved[i] = {
    item = item, giver = giver,
    d1 = d1, d2 = d2, d3 = d3, f1 = f1,
    v1 = v1, v2 = v2, v3 = v3, vf1 = vf1, vdur = vdur,
    added = (deal:GetNumItems() > before),
  }
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
    -- Route through the shared legalityOf/valueOf helpers (both pcall-guarded) so one pathological
    -- term degrades to illegal/0 instead of erroring the whole bridge call, mirroring enumeration.
    local legal, reason, vGive, vReceive
    if hasUnresolvedCityCoordinates(item, r) then
      legal, reason, vGive, vReceive = false, "City ID could not be resolved for the giving player.", 0, 0
    else
      legal, reason = legalityOf(deal, giver, receiver, enum, r.d1, r.d2, r.d3, r.f1)
      vGive, vReceive = valueOf(deal, giver, receiver, enum, r.v1, r.v2, r.v3, r.vf1, r.vdur)
    end
    items[i] = {
      fromPlayerID = giver, toPlayerID = receiver, itemType = item.itemType,
      legal = legal, reason = reason or "",
      valueToGiver = vGive, valueToReceiver = vReceive,
    }
  end
end

-- Enact mode short-circuits here: validate, write, and return without enumerating the range.
if enactMode then
  return runEnact(resolved, items)
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

-- Eligible promise targets: every other living MAJOR civ (third parties), with display name and
-- structural Coop-War eligibility (via coopWarEligible above), so the board offers only valid coop-war
-- targets, using the game's own checks rather than reimplemented logic: BOTH principals must have a
-- valid coop-war target, and no coop war may already be PREPARING between them against it. City-state
-- (minor) promise targets are intentionally NOT reported: the tactical AI does not honor the
-- Bully/Attack-City-State promises, so they are not offered (see ledger-resolver LEDGER_TERMS).

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
      -- Majors only — city-state (minor) promise targets are not reported (see note above).
      if aTeam:IsHasMet(tTeam) and bTeam:IsHasMet(tTeam) and not p:IsMinorCiv() then
        table.insert(promiseTargets, {
          playerID = pid,
          teamID = tTeam,
          name = playerDisplayName(p),
          kind = "major",
          coopWarEligible = coopWarEligible(pid),
        })
      end
    end
  end
end

return {
  items = items,
  range = range,
  defaultDuration = DEFAULT_DURATION,
  peaceDuration = PEACE_DURATION,
  relationshipDuration = RELATIONSHIP_DURATION,
  militaryPromiseDuration = MILITARY_PROMISE_DURATION,
  expansionPromiseDuration = EXPANSION_PROMISE_DURATION,
  borderPromiseDuration = BORDER_PROMISE_DURATION,
  coopWarPromiseDuration = COOP_WAR_PROMISE_DURATION,
  promiseTargets = promiseTargets,
}
