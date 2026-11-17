import { LibcascadeKernel } from "@browser-step/kernel";
import { createStepRenderer } from "@browser-step/renderer";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Viewer root element was not found.");
}

const heading = document.createElement("h1");
heading.textContent = "STEP Model Viewer";

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".step,.stp";
fileInput.setAttribute("aria-label", "Load a STEP file");

const fitButton = document.createElement("button");
fitButton.type = "button";
fitButton.textContent = "Fit model to view";
fitButton.disabled = true;

const status = document.createElement("p");
status.className = "status";
status.setAttribute("aria-live", "polite");
status.textContent = "Choose a STEP file to display.";

const viewport = document.createElement("div");
viewport.className = "viewport";

app.append(heading, fileInput, fitButton, status, viewport);

const kernel = new LibcascadeKernel();
const renderer = createStepRenderer(viewport);

fitButton.addEventListener("click", renderer.fitToView);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  fileInput.disabled = true;
  status.textContent = `Loading ${file.name}…`;

  try {
    await kernel.loadStep(await file.arrayBuffer());
    renderer.renderMeshes(kernel.getTessellation());
    fitButton.disabled = false;
    status.textContent =
      `${file.name} — ${kernel.getBodyCount()} bodies, ${kernel.getFaceCount()} faces`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The STEP file could not be loaded.";
  } finally {
    fileInput.disabled = false;
    fileInput.value = "";
  }
});
