/** Resolve the civic vocabulary of one visible player from the same facts prose can read. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { isRecord } from '../../../utils/guards.js';
import type { EditorialCivicTerms } from '../config/civic-terms.js';
import type { EditorialTerm } from '../config/expressions.js';
import { uniqueSources } from '../shared/sources.js';
import type { FactField, FactObject } from './model.js';

/** Printable words by slot name, ready for the `terms.civic.` prefix. */
export type CivicVocabulary = ReadonlyMap<string, EditorialTerm>;

/** A readable branch map and its keys; an empty serialized map is still readable. */
interface PolicyData {
  readonly branches: Readonly<Record<string, FactField>>;
  readonly readable: boolean;
}

/** A profile that won the policy selection and the catalogue section it came from. */
interface WinningProfile {
  readonly name: string;
  readonly kind: 'branch' | 'ideology';
  readonly terms: Readonly<Record<string, string>>;
}

/** Read a policy map from a fact value without treating an invalid value as policy data. */
function policyData(fields: FactObject | undefined): PolicyData {
  const value = fields?.policyBranches?.value;
  if (isRecord(value)) return { branches: value as Readonly<Record<string, FactField>>, readable: true };
  // The Lua serializer may store a known empty map as an empty array.
  return { branches: {}, readable: Array.isArray(value) && value.length === 0 };
}

/** Count recorded policies for a present branch, leaving an invalid reading unknown. */
function policyCount(field: FactField | undefined): number | undefined {
  const value = field?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Array.isArray(value) ? value.length : undefined;
}

/** Compare catalogue names without depending on the host locale. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Read an own catalogue entry, treating an explicit null as a disabled inherited entry. */
function catalogueEntry<T>(catalogue: Readonly<Record<string, T | null>> | undefined, name: string): T | undefined {
  if (!catalogue || !Object.hasOwn(catalogue, name)) return undefined;
  return catalogue[name] ?? undefined;
}

/** Resolve every declared slot from neutral defaults, the winning profile and civilization overrides. */
export function resolveCivicVocabulary(
  fields: FactObject | undefined,
  civic: EditorialCivicTerms
): CivicVocabulary {
  const policy = policyData(fields);
  const eraField = fields?.era;
  const era = typeof eraField?.value === 'string' ? eraField.value : undefined;
  let eraChecked = false;

  /** Apply a profile's optional era restriction to the recorded era. */
  function eligible(profile: { eras?: readonly string[] }): boolean {
    if (!profile.eras) return true;
    eraChecked = true;
    return era !== undefined && profile.eras.includes(era);
  }

  // Prefer the derived active ideology, then a recognized custom ideology key.
  const ideologyValue = fields?.ideology?.value;
  const derived = typeof ideologyValue === 'string' && ideologyValue.trim() ? ideologyValue : undefined;
  let selected: WinningProfile | undefined;
  if (derived) {
    const profile = catalogueEntry(civic.ideologies, derived);
    if (profile && eligible(profile)) selected = { name: derived, kind: 'ideology', terms: profile.terms };
  } else if (civic.ideologies) {
    const known = Object.keys(civic.ideologies)
      .filter((name) => Object.hasOwn(policy.branches, name))
      .sort(compareNames);
    for (const name of known) {
      const profile = catalogueEntry(civic.ideologies, name);
      if (!profile || !eligible(profile)) continue;
      selected = { name, kind: 'ideology', terms: profile.terms };
      break;
    }
  }

  // Without an applicable ideology, the highest eligible branch tier wins.
  if (!selected && civic.branches) {
    const candidates = Object.keys(policy.branches).flatMap((name) => {
      const profile = catalogueEntry(civic.branches, name);
      if (!profile || !eligible(profile)) return [];
      return [{ name, terms: profile.terms, tier: profile.tier, count: policyCount(policy.branches[name]) }];
    });
    if (candidates.length) {
      const tier = Math.max(...candidates.map((candidate) => candidate.tier));
      const competing = candidates.filter((candidate) => candidate.tier === tier);
      const countsKnown = competing.every((candidate) => candidate.count !== undefined);
      competing.sort((a, b) => countsKnown && a.count !== undefined && b.count !== undefined
        ? b.count - a.count || compareNames(a.name, b.name)
        : compareNames(a.name, b.name));
      selected = { name: competing[0].name, kind: 'branch', terms: competing[0].terms };
    }
  }

  const nameField = fields?.name;
  const civilizationName = typeof nameField?.value === 'string' ? nameField.value : undefined;
  const civilization = civilizationName ? catalogueEntry(civic.civilizations, civilizationName) : undefined;
  const override = !civilization || !selected
    ? undefined
    : selected.kind === 'ideology'
      ? catalogueEntry(civilization.ideologies, selected.name)
      : catalogueEntry(civilization.branches, selected.name);

  const policySources: readonly NewspaperSourceReference[] =
    policy.readable ? fields?.policyBranches?.sources ?? [] : [];
  const eraSources: readonly NewspaperSourceReference[] = eraChecked ? eraField?.sources ?? [] : [];
  const civilizationSources: readonly NewspaperSourceReference[] = nameField?.sources ?? [];

  const vocabulary = new Map<string, EditorialTerm>();
  for (const [slot, neutral] of Object.entries(civic.defaults)) {
    let value = neutral;
    if (selected && Object.hasOwn(selected.terms, slot)) value = selected.terms[slot];
    let usesCivilization = false;
    if (civilization?.terms && Object.hasOwn(civilization.terms, slot)) {
      value = civilization.terms[slot];
      usesCivilization = true;
    }
    if (override && Object.hasOwn(override, slot)) {
      value = override[slot];
      usesCivilization = true;
    }
    vocabulary.set(slot, {
      value,
      sources: uniqueSources([
        ...policySources,
        ...eraSources,
        ...(usesCivilization ? civilizationSources : []),
      ]),
    });
  }
  return vocabulary;
}
