include("CityStateStatusHelper")

-- Extract player summary information from the game
-- Returns summary data with relative visibility between all players

-- Helper function to get civilization name with city-state prefix if applicable
local function getCivName(player)
  local civName = player:GetCivilizationShortDescription()
  if player:IsMinorCiv() then
    return "City-State " .. civName
  end
  return civName
end

-- Helper function to convert proximity value to readable string
local function getProximityString(proximityValue)
  if proximityValue == 0 then
    return "Distant"
  elseif proximityValue == 1 then
    return "Far"
  elseif proximityValue == 2 then
    return "Close"
  elseif proximityValue == 3 then
    return "Neighbors"
  else
    return "Unknown"
  end
end

-- Helper function to determine spy role
local function getSpyRole(spy, playerID)
  if spy.IsDiplomat then
    if spy.VassalDiplomatPlayer >= 0 then
      return "Vassal Diplomat"
    else
      return "Diplomat"
    end
  end

  -- Check if spy is in own city (counterspy)
  if spy.CityX and spy.CityY and spy.CityX >= 0 and spy.CityY >= 0 then
    local plot = Map.GetPlot(spy.CityX, spy.CityY)
    if plot then
      local city = plot:GetPlotCity()
      if city and city:GetOwner() == playerID then
        return "Counterspy"
      end
    end
  end

  return "Spy"
end

-- Helper function to calculate visibility between two players
local function getVisibility(fromPlayerID, toPlayerID)
  if fromPlayerID == toPlayerID then
    return 2  -- Self
  end

  local fromPlayer = Players[fromPlayerID]
  local toPlayer = Players[toPlayerID]

  if not fromPlayer or not toPlayer then
    return 0
  end

  local fromTeamID = fromPlayer:GetTeam()
  local toTeamID = toPlayer:GetTeam()

  if fromTeamID == toTeamID then
    return 2  -- Team member
  elseif Teams[fromTeamID]:IsHasMet(toTeamID) then
    return 1  -- Met
  else
    return 0  -- Not met
  end
end

-- Helper function to format a single deal item as a readable string
local function formatDealItem(itemType, data1, data2, data3, flag1, fromPlayer, toPlayer)
  if itemType == TradeableItems.TRADE_ITEM_GOLD then
    return string.format("%d Gold", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_GOLD_PER_TURN then
    return string.format("%d Gold per Turn", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_MAPS then
    return "World Map"

  elseif itemType == TradeableItems.TRADE_ITEM_RESOURCES then
    local resource = GameInfo.Resources[data1]
    if resource then
      local resourceName = Locale.ConvertTextKey(resource.Description)
      return string.format("%d %s", data2, resourceName)
    end
    return string.format("%d Resource (ID: %d)", data2, data1)

  elseif itemType == TradeableItems.TRADE_ITEM_CITIES then
    local plot = Map.GetPlot(data1, data2)
    if plot then
      local city = plot:GetPlotCity()
      if city then
        return string.format("City of %s", city:GetName())
      end
    end
    return string.format("City at (%d, %d)", data1, data2)

  elseif itemType == TradeableItems.TRADE_ITEM_OPEN_BORDERS then
    return "Open Borders"

  elseif itemType == TradeableItems.TRADE_ITEM_DEFENSIVE_PACT then
    return "Defensive Pact"

  elseif itemType == TradeableItems.TRADE_ITEM_RESEARCH_AGREEMENT then
    local cost = Game.GetResearchAgreementCost(fromPlayer, toPlayer)
    return string.format("Research Agreement (%d Gold)", cost)

  elseif itemType == TradeableItems.TRADE_ITEM_PEACE_TREATY then
    return "Peace Treaty"

  elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_PEACE then
    local teamName = "Unknown"
    if data1 and Teams[data1] then
      local team = Teams[data1]
      local leaderID = team:GetLeaderID()
      if leaderID >= 0 then
        local leader = Players[leaderID]
        if leader then
          teamName = getCivName(leader)
        end
      end
    end
    return string.format("Make Peace with %s", teamName)

  elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_WAR then
    local teamName = "Unknown"
    if data1 and Teams[data1] then
      local team = Teams[data1]
      local leaderID = team:GetLeaderID()
      if leaderID >= 0 then
        local leader = Players[leaderID]
        if leader then
          teamName = getCivName(leader)
        end
      end
    end
    return string.format("Declare War on %s", teamName)

  elseif itemType == TradeableItems.TRADE_ITEM_ALLOW_EMBASSY then
    return "Embassy"

  elseif itemType == TradeableItems.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP then
    return "Declaration of Friendship"

  elseif itemType == TradeableItems.TRADE_ITEM_VOTE_COMMITMENT then
    return "Vote Commitment (World Congress)"

  elseif itemType == TradeableItems.TRADE_ITEM_TECHS then
    local tech = GameInfo.Technologies[data1]
    if tech then
      local techName = Locale.ConvertTextKey(tech.Description)
      return string.format("Technology: %s", techName)
    end
    return string.format("Technology (ID: %d)", data1)

  elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE then
    return "Vassalage"

  elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE_REVOKE then
    return "End Vassalage"

  else
    return string.format("Unknown Item (Type: %d)", itemType or -1)
  end
end

Game.RegisterFunction("${Name}", function(${Arguments})
  local summaries = {}
  -- Get the active league once at the beginning
  local league = Game.GetActiveLeague()

  -- Iterate through all major players
  for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
    local player = Players[playerID]
    
    -- Only include players that are alive
    if player and player:IsAlive() then
      -- Get current era information
      local currentEra = ""
      -- Use player method for era if available, otherwise fall back to team
      local eraID = player:GetCurrentEra()
      if eraID and GameInfo.Eras[eraID] then
        currentEra = GameInfo.Eras[eraID].Type
      end
      -- Tech count still requires team access
      local teamID = player:GetTeam()
      local fromTeam = Teams[player:GetTeam()]
      
      -- Get current research with estimated turns
      local currentResearch = nil
      local techID = player:GetCurrentResearch()
      if techID and techID >= 0 and GameInfo.Technologies[techID] then
        local techName = Locale.ConvertTextKey(GameInfo.Technologies[techID].Description)
        -- Calculate turns to complete research
        local sciencePerTurn = player:GetScience()
        if sciencePerTurn > 0 then
          local researchCost = player:GetResearchCost(techID)
          local researchProgress = player:GetResearchProgress(techID)
          local researchRemaining = researchCost - researchProgress
          local turnsToComplete = math.ceil(researchRemaining / sciencePerTurn)
          currentResearch = techName .. " (Estimated in " .. turnsToComplete .. " turns)"
        else
          currentResearch = techName .. " (No science)"
        end
      else
        currentResearch = "None"
      end

      -- Get votes in the league if it exists
      local votes = nil
      if league then
        votes = league:CalculateStartingVotesForMember(playerID)
      end

      -- Calculate Golden Age status
      local goldenAge = nil
      if player:IsGoldenAge() then
        local turnsLeft = player:GetGoldenAgeTurns()
        goldenAge = turnsLeft .. " turns remaining"
      else
        -- Calculate turns until next golden age
        local progress = player:GetGoldenAgeProgressMeterTimes100() / 100
        local threshold = player:GetGoldenAgeProgressThreshold()
			  local excessHappiness = player:GetHappinessForGAP()
        local iGAPReligion = player:GetGAPFromReligion();
        local iGAPTrait = player:GetGAPFromTraits();
        local iGAPCities = player:GetGAPFromCitiesTimes100() / 100;
        local progressPerTurn = (excessHappiness + iGAPReligion + iGAPTrait + iGAPCities);

        if progressPerTurn <= 0 then
          goldenAge = "Need more happiness"
        else
          local turnsNeeded = math.ceil((threshold - progress) / progressPerTurn)
          goldenAge = "Estimated in " .. turnsNeeded .. " turns"
        end
      end

      -- Calculate turns until next policy
      local nextPolicyTurns = nil
      local culturePerTurn = player:GetTotalJONSCulturePerTurnTimes100() / 100
      if culturePerTurn > 0 then
        local cultureCost = player:GetNextPolicyCost()
        local cultureProgress = player:GetJONSCultureTimes100() / 100
        local cultureRemaining = cultureCost - cultureProgress
        if cultureRemaining > 0 then
          nextPolicyTurns = math.ceil(cultureRemaining / culturePerTurn)
        else
          nextPolicyTurns = 0  -- Can adopt policy now
        end
      end

      local summary = {
        Key = playerID,
        Score = player:GetScore(),  -- Player's current score
        Era = currentEra,
        Votes = votes,  -- Votes in the World Congress/UN
        Cities = player:GetNumCities(),
        Population = player:GetTotalPopulation(),
        Territory = player:GetNumPlots(),  -- Number of plots owned (major civs only)
        BestSettlementLocation = "None",  -- Will be populated if the player has a best settlement location
        Gold = player:GetGold(),
        GoldPerTurn = player:CalculateGoldRate(),
        HappinessPercentage = player:GetExcessHappiness(),  -- Excess happiness (can be negative)
        GoldenAge = goldenAge,  -- Golden Age status (e.g., "5 turns remaining", "Estimated in 8 turns", "Need More Happiness")
        TourismPerTurn = player:GetTourism() / 100, -- Raw tourism output
        CulturePerTurn = player:GetTotalJONSCulturePerTurn(),  -- Culture per turn (visible to met players)
        FaithPerTurn = player:GetTotalFaithPerTurn(),  -- Faith per turn (only visible to team)
        SciencePerTurn = player:GetScience(),  -- Science per turn (only visible to team)
        Technologies = fromTeam:GetTeamTechs():GetNumTechsKnown() or 0,
        CurrentResearch = currentResearch,
        NextPolicyTurns = nextPolicyTurns,  -- Turns until next policy can be adopted
        MilitaryUnits = player:GetNumUnitsToSupply(),  -- Current military units needing supply
        MilitarySupply = player:GetNumUnitsSupplied(),  -- Maximum supply capacity
        MilitaryStrength = player:GetMilitaryMight(),  -- Total military strength (attack power of all units)
        PolicyBranches = nil,  -- Will be populated if player has policies
        FoundedReligion = nil,  -- Will be populated if player founded religion
        MajorityReligion = nil,  -- Will be populated from the religion in most of the player's cities
        Resources = nil,  -- Will be populated if player has resources
        Relationships = nil,  -- Will be populated if player has diplomatic relationships
        OutgoingTradeRoutes = nil,  -- Will be populated if player has outgoing trade routes
        IncomingTradeRoutes = nil,  -- Will be populated if player has incoming trade routes
        Spies = nil,  -- Will be populated if player has spies
        DiplomaticDeals = nil  -- Will be populated if player has active deals
      }

      -- Get best settlement locations (major civs only)
      local settlements = player:GetBestSettlementInfo(5)
      if settlements and #settlements > 0 then
        summary.BestSettlementLocation = settlements
      end

      -- Add relative visibility to all other players
      for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local otherPlayer = Players[otherPlayerID]
        if otherPlayer and otherPlayer:IsEverAlive() then
          local fieldName = "Player" .. otherPlayerID
          summary[fieldName] = getVisibility(playerID, otherPlayerID)
        end
      end
      
      -- Get policy branches with individual policies
      local policyBranches = nil  -- Start with nil, only allocate if needed
      for policyBranchInfo in GameInfo.PolicyBranchTypes() do
        local branchType = policyBranchInfo.ID

        -- Check if player has unlocked this policy branch
        if player:IsPolicyBranchUnlocked(branchType) then
          if not policyBranches then policyBranches = {} end  -- Lazy allocate
          local branchName = Locale.ConvertTextKey(policyBranchInfo.Description)
          
          -- Initialize policies array
          local policies = {}

          -- Get individual policies in this branch
          for policyInfo in GameInfo.Policies() do
            if policyInfo.PolicyBranchType == policyBranchInfo.Type or policyBranchInfo.FreePolicy == policyInfo.Type then
              -- Check if player has this specific policy
              if player:HasPolicy(policyInfo.ID) then
                local policyName = Locale.ConvertTextKey(policyInfo.Description)
                policies[#policies + 1] = policyName
              end
            end
          end

          -- Add the branch with its policies
          policyBranches[branchName] = policies
        end
      end
      summary.PolicyBranches = policyBranches
      
      -- Get religion information
      local createdReligion = player:GetReligionCreatedByPlayer()
      if createdReligion and createdReligion > 0 then
        local religionInfo = GameInfo.Religions[createdReligion]
        if religionInfo then
          summary.FoundedReligion = Locale.ConvertTextKey(religionInfo.Description)
        end
      elseif player:HasCreatedPantheon() then
        -- Player has a pantheon but no full religion
        -- Check if religion is still possible (religions still available to found)
        local religionsStillToFound = Game.GetNumReligionsStillToFound()
        if religionsStillToFound > 0 then
          summary.FoundedReligion = "Pantheon (Religion Possible)"
        else
          summary.FoundedReligion = "Pantheon (Religion Impossible)"
        end
      end
      
      -- Majority religion: the religion followed in most of the player's cities. (GetStateReligionName
      -- reads a key the DLL never sets, so it was always empty.) 0 is the pantheon, not a religion.
      local majorityReligion = player:GetMajorityReligion()
      if majorityReligion and majorityReligion > 0 then
        local religionInfo = GameInfo.Religions[majorityReligion]
        if religionInfo then
          summary.MajorityReligion = Locale.ConvertTextKey(religionInfo.Description)
        end
      end
      
      -- Get resources for major civs: strategic as "available / total", luxuries as available count
      local resources = nil  -- Start with nil, only allocate if needed
      for resource in GameInfo.Resources() do
        if player:IsResourceRevealed(resource.ID) then
          local available = player:GetNumResourceAvailable(resource.ID, true)
          local resourceValue = nil
          if resource.ResourceClassType == "RESOURCECLASS_RUSH" or resource.ResourceClassType == "RESOURCECLASS_MODERN" then
            local total = player:GetNumResourceTotal(resource.ID, true)
            resourceValue = available .. " / " .. total
          elseif resource.ResourceClassType == "RESOURCECLASS_LUXURY" then
            resourceValue = available
          end
          if resourceValue ~= nil then
            if not resources then resources = {} end
            local resourceName = Locale.ConvertTextKey(resource.Description)
            resources[resourceName] = resourceValue
          end
        end
      end
      summary.Resources = resources

      -- Get diplomatic relationships with other major civilizations (only if player is major civ)
      local relationships = {}

      for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        if otherPlayerID ~= playerID then
          local otherPlayer = Players[otherPlayerID]
          local otherTeamID = otherPlayer:GetTeam()
          if otherPlayer and otherPlayer:IsAlive() and not otherPlayer:IsMinorCiv() and fromTeam:IsHasMet(otherTeamID) then
            local relationshipList = {}

            -- Get proximity from both sides and take the larger value
            local proximityToOther = player:GetProximityToPlayer(otherPlayerID)
            local proximityFromOther = otherPlayer:GetProximityToPlayer(playerID)
            local maxProximity = math.max(proximityToOther, proximityFromOther)
            local proximityStr = getProximityString(maxProximity)

            -- Add proximity information
            relationshipList[#relationshipList + 1] = string.format("Distance: %s", proximityStr)

            -- Check for war using player method if available
            if player:IsAtWarWith(otherPlayerID) then
              -- Include war score (positive = winning, negative = losing)
              local warScore = player:GetWarScore(otherPlayerID)
              local weariness = player:GetWarWearinessPercent(otherPlayerID)
              relationshipList[#relationshipList + 1] = string.format("War (Our Score: %d%%; Our War Weariness: %d%%)", warScore, weariness)
            elseif fromTeam:IsDefensivePact(otherTeamID) then
              -- Defensive pacts still need team check
              relationshipList[#relationshipList + 1] = "Defensive Pact"
            end

            -- Check for peace treaty
            if fromTeam:IsForcePeace(otherTeamID) then
              relationshipList[#relationshipList + 1] = "Peace Treaty"
            end

            -- Check if other team is our vassal
            local otherTeam = Teams[otherTeamID]
            if otherTeam:IsVassal(teamID) then
              local voluntary = otherTeam:IsVoluntaryVassal(player:GetTeam())
              relationshipList[#relationshipList + 1] = voluntary and "Our Vassal (Voluntary)" or "Our Vassal (Capitulated)"
            -- Check if we are vassal of other team
            elseif fromTeam:IsVassal(otherTeamID) then
              local voluntary = fromTeam:IsVoluntaryVassal(otherTeamID)
              relationshipList[#relationshipList + 1] = voluntary and "Our Master (Voluntary)" or "Our Master (Capitulated)"
            end

            -- Check for other agreements
            if fromTeam:IsAllowsOpenBordersToTeam(otherTeamID) then
              relationshipList[#relationshipList + 1] = "Open Borders"
            end

            -- Check for research agreement
            if fromTeam:IsHasResearchAgreement(otherTeamID) then
              relationshipList[#relationshipList + 1] = "Research Agreement"
            end

            -- Check for Declaration of Friendship
            if player:IsDoF(otherPlayerID) then
              relationshipList[#relationshipList + 1] = "Declaration of Friendship"
            end

            -- Check for denouncement
            if player:IsDenouncedPlayer(otherPlayerID) then
              relationshipList[#relationshipList + 1] = "Denounced Them"
            end

            if player:IsDenouncingPlayer(otherPlayerID) then
              relationshipList[#relationshipList + 1] = "Denounced By Them"
            end

            -- Only add if there are relationships
            if #relationshipList > 0 then
              relationships[getCivName(otherPlayer)] = relationshipList
            end
          end
        end
      end
      summary.Relationships = relationships

      -- Get diplomat network points with other major civilizations
      local diplomatPoints = nil
      local espionageSpies = player:GetEspionageSpies()

      if espionageSpies then
        for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
          if otherPlayerID ~= playerID then
            -- Find diplomat for this target player
            for _, spy in ipairs(espionageSpies) do
              if spy.IsDiplomat and spy.CityOwner == otherPlayerID then
                if not diplomatPoints then diplomatPoints = {} end
                diplomatPoints["Player" .. otherPlayerID] = spy.NetworkPointsStored or 0
                break
              end
            end
          end
        end
      end
      summary.DiplomatPoints = diplomatPoints

      -- Get outgoing trade routes
      local outgoingTradeRoutes = {}
      local playerTradeRoutes = player:GetTradeRoutes()
      local activeRouteCount = playerTradeRoutes and #playerTradeRoutes or 0
      local maxRoutes = player:GetNumInternationalTradeRoutesAvailable()
      local unassignedCount = maxRoutes - activeRouteCount

      if unassignedCount > 0 then
        outgoingTradeRoutes["Available"] = unassignedCount
      end

      if playerTradeRoutes then
        for _, route in ipairs(playerTradeRoutes) do
          local fromCityName = route.FromCityName or "Unknown"
          local toCityName = route.ToCityName or "Unknown"
          local fromCivName = "Unknown"
          local toCivName = "Unknown"

          if route.FromID and Players[route.FromID] then
            fromCivName = getCivName(Players[route.FromID])
          end

          if route.ToID and Players[route.ToID] then
            toCivName = getCivName(Players[route.ToID])
          end

          local routeKey = string.format("%s (%s) => %s (%s)", fromCityName, fromCivName, toCityName, toCivName)
          outgoingTradeRoutes[routeKey] = {
            TurnsLeft = route.TurnsLeft,
            Domain = route.Domain == DomainTypes.DOMAIN_LAND and "Land" or "Sea",
            FromGold = route.FromGPT > 0 and route.FromGPT / 100 or -1, -- If the value is 0, set to -1 to indicate no gold from origin
            ToGold = route.ToGPT > 0 and route.ToGPT / 100 or -1,
            ToFood = route.ToFood > 0 and route.ToFood / 100 or -1,
            ToProduction = route.ToProduction > 0 and route.ToProduction / 100 or -1,
            FromScience = route.FromScience > 0 and route.FromScience / 100 or -1,
            ToScience = route.ToScience > 0 and route.ToScience / 100 or -1,
            FromCulture = route.FromCulture > 0 and route.FromCulture / 100 or -1,
            ToCulture = route.ToCulture > 0 and route.ToCulture / 100 or -1,
          }
        end
      end
      summary.OutgoingTradeRoutes = outgoingTradeRoutes

      -- Get incoming trade routes
      local incomingTradeRoutes = {}
      local incomingRoutes = player:GetTradeRoutesToYou()

      if incomingRoutes then
        for _, route in ipairs(incomingRoutes) do
          local fromCityName = route.FromCityName or "Unknown"
          local toCityName = route.ToCityName or "Unknown"
          local fromCivName = "Unknown"
          local toCivName = "Unknown"

          if route.FromID and Players[route.FromID] then
            fromCivName = getCivName(Players[route.FromID])
          end

          if route.ToID and Players[route.ToID] then
            toCivName = getCivName(Players[route.ToID])
          end

          local routeKey = string.format("%s (%s) => %s (%s)", fromCityName, fromCivName, toCityName, toCivName)
          incomingTradeRoutes[routeKey] = {
            TurnsLeft = route.TurnsLeft,
            Domain = route.Domain == DomainTypes.DOMAIN_LAND and "Land" or "Sea",
            FromGold = route.FromGPT > 0 and route.FromGPT / 100 or -1,
            ToGold = route.ToGPT > 0 and route.ToGPT / 100 or -1,
            ToFood = route.ToFood > 0 and route.ToFood / 100 or -1,
            ToProduction = route.ToProduction > 0 and route.ToProduction / 100 or -1,
            FromScience = route.FromScience > 0 and route.FromScience / 100 or -1,
            ToScience = route.ToScience > 0 and route.ToScience / 100 or -1,
            FromCulture = route.FromCulture > 0 and route.FromCulture / 100 or -1,
            ToCulture = route.ToCulture > 0 and route.ToCulture / 100 or -1,
          }
        end
      end
      summary.IncomingTradeRoutes = incomingTradeRoutes

      -- Get spy information
      local espionageSpies = player:GetEspionageSpies()

      if espionageSpies then
        local spies = {}
        for _, spy in ipairs(espionageSpies) do
          -- Get spy location
          local location = "Unassigned"
          if spy.CityX and spy.CityY and spy.CityX >= 0 and spy.CityY >= 0 then
            local plot = Map.GetPlot(spy.CityX, spy.CityY)
            if plot then
              local city = plot:GetPlotCity()
              if city then
                local cityName = city:GetName()
                local cityOwner = Players[city:GetOwner()]
                if cityOwner then
                  local civName = getCivName(cityOwner)
                  location = string.format("%s (%s)", cityName, civName)
                else
                  location = cityName
                end
              end
            end
          end

          -- Determine spy role
          local role = getSpyRole(spy, playerID)

          -- Get rank name (localized)
          local rankName = Locale.ConvertTextKey(spy.Rank)

          -- Create condensed spy identifier
          local spyIdentifier = string.format("%s %s (%d)", rankName, Locale.ConvertTextKey(spy.Name), spy.AgentID)

          -- Build spy entry
          local spyEntry = {
            Role = role,
            Location = location,
            State = Locale.ConvertTextKey(spy.State),
            Network = spy.NetworkPointsStored,
            NetworkPerTurn = spy.NetworkPointsPerTurn
          }

          -- Add to spies table using spy identifier as key
          spies[spyIdentifier] = spyEntry
        end
        summary.Spies = spies
      end

      -- Get diplomatic deals with other major civilizations
      local diplomaticDeals = nil
      local numDeals = UI.GetNumCurrentDeals(playerID)

      if numDeals > 0 then
        for i = 0, numDeals - 1 do
          UI.LoadCurrentDeal(playerID, i)
          local deal = UI.GetScratchDeal()
          local otherPlayerID = deal:GetOtherPlayer(playerID)
          local otherPlayer = Players[otherPlayerID]

          if otherPlayer and not otherPlayer:IsMinorCiv() then
            local weGive = {}
            local theyGive = {}
            local dealFinalTurn = nil

            deal:ResetIterator()
            local itemType, duration, finalTurn, data1, data2, data3, flag1, fromPlayer = deal:GetNextItem()

            while itemType ~= nil do
              -- Capture finalTurn from any item that has it. Permanent items (e.g. an
              -- Embassy) report finalTurn 0, which Lua treats as true, so only a positive
              -- final turn counts; permanent deals fall through to the -1 sentinel below.
              if finalTurn and finalTurn > 0 and not dealFinalTurn then
                dealFinalTurn = finalTurn
              end

              local itemStr = formatDealItem(itemType, data1, data2, data3, flag1, playerID, otherPlayerID)

              if fromPlayer == playerID then
                table.insert(weGive, itemStr)
              else
                table.insert(theyGive, itemStr)
              end

              itemType, duration, finalTurn, data1, data2, data3, flag1, fromPlayer = deal:GetNextItem()
            end

            if #weGive > 0 or #theyGive > 0 then
              if not diplomaticDeals then diplomaticDeals = {} end
              local civName = getCivName(otherPlayer)

              -- Initialize array for this civ if it doesn't exist
              if not diplomaticDeals[civName] then
                diplomaticDeals[civName] = {}
              end

              -- Set turnsLeft to -1 if finalTurn is still nil
              local turnsLeft = dealFinalTurn and (dealFinalTurn - Game.GetGameTurn()) or -1

              -- Add this deal to the array
              table.insert(diplomaticDeals[civName], {
                TurnsRemaining = turnsLeft,
                WeGive = weGive,
                TheyGive = theyGive
              })
            end
          end

          if deal ~= nil then
            deal:ClearItems()
          end
        end
      end

      summary.DiplomaticDeals = diplomaticDeals

      -- Add to results
      table.insert(summaries, summary)
    end
  end

  -- Also check minor civs (city-states)
  for playerID = GameDefines.MAX_MAJOR_CIVS, GameDefines.MAX_CIV_PLAYERS - 1 do
    local player = Players[playerID]

    -- Only include minor civs that are alive
    if player and player:IsAlive() and player:IsMinorCiv() then
      -- Get current tech information (still requires team access)
      local fromTeam = Teams[player:GetTeam()]

      local summary = {
        Key = playerID,
        MajorAlly = nil,  -- Will be populated below
        Cities = player:GetNumCities(),
        Population = player:GetTotalPopulation(),
        Gold = player:GetGold(),
        GoldPerTurn = math.floor(player:CalculateGoldRateTimes100() / 100),
        Technologies = fromTeam:GetTeamTechs():GetNumTechsKnown() or 0,  -- Get actual tech count for minor civs
        Resources = nil,  -- Will be populated with actual available resources
        Relationships = nil  -- Will be populated with relationships to major civs
      }
      
      -- Get ally name for minor civs
      local allyID = player:GetAlly()
      if allyID and allyID >= 0 then
        local allyPlayer = Players[allyID]
        if allyPlayer then
          summary.MajorAlly = getCivName(allyPlayer)
        end
      end

      -- Get relationships with all major civs
      local relationships = {}
      for majorID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local major = Players[majorID]
        if major and major:IsAlive() then
          -- Get influence score
          local influence = player:GetMinorCivFriendshipWithMajor(majorID)

          -- Get the major civ's proximity to it
          local proximity = major:GetProximityToPlayer(playerID)
          local proximityStr = getProximityString(proximity)

          -- Determine relationship status
          local status = "Neutral"
          local majorTeam = Teams[major:GetTeam()]
          local isProtected = player:IsProtectedByMajor(majorID)

          -- Check war status first
          if fromTeam:IsAtWar(major:GetTeam()) then
            if player:IsMinorPermanentWar(majorTeam) then
              status = "Permanent War"
            -- Check if peace is blocked
            elseif player:IsPeaceBlocked(majorTeam) then
              status = "War - Peace Currently Blocked"
            else
              status = "War"
            end
          -- Check if major is the ally
          elseif player:IsAllies(majorID) then
            status = "Ally"
          -- Check if major is friends
          elseif player:IsFriends(majorID) then
            status = "Friends"
          -- Neutral
          else
            status = "Neutral"
          end

          -- Format the status with influence, proximity, and protected status
          local formattedStatus
          if isProtected then
            formattedStatus = string.format("%s (Influence: %d, Distance: %s, Protected)", status, influence, proximityStr)
          else
            formattedStatus = string.format("%s (Influence: %d, Distance: %s)", status, influence, proximityStr)
          end

          relationships[getCivName(major)] = formattedStatus
        end
      end
      summary.Relationships = relationships

      -- Add relative visibility to all other players
      for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local otherPlayer = Players[otherPlayerID]
        if otherPlayer and otherPlayer:IsEverAlive() then
          local fieldName = "Player" .. otherPlayerID
          summary[fieldName] = getVisibility(playerID, otherPlayerID)
        end
      end

      -- Get majority religion for city-state
      local capital = player:GetCapitalCity()
      if capital then
        local majorityReligion = capital:GetReligiousMajority()
        if majorityReligion and majorityReligion > 0 then
          local religionInfo = GameInfo.Religions[majorityReligion]
          if religionInfo then
            summary.MajorityReligion = Locale.ConvertTextKey(religionInfo.Description)
          end
        end
      end
      
      -- Get actual available resources for minor civs (skip 0s)
      local availableResources = nil  -- Start with nil, only allocate if needed
      for resource in GameInfo.Resources() do
        local resourceCount = player:GetNumResourceAvailable(resource.ID, true)
        if resourceCount > 0 then
          if not availableResources then availableResources = {} end  -- Lazy allocate
          -- Use localized name
          local resourceName = Locale.ConvertTextKey(resource.Description)
          availableResources[resourceName] = resourceCount
        end
      end
      summary.Resources = availableResources

      -- Get active quests for this city-state
      local quests = {}

      -- Get quest information for each major player
      for majorID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local major = Players[majorID]
        if major and major:IsAlive() then
          -- Get the quest tooltip text for this major player
          local fieldName = "Player" .. majorID
          local questTooltip = GetActiveQuestToolTip(majorID, playerID)
          quests[fieldName] = questTooltip
        end
      end

      summary.Quests = quests
      
      -- Add relative visibility to all other players
      for otherPlayerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
        local otherPlayer = Players[otherPlayerID]
        if otherPlayer and otherPlayer:IsEverAlive() then
          local fieldName = "Player" .. otherPlayerID
          summary[fieldName] = getVisibility(playerID, otherPlayerID)
        end
      end
      
      -- Add to results
      table.insert(summaries, summary)
    end
  end

  return summaries
end)

return true
