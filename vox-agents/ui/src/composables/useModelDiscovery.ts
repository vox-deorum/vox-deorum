import { computed, ref } from 'vue';
import { api, ModelDiscoveryError, type ModelDiscoveryErrorKind } from '@/api/client';
import type { DiscoveredModel } from '@/utils/types';
import { apiKeyFields, llmProviders, providerCredentials } from '@/utils/types';

interface UseModelDiscoveryOptions {
  isActive: () => boolean;
}

/** Own provider credentials and the models discovered from the selected provider. */
export function useModelDiscovery({ isActive }: UseModelDiscoveryOptions) {
  const selectedProvider = ref('');
  const enteredCredentials = ref<Record<string, string>>({});
  const discoveredModels = ref<DiscoveredModel[]>([]);
  const recommendedTiers = ref<{ default?: string; small?: string; large?: string }>({});
  const selectedModelId = ref('');
  const discoveryPending = ref(false);
  const discoveryErrorKind = ref<ModelDiscoveryErrorKind | null>(null);
  const discoveryError = ref('');
  let generation = 0;

  /** Find the human-readable label for the selected provider. */
  const selectedProviderLabel = computed(() =>
    llmProviders.find(provider => provider.value === selectedProvider.value)?.label ?? selectedProvider.value
  );

  /** List the credential keys that belong to the selected provider. */
  const credentialKeys = computed(() => {
    const metadata = providerCredentials[selectedProvider.value];
    return [...(metadata?.required ?? []), ...(metadata?.optional ?? [])];
  });

  /** Resolve credential metadata for fields shown by the selected provider. */
  const credentialFields = computed(() =>
    credentialKeys.value
      .map(key => apiKeyFields.find(field => field.key === key))
      .filter((field): field is (typeof apiKeyFields)[number] => field !== undefined)
  );

  /** Find the model currently selected from the discovered list. */
  const selectedModel = computed(() =>
    discoveredModels.value.find(model => model.id === selectedModelId.value) ?? null
  );

  /** Find a discovered model by ID, or null when the ID is missing or unlisted. */
  function findModel(id: string | undefined): DiscoveredModel | null {
    return id ? discoveredModels.value.find(model => model.id === id) ?? null : null;
  }

  /** Find the model recommended for most decisions, when the provider supplies one. */
  const recommendedDefaultModel = computed(() => findModel(recommendedTiers.value.default));

  /** Find the model recommended for routine work, when the provider supplies one. */
  const recommendedSmallModel = computed(() => findModel(recommendedTiers.value.small));

  /** Find the model recommended for high-stakes work, when the provider supplies one. */
  const recommendedLargeModel = computed(() => findModel(recommendedTiers.value.large));

  /** Explain the current discovery error in terms of the selected provider. */
  const discoveryStatusCopy = computed(() => {
    const provider = selectedProviderLabel.value || 'This service';
    switch (discoveryErrorKind.value) {
      case 'auth':
        return `${provider} did not accept those details. Check them and try again.`;
      case 'network':
        return selectedProvider.value === 'openai-compatible'
          ? 'No AI server was found on this PC. Start Ollama or LM Studio, then try again.'
          : `We could not reach ${provider}. Check your connection and try again.`;
      case 'missing-credential':
        return selectedProvider.value === 'openai-compatible'
          ? 'No AI server was found on this PC. Check the address and start Ollama or LM Studio first.'
          : `Add the requested ${provider} details, then try again.`;
      case 'unsupported':
        return `${provider} cannot list models here yet. Go back and choose another service.`;
      case 'provider':
        return `${provider} could not list models right now. Nothing was saved, so it is safe to try again.`;
      default:
        return discoveryError.value;
    }
  });

  /** Replace one credential draft and clear feedback from a previous discovery attempt. */
  function updateCredential(key: string, value: string): void {
    invalidate();
    enteredCredentials.value = { ...enteredCredentials.value, [key]: value };
    clearDiscoveryError();
  }

  /** Clear discovery feedback before another provider or credential attempt. */
  function clearDiscoveryError(): void {
    discoveryErrorKind.value = null;
    discoveryError.value = '';
  }

  /** Build the selected provider's credential payload without unrelated stored keys. */
  function selectedCredentials(): Record<string, string> {
    return Object.fromEntries(credentialKeys.value.map(key => [key, enteredCredentials.value[key] ?? '']));
  }

  /** Return only nonempty credential drafts for the selected provider. */
  function nonEmptySelectedCredentials(): Record<string, string> {
    return Object.fromEntries(
      credentialKeys.value
        .map(key => [key, enteredCredentials.value[key]?.trim() ?? ''] as const)
        .filter(([, value]) => value.length > 0)
    );
  }

  /** Discover, sort, and select models when the active caller still owns this request. */
  async function discover(): Promise<boolean> {
    if (!selectedProvider.value || discoveryPending.value) return false;
    const requestGeneration = generation;
    discoveryPending.value = true;
    clearDiscoveryError();
    try {
      const response = await api.discoverModels(selectedProvider.value, selectedCredentials());
      if (!isActive() || requestGeneration !== generation) return false;
      discoveredModels.value = [...response.models].sort((left, right) => left.id.localeCompare(right.id));
      recommendedTiers.value = response.recommendedTiers ?? {};
      selectedModelId.value = discoveredModels.value.some(model => model.id === recommendedTiers.value.default)
        ? recommendedTiers.value.default ?? ''
        : '';
      return true;
    } catch (error) {
      if (!isActive() || requestGeneration !== generation) return false;
      discoveryError.value = error instanceof Error ? error.message : 'The model list could not be loaded.';
      discoveryErrorKind.value = error instanceof ModelDiscoveryError ? error.kind : 'provider';
      return false;
    } finally {
      if (requestGeneration === generation) discoveryPending.value = false;
    }
  }

  /** Reset all discovery state and start with a private copy of supplied credentials. */
  function reset(credentials: Record<string, string>): void {
    generation += 1;
    selectedProvider.value = '';
    enteredCredentials.value = { ...credentials };
    discoveredModels.value = [];
    recommendedTiers.value = {};
    selectedModelId.value = '';
    discoveryPending.value = false;
    clearDiscoveryError();
  }

  /** Invalidate outstanding discovery requests and clear their pending state. */
  function invalidate(): void {
    generation += 1;
    discoveryPending.value = false;
  }

  return {
    selectedProvider,
    enteredCredentials,
    discoveredModels,
    selectedModelId,
    discoveryPending,
    discoveryErrorKind,
    selectedProviderLabel,
    credentialFields,
    selectedModel,
    recommendedDefaultModel,
    recommendedSmallModel,
    recommendedLargeModel,
    discoveryStatusCopy,
    findModel,
    updateCredential,
    clearDiscoveryError,
    nonEmptySelectedCredentials,
    discover,
    reset,
    invalidate
  };
}
