import { ModelSession, SelectionModel, StyleStateModel } from "@browser-step/core";
import {
  createStepRenderer,
  type OrbitMode,
  type SelectionScope,
} from "@browser-step/renderer";
import { defaultSample, sampleModels } from "@browser-step/samples";

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

const sampleSelect = document.createElement("select");
sampleSelect.setAttribute("aria-label", "Sample model");
const samplePlaceholder = document.createElement("option");
samplePlaceholder.value = "";
samplePlaceholder.textContent = "Select a sample model…";
sampleSelect.append(samplePlaceholder);
for (const sample of sampleModels) {
  const option = document.createElement("option");
  option.value = sample.name;
  option.textContent = sample.name;
  sampleSelect.append(option);
}

const fitButton = document.createElement("button");
fitButton.type = "button";
fitButton.textContent = "Fit model to view";
fitButton.disabled = true;

const orbitModeControl = document.createElement("label");
const freeOrbitToggle = document.createElement("input");
freeOrbitToggle.type = "checkbox";
freeOrbitToggle.setAttribute("aria-label", "Free orbit controls");
orbitModeControl.append(freeOrbitToggle, "Free Orbit");

const status = document.createElement("p");
status.className = "status";
status.setAttribute("aria-live", "polite");
status.textContent = "Choose a STEP file to inspect.";

const selectionStatus = document.createElement("p");
selectionStatus.className = "status";
selectionStatus.setAttribute("aria-live", "polite");
selectionStatus.textContent = "0 faces selected";

const selectionScopeControl = document.createElement("fieldset");
const selectionScopeLegend = document.createElement("legend");
selectionScopeLegend.textContent = "Selection Scope";
selectionScopeControl.append(selectionScopeLegend);
for (const scope of ["object", "face", "edge"] as const) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "selection-scope";
  input.value = scope;
  input.checked = scope === "face";
  input.setAttribute("aria-label", scope === "object" ? "Object" : scope === "face" ? "Face" : "Edge");
  label.append(input, scope === "object" ? "Object" : scope === "face" ? "Face" : "Edge");
  selectionScopeControl.append(label);
}

const viewport = document.createElement("div");
viewport.className = "viewport";

app.append(
  heading,
  fileInput,
  sampleSelect,
  fitButton,
  orbitModeControl,
  status,
  selectionStatus,
  selectionScopeControl,
  viewport,
);

const session = new ModelSession();
const selection = new SelectionModel();
const style = new StyleStateModel();
let selectionScope: SelectionScope = "face";
const selectedEdgeIndices = new Set<number>();
let bodyFaces = new Map<number, number[]>();
const renderer = createStepRenderer(viewport, (faceIndex, bodyIndex, edgeIndex) => {
  if (selectionScope === "edge") {
    if (edgeIndex === undefined) {
      clearSelection();
      return;
    } else if (selectedEdgeIndices.has(edgeIndex)) {
      selectedEdgeIndices.delete(edgeIndex);
    } else {
      selectedEdgeIndices.add(edgeIndex);
    }
    renderer.setSelectedEdges([...selectedEdgeIndices]);
    updateSelectionStatus();
    return;
  }

  if (faceIndex === undefined) {
    clearSelection();
  } else if (selectionScope === "object") {
    selection.toggleAll(bodyFaces.get(bodyIndex ?? faceIndex) ?? [faceIndex]);
  } else {
    selection.toggle(faceIndex);
  }
});
selection.subscribe((selectedFaceIndices) => {
  renderer.setSelectedFaces(selectedFaceIndices);
  updateSelectionStatus();
});

function updateSelectionStatus(): void {
  const faceCount = selection.selectedFaces.length;
  const edgeCount = selectedEdgeIndices.size;
  if ((selectionScope === "edge" && faceCount > 0) ||
      (selectionScope !== "edge" && edgeCount > 0)) {
    selectionStatus.textContent = `${faceCount} face${faceCount === 1 ? "" : "s"}, ${edgeCount} edge${edgeCount === 1 ? "" : "s"} selected`;
    return;
  }
  if (selectionScope === "edge") {
    const count = edgeCount;
    selectionStatus.textContent = `${count} edge${count === 1 ? "" : "s"} selected`;
  } else {
    const count = faceCount;
    selectionStatus.textContent = `${count} face${count === 1 ? "" : "s"} selected`;
  }
}

function clearSelection(): void {
  selectedEdgeIndices.clear();
  renderer.setSelectedEdges([]);
  selection.clear();
  updateSelectionStatus();
}

selectionScopeControl.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  selectionScope = input.value === "object"
    ? "object"
    : input.value === "edge" ? "edge" : "face";
  renderer.setSelectionScope(selectionScope);
  updateSelectionStatus();
});

fitButton.addEventListener("click", renderer.fitToView);
freeOrbitToggle.addEventListener("change", () => {
  const mode: OrbitMode = freeOrbitToggle.checked ? "free" : "constrained";
  renderer.setOrbitMode(mode);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  sampleSelect.value = "";
  await loadModel(file.name, () => file.arrayBuffer());
  fileInput.value = "";
});

sampleSelect.addEventListener("change", () => {
  const sample = sampleModels.find(({ name }) => name === sampleSelect.value);
  if (sample) void loadSampleModel(sample.name);
});

async function loadModel(name: string, readData: () => Promise<ArrayBuffer>): Promise<void> {
  fileInput.disabled = true;
  sampleSelect.disabled = true;
  status.textContent = `Loading ${name}…`;

  try {
    await session.load(await readData());
    const meshes = session.tessellation;
    selection.clear();
    selectedEdgeIndices.clear();
    renderer.setSelectedEdges([]);
    updateSelectionStatus();
    bodyFaces = new Map();
    for (const mesh of meshes) {
      const bodyIndex = mesh.bodyIndex ?? mesh.faceIndex;
      const faces = bodyFaces.get(bodyIndex) ?? [];
      faces.push(mesh.faceIndex);
      bodyFaces.set(bodyIndex, faces);
    }
    renderer.renderMeshes(meshes, style.state);
    fitButton.disabled = false;
    status.textContent =
      `${name} — ${session.bodyCount} bodies, ${session.faceCount} faces`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "The STEP file could not be loaded.";
  } finally {
    fileInput.disabled = false;
    sampleSelect.disabled = false;
  }
}

async function loadSampleModel(name: string): Promise<void> {
  const sample = sampleModels.find((model) => model.name === name);
  if (!sample) return;

  await loadModel(sample.name, async () => {
    const response = await fetch(sample.url);
    if (!response.ok) {
      throw new Error(`The sample model ${sample.name} could not be loaded.`);
    }
    return response.arrayBuffer();
  });
}

if (defaultSample) {
  sampleSelect.value = defaultSample.name;
  void loadSampleModel(defaultSample.name);
}
