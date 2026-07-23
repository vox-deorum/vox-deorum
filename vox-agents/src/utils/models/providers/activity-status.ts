/** Shared lifecycle classification for provider-executed tool activity. */

export type ProviderActivityStatus = 'preliminary' | 'completed' | 'failed';

/** Classify a raw status string or a structured provider activity result. */
export function classifyProviderActivityStatus(value: unknown): ProviderActivityStatus | undefined {
  const status = typeof value === 'string'
    ? value
    : typeof value === 'object' && value !== null && 'status' in value
      ? value.status
      : undefined;

  if (status === 'pending' || status === 'started' || status === 'in_progress' || status === 'in-progress') {
    return 'preliminary';
  }
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'interrupted') {
    return 'failed';
  }
  return undefined;
}
