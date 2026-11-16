/**
 * Generic utility to pick specific fields from an object
 */
export function pickFields<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  fields: readonly K[]
): Pick<T, K> {
  return fields.reduce((result, field) => {
    if (field in obj) {
      result[field] = obj[field as keyof T] as any;
    }
    return result;
  }, {} as Pick<T, K>);
}

/**
 * Generic utility to omit specific fields from an object
 */
export function omitFields<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  fields: readonly K[]
): Omit<T, K> {
  return Object.entries(obj).reduce((result, [key, value]) => {
    if (!fields.includes(key as K)) {
      (result as any)[key] = value;
    }
    return result;
  }, {} as Omit<T, K>);
}
