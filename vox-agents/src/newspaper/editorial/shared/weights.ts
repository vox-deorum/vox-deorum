/** Choose a positive-weight option using the caller's independent random stream. */
export function chooseWeighted<T>(
  choices: readonly T[],
  weight: (choice: T) => number,
  random: () => number
): T | undefined {
  const available = choices
    .map((choice) => ({ choice, weight: weight(choice) }))
    .filter((entry) => entry.weight > 0);
  const total = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (!total) return undefined;
  let remainder = random() * total;
  for (const entry of available) {
    remainder -= entry.weight;
    if (remainder < 0) return entry.choice;
  }
  return available.at(-1)?.choice;
}
