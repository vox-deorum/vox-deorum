/**
 * OpenTelemetry attributes describing host capabilities enabled for one model step.
 */

import type { Attributes } from '@opentelemetry/api';
import type { Model } from '../../types/config.js';
import { isHostCapabilityProvider, resolveHostToolCapabilities } from '../models/providers/host-tools.js';

/** Return queryable host-capability attributes for a supported provider. */
export function hostCapabilityTelemetryAttributes(model: Model): Attributes {
  if (!isHostCapabilityProvider(model.provider)) return {};
  const capabilities = resolveHostToolCapabilities(model.options?.hostTools);
  const enabled = [
    capabilities.read ? 'read' : undefined,
    capabilities.write ? 'write' : undefined,
    capabilities.web ? 'web' : undefined,
  ].filter((capability): capability is string => capability !== undefined);
  return enabled.length > 0 ? { 'host.capability': enabled.join(', ') } : {};
}
