/** Choose mockup appearance using the same reader as recorded editions. */
import type { IssueDocument } from '../../../src/newspaper/contracts/issue.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { createPreviewIssue, readPreviewDesigns } from '../preview/issue.js';
import { mountTintControls } from './appearance.js';
import { element } from './dom.js';

const fixtureNames = new Set(['victorian-ordinary', 'victorian-breaking', 'victorian-analysis', 'wire-ordinary']);

/** Bind the design, civilization, layout and tint controls, with optional direct fixture links. */
export function mountMockupControls(
  showIssue: (issue: IssueDocument) => void,
  showFixture: (name: string) => Promise<string | undefined>,
): { start: (fixture: string | null) => void; showSample: () => void } {
  const designSelect = element<HTMLSelectElement>('#preview-design');
  const civilizationInput = element<HTMLInputElement>('#preview-civilization');
  const layoutSelect = element<HTMLSelectElement>('#preview-layout');
  const alert = element('#preview-error');
  const designs = new Map(readPreviewDesigns().map(design => [design.id, design]));
  designSelect.replaceChildren(...Array.from(designs.values(), design => new Option(design.label ?? design.title, design.id)));
  const readTint = mountTintControls('preview', showSample);

  /** Keep valid layouts selected when the design changes. */
  function updateLayouts(): void {
    const design = designs.get(designSelect.value);
    civilizationInput.disabled = !design?.civilizationTitles;
    const variants = new Set(design?.layouts.map(layout => layout.variant));
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
      showIssue(createPreviewIssue(design, layout, readTint(), civilizationInput.value));
    } catch (error) {
      showError(errorMessage(error, 'The design preview could not be loaded.'));
    }
  }

  designSelect.addEventListener('change', () => { updateLayouts(); showSample(); });
  civilizationInput.addEventListener('change', showSample);
  layoutSelect.addEventListener('change', showSample);
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
