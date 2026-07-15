/**
 * Shared fixtures for the deal-board component tests (CentralOffer / InventoryPanel): a typed
 * tradable-range builder, the PrimeVue control stubs, and a sample promise target. Typing `range()`
 * as `NormalizedSideRange` lets the catalog/offer props consume it without `as never` casts.
 */
import type { NormalizedSideRange, PromiseTargetInfo } from '@/utils/types';

/** A fully-legal tradable-range fixture; pass `over` to mark specific candidates illegal/absent. */
export const range = (over: Partial<NormalizedSideRange> = {}): NormalizedSideRange => ({
  netGoldPerTurn: 42,
  gold: { available: true, max: 500, reasons: [] },
  goldPerTurn: { available: true, reasons: [] },
  maps: { legal: true, reasons: [] },
  openBorders: { legal: true, reasons: [] },
  defensivePact: { legal: true, reasons: [] },
  researchAgreement: { legal: true, reasons: [] },
  peaceTreaty: { legal: true, reasons: [] },
  allowEmbassy: { legal: true, reasons: [] },
  declarationOfFriendship: { legal: true, reasons: [] },
  vassalage: { legal: true, reasons: [] },
  vassalageRevoke: { legal: true, reasons: [] },
  resources: [],
  cities: [],
  techs: [],
  thirdPartyPeace: [],
  thirdPartyWar: [],
  voteCommitments: [],
  ...over,
});

/** A major-civ promise target (Carthage) eligible for a cooperative-war pledge. */
export const carthageTarget: PromiseTargetInfo = {
  playerID: 3, teamID: 3, name: 'Carthage', kind: 'major', coopWarEligible: true,
};

/** PrimeVue control stubs so remove / amount / message inputs are drivable in jsdom. */
export const dealStubs = {
  Button: {
    props: ['label', 'icon', 'disabled', 'loading', 'severity'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
  InputNumber: {
    // `size` is declared (though unused) so PrimeVue's `size="small"` is consumed as a prop rather
    // than falling through onto the native <input>, whose `size` attribute jsdom rejects as non-numeric.
    // `min`/`max` are surfaced as attributes so the per-row editor caps (Gold treasury, GPT income,
    // resource quantity) are assertable in jsdom.
    props: ['modelValue', 'disabled', 'size', 'min', 'max'],
    emits: ['update:modelValue'],
    template: '<input class="number-stub" :disabled="disabled" :min="min" :max="max" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  InputText: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<input class="text-stub" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};
