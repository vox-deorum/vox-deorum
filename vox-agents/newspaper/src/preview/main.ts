/** Standalone development page for browsing the built-in newspaper designs. */
import { errorMessage } from "../../../src/utils/errors.js";
import { createReaderState } from "../../../src/newspaper/renderer/state.js";
import { mountReader, type ReaderHandle } from "../reader/mount.js";
import { createPreviewIssue, readPreviewDesigns } from "./issue.js";

const designSelect = document.querySelector<HTMLSelectElement>("#preview-design")!;
const layoutSelect = document.querySelector<HTMLSelectElement>("#preview-layout")!;
const root = document.querySelector<HTMLElement>("#preview-reader")!;
const alert = document.querySelector<HTMLElement>("#preview-error")!;
let reader: ReaderHandle | undefined;

/** Show a problem with the current sample above the reader. */
function showError(error: unknown): void {
  alert.textContent = errorMessage(error, "The design preview could not be loaded.");
  alert.hidden = false;
}

/** Leave game destinations inert while tabs and votes work within the preview. */
function ignoreReaderAction(): void {}

/** Populate the selectors and mount the chosen sample in the real reader. */
function startPreview(): void {
  const designs = new Map(readPreviewDesigns().map(design => [design.id, design]));
  if (!designs.size) throw new Error("No built-in newspaper designs were found.");
  designSelect.replaceChildren(...Array.from(designs.values(), design => new Option(design.title, design.id)));

  /** Refresh the layout choices after a design change, keeping the selected layout when available. */
  function updateLayouts(): void {
    const design = designs.get(designSelect.value)!;
    const variants = new Set(design.layouts.map(layout => layout.variant));
    const previous = layoutSelect.value;
    layoutSelect.replaceChildren(...Array.from(variants, variant =>
      new Option(variant[0].toUpperCase() + variant.slice(1), variant)
    ));
    if (Array.from(layoutSelect.options).some(option => option.value === previous)) layoutSelect.value = previous;
    render();
  }

  /** Mount a fresh sample when either selection changes. */
  function render(): void {
    reader?.dispose();
    reader = undefined;
    alert.hidden = true;
    try {
      const design = designs.get(designSelect.value)!;
      const layout = design.layouts.find(option => option.variant === layoutSelect.value)!.variant;
      const issue = createPreviewIssue(design, layout);
      const nextReader = mountReader(root, issue, createReaderState(issue), ignoreReaderAction);
      reader = nextReader;
      void nextReader.ready.catch(error => {
        if (reader === nextReader) showError(error);
      });
    } catch (error) {
      showError(error);
    }
  }

  designSelect.addEventListener("change", updateLayouts);
  layoutSelect.addEventListener("change", render);
  updateLayouts();
}

try {
  startPreview();
} catch (error) {
  showError(error);
}
