/** Change a recorded edition's appearance using the built-in preview designs. */
import { newspaperLayoutVariants, type IssueDocument } from '../../../src/newspaper/contracts/issue.js';
import { readPreviewDesigns } from '../preview/issue.js';
import { element } from './dom.js';

const tintSamples = [
  ['Purple', '#6d2c91'],
  ['Crimson', '#b22222'],
  ['Forest', '#1f6f3a'],
  ['Gold', '#e0b31e'],
  ['Teal', '#127a8a'],
  ['Orange', '#f08c1e'],
  ['Charcoal', '#2b2b2b'],
  ['Pale', '#e8e8e8'],
] as const;

/** Bind the shared tint options and read the selected accent override. */
export function mountTintControls(prefix: 'preview' | 'recorded', onChange: () => void) {
  const tintSelect = element<HTMLSelectElement>(`#${prefix}-tint`);
  const customTint = element<HTMLInputElement>(`#${prefix}-custom-tint`);
  tintSelect.replaceChildren(
    new Option('Design default', ''),
    ...tintSamples.map(([name, color]) => new Option(name, color)),
    new Option('Custom', 'custom'),
  );
  tintSelect.addEventListener('change', onChange);
  customTint.addEventListener('change', () => { tintSelect.value = 'custom'; onChange(); });

  /** Use the design's accent when the default is selected. */
  return function readTint(): string | undefined {
    return tintSelect.value === 'custom' ? customTint.value : tintSelect.value || undefined;
  };
}

/** Bind Recorded appearance controls and build a display copy of a saved issue. */
export function mountRecordedAppearance(onChange: () => void) {
  const designSelect = element<HTMLSelectElement>('#recorded-design');
  const layoutSelect = element<HTMLSelectElement>('#recorded-layout');
  const designs = new Map(readPreviewDesigns().map(design => [design.id, design]));
  designSelect.replaceChildren(
    new Option('As published', ''),
    ...Array.from(designs.values(), design => new Option(design.label ?? design.title, design.id)),
  );
  layoutSelect.replaceChildren(
    new Option('As published', ''),
    ...newspaperLayoutVariants.map(variant => new Option(variant[0].toUpperCase() + variant.slice(1), variant)),
  );
  const breakingOption = layoutSelect.querySelector<HTMLOptionElement>('option[value="breaking"]')!;
  const readTint = mountTintControls('recorded', onChange);
  designSelect.addEventListener('change', onChange);
  layoutSelect.addEventListener('change', onChange);

  /** Override the visual design, front page layout and accent while retaining the published copy. */
  return function styleIssue(issue: IssueDocument): IssueDocument {
    const front = issue.pages[0];
    breakingOption.disabled = !front.hasLead;
    if (breakingOption.disabled && layoutSelect.value === 'breaking') layoutSelect.value = '';
    const design = designs.get(designSelect.value);
    const layout = newspaperLayoutVariants.find(variant => variant === layoutSelect.value);
    const tint = readTint();
    const publication = design ? {
      ...issue.publication,
      designId: design.id,
      designVersion: design.version,
      presentation: design.presentation,
    } : issue.publication;

    return {
      ...issue,
      publication: tint ? {
        ...publication,
        presentation: {
          ...publication.presentation,
          tokens: { ...publication.presentation.tokens, accentColor: tint },
        },
      } : publication,
      pages: layout ? [{ ...front, layout }, ...issue.pages.slice(1)] : issue.pages,
    };
  };
}
