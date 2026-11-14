import { z } from 'zod';

/**
 * Schema for the ContractsRefreshed event.
 * Triggered when the contract system completes a refresh cycle of all available contracts.
 * This event serves as a notification that the contract refresh process has completed.
 */
export const ContractsRefreshed = z.object({});