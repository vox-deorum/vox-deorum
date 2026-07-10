/**
 * @module archivist/query-types
 *
 * Interfaces for the episode retrieval pipeline.
 * EpisodeQuery is the sole input; EpisodeResult is the output with attached outcomes.
 */

/** The ONLY input to the retrieval pipeline */
export interface EpisodeQuery {
  gameStateVector: number[];     // 35d
  neighborVector: number[];      // 32d
  situationAbstract?: string;    // optional — pipeline generates embedding when provided

  // Current state for fuzzy attribute scoring in SQL
  era: string;                   // proximity-scored (neighboring eras get partial credit)
  civilization: string;
  grandStrategy: string | null;
  activeWars: number;            // proximity-scored (±1 = half credit)
  friends: number;               // proximity-scored (±1 = half credit)
  defensivePacts: number;        // proximity-scored (±1 = half credit)
  truces: number;                // proximity-scored (±1 = half credit)
  denouncements: number;         // proximity-scored (±1 = half credit)

  candidateLimit?: number;       // pre-diversity pool (default 20)
  resultLimit?: number;          // final count (default 3)
}

/** Outcome snapshot at a future horizon */
export interface OutcomeSnapshot {
  horizonTurns: number;          // actual offset (may be less than requested if game ended early)
  situationAbstract: string | null;
  decisionAbstract: string | null;
  deltas: EpisodeDelta;
}

/** Quantitative deltas as formatted strings */
export interface EpisodeDelta {
  sciencePerPop: string | null;      // "+50%" (relative change in per-pop ratio)
  culturePerPop: string | null;
  productionPerPop: string | null;
  goldPerPop: string | null;
  tourismShare: string | null;       // "+10%" (relative change in world share)
  militaryShare: string | null;
  populationShare: string | null;
  citiesShare: string | null;
  minorAlliesShare: string | null;
  religionPercentage: string | null;
  warWeariness: string | null;
}

/** A retrieved episode with outcomes */
export interface EpisodeResult {
  gameId: string;
  turn: number;
  civilization: string;
  era: string;
  grandStrategy: string | null;
  isWinner: boolean;
  victoryType: string | null;
  similarity: number;
  situationAbstract: string | null;
  decisionAbstract: string | null;
  situation: string | null;
  decisions: string | null;
  outcomes: OutcomeSnapshot[];   // 0-4 (fewer if game ended early)
  indicators: {
    sciencePerPop: number | null;
    culturePerPop: number | null;
    productionPerPop: number | null;
    goldPerPop: number | null;
    tourismShare: number | null;
    militaryShare: number | null;
    populationShare: number | null;
    citiesShare: number | null;
    minorAlliesShare: number | null;
    religionPercentage: number;
    warWeariness: number;
    activeWars: number;
    truces: number;
    dominationProgress: number | null;
    scienceProgress: number | null;
    cultureProgress: number | null;
    diplomaticProgress: number | null;
    supplyUtilization: number | null;
  };
}
