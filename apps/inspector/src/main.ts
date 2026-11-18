import { ModelSession, SelectionModel, StyleStateModel } from "@browser-step/core";
import { createStepRenderer } from "@browser-step/renderer";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Inspector root element was not found.");
}

const heading = document.createElement("h1");
heading.textContent = "STEP Inspector";

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
status.textContent = "Choose a STEP file to inspect.";

const selectionStatus = document.createElement("p");
selectionStatus.className = "status";
selectionStatus.setAttribute("aria-live", "polite");
selectionStatus.textContent = "0 faces selected";

const viewport = document.createElement("div");
viewport.className = "viewport";

app.append(heading, fileInput, fitButton, status, selectionStatus, viewport);

const session = new ModelSession();
const selection = new SelectionModel();
const style = new StyleStateModel();
const renderer = createStepRenderer(viewport, (faceIndex) => {
  if (faceIndex === undefined) selection.clear();
  else selection.toggle(faceIndex);
});
selection.subscribe((selectedFaceIndices) => {
  renderer.setSelectedFaces(selectedFaceIndices);
  const count = selectedFaceIndices.length;
  selectionStatus.textContent = `${count} face${count === 1 ? "" : "s"} selected`;
});

fitButton.addEventListener("click", renderer.fitToView);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  await loadModel(file.name, () => file.arrayBuffer());
  fileInput.value = "";
});

async function loadModel(name: string, readData: () => Promise<ArrayBuffer>): Promise<void> {
  fileInput.disabled = true;
  status.textContent = `Loading ${name}…`;

  try {
    await session.load(await readData());
    const meshes = session.tessellation;
    selection.clear();
    renderer.renderMeshes(meshes, style.state);
    fitButton.disabled = false;
    status.textContent =
      `${name} — ${session.bodyCount} bodies, ${session.faceCount} faces`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "The STEP file could not be loaded.";
  } finally {
    fileInput.disabled = false;
  }
}
