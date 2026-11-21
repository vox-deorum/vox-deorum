/** Find a required control in the shared newspaper shell. */
export function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing newspaper control ${selector}.`);
  return found;
}
