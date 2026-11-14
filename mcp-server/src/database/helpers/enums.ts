/**
 * Utility functions for converting game enums to human-readable formats
 */

/**
 * Era type mappings based on historical periods
 */
export type EraType = 
  | 'ERA_ANCIENT'
  | 'ERA_CLASSICAL'
  | 'ERA_MEDIEVAL'
  | 'ERA_RENAISSANCE'
  | 'ERA_INDUSTRIAL'
  | 'ERA_MODERN'
  | 'ERA_POSTMODERN'
  | 'ERA_FUTURE';

/**
 * Converts an EraType enum value to its corresponding display name
 * 
 * Mapping:
 * - ERA_ANCIENT -> Ancient (Before -800)
 * - ERA_CLASSICAL -> Classical (Between -800 and 399)
 * - ERA_MEDIEVAL -> Medieval (Between 400 and 1449)
 * - ERA_RENAISSANCE -> Renaissance (Between 1450 and 1839)
 * - ERA_INDUSTRIAL -> Industrial (Between 1840 and 1910)
 * - ERA_MODERN -> Modern (Between 1911 and 1944)
 * - ERA_POSTMODERN -> Atomic (Between 1945 and 1989)
 * - ERA_FUTURE -> Information (After 1989)
 * 
 * @param eraType The era type enum value to convert
 * @returns The human-readable era name, defaults to "Ancient" if unknown
 */
export function getEraName(eraType: string | null | undefined): string | undefined {
  if (!eraType) return 'Ancient';
  
  switch (eraType) {
    case 'ERA_ANCIENT':
      return 'Ancient';
    case 'ERA_CLASSICAL':
      return 'Classical';
    case 'ERA_MEDIEVAL':
      return 'Medieval';
    case 'ERA_RENAISSANCE':
      return 'Renaissance';
    case 'ERA_INDUSTRIAL':
      return 'Industrial';
    case 'ERA_MODERN':
      return 'Modern';
    case 'ERA_POSTMODERN':
      return 'Atomic';
    case 'ERA_FUTURE':
      return 'Information';
    default: 
      return undefined;
  }
}