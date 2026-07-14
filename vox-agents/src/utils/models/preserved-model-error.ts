/**
 * Stores model errors on provider options so middleware and retry layers can share them.
 */

/** Parameters that can carry an error between model layers. */
export interface PreservedModelErrorCarrier {
  providerOptions?: Record<string, unknown>;
}

/** Result of taking a preserved error without losing falsy thrown values. */
export type PreservedModelErrorResult =
  | { found: true; error: unknown }
  | { found: false };

const preservedErrorKey = 'error';

/** Preserve any thrown value for the retry layer. */
export function preserveModelError(params: PreservedModelErrorCarrier, error: unknown): void {
  params.providerOptions ??= {};
  params.providerOptions[preservedErrorKey] = error;
}

/** Take and delete a preserved thrown value, including falsy values. */
export function takePreservedModelError(
  params: PreservedModelErrorCarrier
): PreservedModelErrorResult {
  const providerOptions = params.providerOptions;
  if (!providerOptions || !Object.prototype.hasOwnProperty.call(providerOptions, preservedErrorKey)) {
    return { found: false };
  }

  const error = providerOptions[preservedErrorKey];
  delete providerOptions[preservedErrorKey];
  return { found: true, error };
}
