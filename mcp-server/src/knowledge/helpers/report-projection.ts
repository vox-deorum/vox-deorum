import { omitFields, pickFields } from '../../utils/fields.js';

/** Basic city fields exposed by the existing city tool, including wonders. */
export const cityBasicFields = [
  'Key', 'Owner', 'Name', 'X', 'Y', 'Population', 'MajorityReligion', 'DefenseStrength',
  'HitPoints', 'MaxHitPoints', 'IsPuppet', 'IsOccupied', 'IsCoastal', 'Wonders', 'RazingTurns', 'ResistanceTurns'
] as const;

/** Detailed city fields requiring recorded full city access. */
export const cityDetailFields = [
  'FoodStored', 'FoodPerTurn', 'ProductionStored', 'ProductionPerTurn', 'CurrentProduction',
  'ProductionTurnsLeft', 'GoldPerTurn', 'SciencePerTurn', 'CulturePerTurn', 'FaithPerTurn',
  'TourismPerTurn', 'HappinessDelta', 'BuildingCount', 'ImportantBuildings', 'GreatWorkCount'
] as const;

/** Select permitted raw city fields without changing values or supplied nested objects. */
export function projectCityReportFields<T extends Record<string, any>>(city: T, visibility: number | undefined): Partial<T> {
  if (visibility !== 1 && visibility !== 2) return {};
  return structuredClone(pickFields(city, visibility === 2 ? [...cityBasicFields, ...cityDetailFields] : cityBasicFields)) as Partial<T>;
}

/** Apply the existing national field restrictions using explicit access and diplomat points. */
export function projectPlayerReportFields<T extends Record<string, any>>(
  row: T, visibility: number | undefined, diplomatPoints = 0, isMajor = true
): T {
  if (visibility !== 1 && visibility !== 2) return {} as T;
  const summary: Record<string, any> = structuredClone(row);
  if (visibility === 2) return summary as T;
  if (summary.PolicyBranches && diplomatPoints < 200) {
    summary.PolicyBranches = Object.fromEntries(Object.entries(summary.PolicyBranches).map(([branch, policies]) =>
      [branch, Array.isArray(policies) ? policies.length : policies]));
  }
  const hidden = [
    'BestSettlementLocation', 'CurrentResearch', 'NextPolicyTurns', 'FaithPerTurn', 'SciencePerTurn',
    'OutgoingTradeRoutes', 'IncomingTradeRoutes', 'Spies', 'DiplomatPoints', 'MilitarySupply'
  ];
  if (diplomatPoints < 800) hidden.push('DiplomaticDeals');
  if (diplomatPoints < 500) hidden.push('MilitaryUnits');
  if (summary.GoldenAge && !summary.GoldenAge.endsWith('turns remaining')) hidden.push('GoldenAge');
  if (!isMajor) hidden.push(
    'TeamID', 'Era', 'Cities', 'Technologies', 'Gold', 'GoldPerTurn', 'Score', 'CulturePerTurn',
    'FaithPerTurn', 'SciencePerTurn', 'TourismPerTurn', 'HappinessPercentage'
  );
  return omitFields(summary, hidden) as T;
}
