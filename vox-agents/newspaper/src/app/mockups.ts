/** Choose mockup appearance using the same reader as recorded editions. */
import type { IssueDocument } from '../../../src/newspaper/contracts/issue.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { createPreviewIssue, readPreviewDesigns } from '../preview/issue.js';
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
const fixtureNames = new Set(['victorian-ordinary', 'victorian-breaking', 'victorian-analysis', 'wire-ordinary']);

/** Bind the design, layout and tint pickers, with optional direct fixture links. */
export function mountMockupControls(
  showIssue: (issue: IssueDocument) => void,
  showFixture: (name: string) => Promise<string | undefined>,
): { start: (fixture: string | null) => void; showSample: () => void } {
  const designSelect = element<HTMLSelectElement>('#preview-design');
  const layoutSelect = element<HTMLSelectElement>('#preview-layout');
  const tintSelect = element<HTMLSelectElement>('#preview-tint');
  const customTint = element<HTMLInputElement>('#preview-custom-tint');
  const alert = element('#preview-error');
  const designs = new Map(readPreviewDesigns().map(design => [design.id, design]));
  designSelect.replaceChildren(...Array.from(designs.values(), design => new Option(design.title, design.id)));
  tintSelect.replaceChildren(
    new Option('Design default', ''),
    ...tintSamples.map(([name, color]) => new Option(name, color)),
    new Option('Custom', 'custom'),
  );

  /** Keep valid layouts selected when the design changes. */
  function updateLayouts(): void {
    const variants = new Set(designs.get(designSelect.value)?.layouts.map(layout => layout.variant));
    const previous = layoutSelect.value;
    layoutSelect.replaceChildren(...Array.from(variants, variant =>
      new Option(variant[0].toUpperCase() + variant.slice(1), variant)
    ));
    if (Array.from(layoutSelect.options).some(option => option.value === previous)) layoutSelect.value = previous;
  }

  /** Report a fixture or design error near the corresponding controls. */
  function showError(message: string): void {
    alert.hidden = false;
    alert.textContent = message;
  }

  /** Render a sample with the selected appearance. */
  function showSample(): void {
    alert.hidden = true;
    try {
      const design = designs.get(designSelect.value);
      const layout = design?.layouts.find(option => option.variant === layoutSelect.value)?.variant;
      if (!design || !layout) throw new Error('No built-in newspaper designs were found.');
      const tint = tintSelect.value === 'custom' ? customTint.value : tintSelect.value || undefined;
      showIssue(createPreviewIssue(design, layout, tint));
    } catch (error) {
      showError(errorMessage(error, 'The design preview could not be loaded.'));
    }
  }

  designSelect.addEventListener('change', () => { updateLayouts(); showSample(); });
  layoutSelect.addEventListener('change', showSample);
  tintSelect.addEventListener('change', showSample);
  customTint.addEventListener('change', () => { tintSelect.value = 'custom'; showSample(); });
  updateLayouts();

  return {
    /** Open a linked fixture, or start on the selected mockup. */
    start(fixture): void {
      if (fixture && fixtureNames.has(fixture)) {
        void showFixture(fixture).then(message => { if (message) showError(message); });
      } else {
        showSample();
        if (fixture) showError('This fixture is not available.');
      }
    },
    showSample,
  };
}
