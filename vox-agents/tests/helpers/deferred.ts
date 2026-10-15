/**
 * A promise whose completion the test controls, for holding async work at a known point.
 */

/** An unresolved promise and the function that resolves it. */
export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** Create an unresolved promise whose test controls its completion. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
