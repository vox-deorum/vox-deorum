/**
 * Sample data for the human-control decision panel mockup.
 *
 * SAMPLE_OPTIONS_REPORT mirrors exactly what the real panel receives: the
 * Flavor-mode OptionsReport that `present-decision` fetches via `get-options`
 * and fires into the game as `LuaEvents.VoxDeorumHumanDecision(playerID, turn,
 * optionsJson)`. Descriptive text for grand strategies, flavors, and persona
 * values is copied verbatim from the sources the LLM prompts use
 * (mcp-server/docs/strategies/grand-flavor.json, .../flavors.json, and the
 * set-persona tool's field descriptions). Tech/policy help text is
 * representative stand-in text in the same style as the game database help
 * the real report carries.
 *
 * It is a JS file (not .json) only because browsers block fetch() of local
 * JSON over file:// — the object below is the JSON payload, unchanged.
 *
 * MOCKUP_DISPLAY holds display-only extras the real panel gets from the game
 * itself, not from the OptionsReport: the human leader's trait + unique
 * components (the same data the EUI leader-choose dialog shows at pre-game),
 * leader names/portraits for met civs (resolved via the Lua Players table),
 * icon art (game icon atlases), and the civ-name → playerID mapping needed to
 * submit relationship changes ({TargetID, Public, Private}). Portraits/icons
 * here are placeholders; the real panel uses IconHookup/CivIconHookup and
 * leader portrait textures.
 */

// The scenario: the human steers Rome (player 0). It is turn 142; the last
// decision was on turn 138 (research → Currency). A decision is now pending.
const SAMPLE_OPTIONS_REPORT = {
  Options: {
    GrandStrategies: {
      "Conquest": "Focus on military domination through offensive warfare.",
      "Culture": "Pursue cultural victory through cultural influence (tourism).",
      "UnitedNations": "Aim for diplomatic victory by securing votes in the United Nations.",
      "Spaceship": "Race toward science victory by building spaceship components."
    },
    Flavors: {
      "Offense": "Pivots the military towards offensive stances. Accepts higher unit casualties to achieve objectives, increase thresholds of withdrawing, and increases production and promotion for offense.",
      "Defense": "Increases military production and unit promotion for defensive purposes.",
      "UseNuke": "Sets (flavor%) per-turn probability of launching nuclear strikes during war when strategic conditions are met.",
      "CityDefense": "Prioritizes unit promotions for static defense (friendly territory bonuses, capital defense, garrisoned attacks).",
      "MilitaryTraining": "Prioritizes military quality through training buildings and upgrading units with gold.",
      "Mobilization": "Increases the proportion of military production (compared with civilian production).",
      "Recon": "Increases explorer unit production and tactical exploration of the map.",
      "Ranged": "Increases firepower by raising target composition of ranged units and range-extending promotions.",
      "Mobile": "Increases mobility and maneuverability by raising target composition of mobile units and prioritizes related promotions.",
      "Nuke": "Increases nuclear weapon arsenals for strategic deterrence.",
      "Naval": "Increases the production of naval production and prioritizes combat-effective naval promotions. Naval size is also based on coastal city percentage and geography.",
      "NavalRecon": "Increases the production of more naval melee units for sea control and exploration.",
      "Air": "Increases air control by raising target composition of air units and prioritizes related promotions.",
      "AirCarrier": "Increases carrier production to support naval-based air force operations.",
      "Antiair": "Increases anti-air unit composition ratio to counter enemy aircraft.",
      "Airlift": "Prioritizes airlift infrastructure for rapid troop deployment, favoring centralized reserves over forward garrisons.",
      "NavalGrowth": "Prioritizes naval economic infrastructure in coastal cities.",
      "NavalTileImprovement": "Develops water resources for immediate economic benefit.",
      "Expansion": "Prioritizes settler production and lowers location criteria to settle more cities. Essential in early game.",
      "Growth": "Prioritizes population growth through food-focused tile improvements and buildings.",
      "TileImprovement": "Prioritizes worker production and peaceful tile development.",
      "Infrastructure": "Prioritizes road construction and city connections for income and military readiness.",
      "Production": "Prioritizes production-focused tiles and buildings.",
      "Gold": "Prioritizes gold-focused tiles and buildings.",
      "Science": "Prioritizes science-focused tiles and buildings.",
      "Culture": "Prioritizes culture-focused tiles and buildings.",
      "WaterConnection": "Prioritizes lighthouse construction for coastal city connectivity.",
      "Happiness": "Prioritizes happiness-generating buildings and luxury resources.",
      "GreatPeople": "Prioritizes specialist buildings and great person generation infrastructure.",
      "Wonder": "Prioritizes wonder construction.",
      "Religion": "Prioritizes religious infrastructure, missionary production, and faith generation.",
      "Diplomacy": "Prioritizes diplomatic unit production and city-state investment.",
      "Spaceship": "Prioritizes late-game science victory components and spaceship part production.",
      "Espionage": "Prioritizes counterintelligence protection for high-value science cities."
    },
    Technologies: {
      "Currency": "Allows you to build the Market, which increases the city's Gold output, and the Caravansary, extending the range of your land trade routes.\nCompleting it would unlock: Civil Service, Guilds",
      "Philosophy": "Allows you to build the Temple, which increases Faith output and lets your empire benefit from its Religion.\nCompleting it would unlock: Theology, Civil Service",
      "Drama and Poetry": "Allows you to build the Amphitheater, which increases Culture and can hold a Great Work of Writing.\nCompleting it would unlock: Theology",
      "Iron Working": "Allows you to build the Swordsman, a strong melee unit, and reveals Iron on the map.\nCompleting it would unlock: Metal Casting",
      "Construction": "Allows you to build the Colosseum, which increases Happiness, and unlocks Lumber Mills on forest tiles.\nCompleting it would unlock: Engineering",
      "Horseback Riding": "Allows you to build the Horseman, a fast and powerful mounted unit, and the Stable, which boosts mounted unit production.\nCompleting it would unlock: Chivalry",
      "Sailing": "Allows you to build Work Boats to harvest sea resources and Cargo Ships for sea trade routes.\nCompleting it would unlock: Optics",
      "Trapping": "Allows you to build the Circus, which increases Happiness, and Camps on fur and ivory resources.\nCompleting it would unlock: Civil Service"
    },
    Policies: {
      "Sovereignty (Continuing Tradition Branch)": "+1 Science from the Palace and +1 Gold from Monuments. Provides +1 Happiness in the Capital.",
      "Splendor (Continuing Tradition Branch)": "+1 Culture from Wonders. Great Person tile improvements provide +1 Culture.",
      "Majesty (Continuing Tradition Branch)": "+1 Gold for every 10 Citizens in the Capital. Reduces building Gold maintenance in the Capital by 15%.",
      "Progress (New Branch)": "Adopting Progress grants +20 Science when a Citizen is born in your Capital. Unlocks policies that strengthen infrastructure, worker speed, and steady empire-wide growth.",
      "Authority (New Branch)": "Adopting Authority grants +25% combat experience for all units and Culture when you kill enemy units. Unlocks policies that reward expansion and warfare.",
      "Fealty (New Branch)": "Adopting Fealty grants +1 Food and +1 Faith in every city. Unlocks policies that strengthen religion, defense, and wide empires.",
      "Statecraft (New Branch)": "Adopting Statecraft grants +1 Science, Culture, Faith and Gold in the Capital for every 15 Citizens in your empire. Unlocks policies that reward diplomacy and city-state alliances.",
      "Artistry (New Branch)": "Adopting Artistry grants +1 Golden Age Point per Specialist. Unlocks policies that reward Great People, Wonders, and cultural development."
    }
  },
  Persona: {
    "VictoryCompetitiveness": 7,
    "WonderCompetitiveness": 5,
    "MinorCivCompetitiveness": 5,
    "Boldness": 7,
    "WarBias": 6,
    "HostileBias": 5,
    "WarmongerHate": 5,
    "NeutralBias": 5,
    "FriendlyBias": 4,
    "GuardedBias": 5,
    "AfraidBias": 3,
    "DiplomaticBalance": 5,
    "Friendliness": 4,
    "WorkWithWillingness": 5,
    "WorkAgainstWillingness": 6,
    "Loyalty": 6,
    "MinorCivFriendlyBias": 4,
    "MinorCivNeutralBias": 5,
    "MinorCivHostileBias": 5,
    "MinorCivWarBias": 4,
    "DenounceWillingness": 5,
    "Forgiveness": 4,
    "Meanness": 6,
    "Neediness": 4,
    "Chattiness": 5,
    "DeceptiveBias": 5
  },
  Strategy: {
    Rationale: "Rome's heartland is secure; shifting toward expansion and production to fuel the legions before Greece consolidates the city-states.",
    GrandStrategy: "Conquest",
    Flavors: {
      "Offense": 60, "Defense": 50, "UseNuke": 50, "CityDefense": 50, "MilitaryTraining": 60,
      "Mobilization": 55, "Recon": 40, "Ranged": 55, "Mobile": 50, "Nuke": 50,
      "Naval": 30, "NavalRecon": 30, "Air": 50, "AirCarrier": 50, "Antiair": 50, "Airlift": 50,
      "NavalGrowth": 30, "NavalTileImprovement": 30, "Expansion": 70, "Growth": 55,
      "TileImprovement": 55, "Infrastructure": 60, "Production": 60, "Gold": 50,
      "Science": 50, "Culture": 40, "WaterConnection": 40, "Happiness": 50,
      "GreatPeople": 45, "Wonder": 35, "Religion": 40, "Diplomacy": 35,
      "Spaceship": 50, "Espionage": 50
    }
  },
  Technology: {
    Next: "Currency",
    Rationale: "Markets will fund unit upkeep as the army grows."
  },
  Policy: {
    Next: "None"
  },
  Relationships: {
    "Greece": { Public: -20, Private: -35, Rationale: "Alexander contests the same city-states and his army is massing near our border.", UpdatedTurn: 126 },
    "Egypt": { Public: 15, Private: 10, Rationale: "Ramesses trades fairly and shares no borders with us.", UpdatedTurn: 110 },
    "Songhai": { Public: 0, Private: -10, Rationale: "Askia's raids on city-states bear watching.", UpdatedTurn: 96 }
  }
};

// Display-only extras the real panel takes from the game, not from the report.
const MOCKUP_DISPLAY = {
  // The human seat. The view is pinned to this civ; the panel renders nothing
  // about any other civ beyond met leaders' names/portraits (recognition only).
  human: {
    playerID: 0,
    leader: "Augustus Caesar",
    civ: "Rome",
    monogram: "R",
    color: "#5e3c8f",
    // Leader/civ trait + unique components — the SAME information the EUI
    // leader-choose dialog shows at pre-game. The real panel reads these from
    // the game's text/civ database (Traits, Civilization_UnitClassOverrides,
    // Civilization_BuildingClassOverrides, …) exactly as that dialog does; the
    // strings below are placeholder copy.
    trait: {
      name: "The Glory of Rome",
      description: "+25% Production towards any Buildings that already exist in the Capital City; " +
        "Roads and Railroads cost no maintenance."
    },
    // The civ's unique units / buildings / improvements. Each renders as an icon
    // with a hover tooltip, just like the pre-game leader dialog. Rome's uniques
    // are two units; other civs may add unique buildings/improvements, shown the
    // same way. Icons are placeholders (the real panel uses IconHookup).
    uniques: [
      { kind: "Unit", icon: "🛡️", name: "Legion", replaces: "Swordsman",
        description: "Powerful early melee unit that can also construct Roads and Forts. Stronger than the Swordsman it replaces." },
      { kind: "Unit", icon: "🏹", name: "Ballista", replaces: "Catapult",
        description: "Roman siege weapon with greater combat and ranged strength than the Catapult it replaces." }
    ]
  },

  // Met civilizations, in the order the game would list them. TargetID is the
  // playerID used by set-relationship; the real panel resolves it from the
  // Players table. Civs without an entry in Relationships have no modifiers
  // set yet (both default to 0).
  metCivs: [
    { name: "Greece",  leader: "Alexander",        targetID: 1, monogram: "G", color: "#2e6da8" },
    { name: "Egypt",   leader: "Ramesses II",      targetID: 2, monogram: "E", color: "#b8962e" },
    { name: "France",  leader: "Napoleon",         targetID: 3, monogram: "F", color: "#3a5bc7" },
    { name: "Songhai", leader: "Askia",            targetID: 4, monogram: "S", color: "#a8552a" },
    { name: "Arabia",  leader: "Harun al-Rashid",  targetID: 5, monogram: "A", color: "#2d7d46" }
  ],

  // Placeholder recognition icons (the real panel uses the game's icon atlases).
  techIcons: {
    "Currency": "🪙", "Philosophy": "📜", "Drama and Poetry": "🎭", "Iron Working": "⚔️",
    "Construction": "🏗️", "Horseback Riding": "🐎", "Sailing": "⛵", "Trapping": "🪤"
  },
  policyIcons: {
    "Sovereignty": "👑", "Splendor": "✨", "Majesty": "🏛️", "Progress": "⚙️",
    "Authority": "🗡️", "Fealty": "🛡️", "Statecraft": "🤝", "Artistry": "🎨"
  },
  grandStrategyIcons: { "Conquest": "🗡️", "Culture": "🎭", "UnitedNations": "🕊️", "Spaceship": "🚀" },

  // Panel-only readability grouping (the LLM receives flavors as a flat list).
  // Groups follow the three blocks in mcp-server/docs/strategies/flavors.json.
  flavorGroups: [
    { title: "Military Doctrine", keys: ["Offense", "Defense", "UseNuke", "CityDefense", "MilitaryTraining"] },
    { title: "Military Composition", keys: ["Mobilization", "Recon", "Ranged", "Mobile", "Nuke", "Naval", "NavalRecon", "Air", "AirCarrier", "Antiair", "Airlift"] },
    { title: "Economy & Development", keys: ["NavalGrowth", "NavalTileImprovement", "Expansion", "Growth", "TileImprovement", "Infrastructure", "Production", "Gold", "Science", "Culture", "WaterConnection", "Happiness", "GreatPeople", "Wonder", "Religion", "Diplomacy", "Spaceship", "Espionage"] }
  ],

  // Persona groups follow the section comments in set-persona's schema.
  personaGroups: [
    { title: "Competitiveness & Ambition", keys: ["VictoryCompetitiveness", "WonderCompetitiveness", "MinorCivCompetitiveness", "Boldness"] },
    { title: "War & Peace", keys: ["WarBias", "HostileBias", "WarmongerHate", "NeutralBias", "FriendlyBias", "GuardedBias", "AfraidBias"] },
    { title: "Diplomacy & Cooperation", keys: ["DiplomaticBalance", "Friendliness", "WorkWithWillingness", "WorkAgainstWillingness", "Loyalty"] },
    { title: "City-State Relations", keys: ["MinorCivFriendlyBias", "MinorCivNeutralBias", "MinorCivHostileBias", "MinorCivWarBias"] },
    { title: "Personality", keys: ["DenounceWillingness", "Forgiveness", "Meanness", "Neediness", "Chattiness", "DeceptiveBias"] }
  ],

  // Verbatim from the set-persona tool's field descriptions (what the LLM sees).
  personaDescriptions: {
    "VictoryCompetitiveness": "How aggressively the AI reacts to others pursuing victories (1-10)",
    "WonderCompetitiveness": "How aggressively the AI reacts to others competing for wonders (1-10)",
    "MinorCivCompetitiveness": "How aggressively the AI reacts to others competing for city-state influence (1-10)",
    "Boldness": "Military risk-taking, territorial claim, and conquest desire (1-10)",
    "WarBias": "Likelihood to plan for or declare offensive war (1-10)",
    "HostileBias": "Tendency toward hostile relationships without direct wars (1-10)",
    "WarmongerHate": "How negatively AI reacts to warlike behaviors (1-10)",
    "NeutralBias": "Tendency toward neutral relationships (1-10)",
    "FriendlyBias": "Tendency toward friendly relationships (1-10)",
    "GuardedBias": "Tendency to be guarded or cautiously defensive in diplomacy (1-10)",
    "AfraidBias": "Tendency to be afraid of stronger civs (1-10)",
    "DiplomaticBalance": "Increases relationship with non-competitive civilizations and peaceful resolution of wars (1-10)",
    "Friendliness": "Desire for friendship declarations and increases maximum DoFs (1-10)",
    "WorkWithWillingness": "Tendency to support or collaborate with allies. Increase opinions to shared friends (1-10)",
    "WorkAgainstWillingness": "Tendency to bond over shared enemies and jointly act against them (1-10)",
    "Loyalty": "Loyalty to allies. Lower values allow for backstabbing (1-10)",
    "MinorCivFriendlyBias": "Tendency to be friendly with city-states (1-10)",
    "MinorCivNeutralBias": "Tendency to be neutral with city-states (1-10)",
    "MinorCivHostileBias": "Tendency to be hostile with city-states (1-10)",
    "MinorCivWarBias": "Likelihood to attack city-states (1-10)",
    "DenounceWillingness": "Readiness to denounce other civs (1-10)",
    "Forgiveness": "How quickly to forgive past transgressions (1-10)",
    "Meanness": "Aggressiveness in general. Demanding/bullying more while less likely to accept peace (1-10)",
    "Neediness": "Desire for support from friends (1-10)",
    "Chattiness": "How often they initiate diplomatic contact (1-10)",
    "DeceptiveBias": "Tendency to be deceptively friendly (1-10)"
  },

  // Plain-language display names where de-PascalCasing alone isn't enough
  // (spec §2: no identifiers to memorize).
  displayNames: {
    "UseNuke": "Use Nuclear Weapons",
    "Antiair": "Anti-Air",
    "AirCarrier": "Aircraft Carriers",
    "NavalRecon": "Naval Recon",
    "NavalGrowth": "Naval Growth",
    "NavalTileImprovement": "Naval Tile Improvement",
    "TileImprovement": "Tile Improvement",
    "WaterConnection": "Water Connections",
    "GreatPeople": "Great People",
    "CityDefense": "City Defense",
    "MilitaryTraining": "Military Training",
    "UnitedNations": "United Nations (Diplomacy)",
    "MinorCivCompetitiveness": "City-State Competitiveness",
    "MinorCivFriendlyBias": "City-State Friendly Bias",
    "MinorCivNeutralBias": "City-State Neutral Bias",
    "MinorCivHostileBias": "City-State Hostile Bias",
    "MinorCivWarBias": "City-State War Bias",
    "WarBias": "War Bias",
    "HostileBias": "Hostile Bias",
    "NeutralBias": "Neutral Bias",
    "FriendlyBias": "Friendly Bias",
    "GuardedBias": "Guarded Bias",
    "AfraidBias": "Afraid Bias",
    "DeceptiveBias": "Deceptive Bias",
    "WarmongerHate": "Warmonger Hate",
    "VictoryCompetitiveness": "Victory Competitiveness",
    "WonderCompetitiveness": "Wonder Competitiveness",
    "DiplomaticBalance": "Diplomatic Balance",
    "WorkWithWillingness": "Willingness to Work With Others",
    "WorkAgainstWillingness": "Willingness to Work Against Others",
    "DenounceWillingness": "Willingness to Denounce"
  },

  // Session context for the status line (spec §6). lastRationale pre-fills the
  // rationale box on the next decision turn so Keep Status Quo is not blocked.
  session: {
    turn: 142,
    lastDecision: { turn: 138, summary: "Research → Currency" },
    lastRationale: "Stay on the science track and keep trade routes flowing while we are at peace."
  }
};
