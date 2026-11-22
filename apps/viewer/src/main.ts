import {
  CommandManager,
  ModelSession,
  SelectionModel,
  StyleStateModel,
  ViewStateModel,
} from "@browser-step/core";
import {
  createStepRenderer,
  type CameraProjection,
  type SelectionScope,
} from "@browser-step/renderer";
import { defaultSample, sampleModels } from "@browser-step/samples";

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

const hideBodiesButton = document.createElement("button");
hideBodiesButton.type = "button";
hideBodiesButton.textContent = "Hide Bodies";
hideBodiesButton.disabled = true;

const projectionSelect = document.createElement("select");
projectionSelect.setAttribute("aria-label", "Camera projection");
for (const projection of ["orthographic", "perspective"] as const) {
  const option = document.createElement("option");
  option.value = projection;
  option.textContent = `${projection[0].toUpperCase()}${projection.slice(1)}`;
  projectionSelect.append(option);
}
projectionSelect.value = "orthographic";

const lightingControl = document.createElement("label");
const lightingToggle = document.createElement("input");
lightingToggle.type = "checkbox";
lightingControl.append(lightingToggle, "Model Shading");

const faceColorControl = document.createElement("label");
const faceColorInput = document.createElement("input");
faceColorInput.type = "color";
faceColorInput.setAttribute("aria-label", "Face color");
faceColorControl.append("Face color", faceColorInput);

const opacityControl = document.createElement("label");
const opacitySlider = document.createElement("input");
opacitySlider.type = "range";
opacitySlider.min = "0";
opacitySlider.max = "1";
opacitySlider.step = "0.01";
opacitySlider.value = "1";
opacitySlider.setAttribute("aria-label", "Model opacity");
const opacityValue = document.createElement("output");
opacityValue.value = "100%";
opacityValue.textContent = opacityValue.value;
opacityControl.append("Model opacity", opacitySlider, opacityValue);

const edgeThicknessControl = document.createElement("label");
edgeThicknessControl.className = "edge-thickness-control";
const edgeThicknessSlider = document.createElement("input");
edgeThicknessSlider.type = "range";
edgeThicknessSlider.min = "0";
edgeThicknessSlider.max = "5";
edgeThicknessSlider.step = "0.1";
edgeThicknessSlider.value = "1";
edgeThicknessSlider.setAttribute("aria-label", "Edge line thickness");
const edgeThicknessValue = document.createElement("output");
edgeThicknessValue.value = "1 px";
edgeThicknessValue.textContent = edgeThicknessValue.value;
edgeThicknessControl.append(
  "Edge line thickness",
  edgeThicknessSlider,
  edgeThicknessValue,
);

const smoothEdgesControl = document.createElement("label");
const smoothEdgesToggle = document.createElement("input");
smoothEdgesToggle.type = "checkbox";
smoothEdgesToggle.checked = true;
smoothEdgesControl.append(smoothEdgesToggle, "Show smooth edges");

const status = document.createElement("p");
status.className = "status";
status.setAttribute("aria-live", "polite");
status.textContent = "Choose a STEP file to display.";

const selectionStatus = document.createElement("p");
selectionStatus.className = "status";
selectionStatus.setAttribute("aria-live", "polite");
selectionStatus.textContent = "0 faces selected";

const selectionScopeControl = document.createElement("fieldset");
const selectionScopeLegend = document.createElement("legend");
selectionScopeLegend.textContent = "Selection Scope";
selectionScopeControl.append(selectionScopeLegend);
for (const scope of ["object", "face"] as const) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "selection-scope";
  input.value = scope;
  input.checked = scope === "object";
  input.setAttribute("aria-label", scope === "object" ? "Body" : "Face");
  label.append(input, scope === "object" ? "Body" : "Face");
  selectionScopeControl.append(label);
}

const viewport = document.createElement("div");
viewport.className = "viewport";

const viewer = document.createElement("section");
viewer.className = "viewer";
viewer.append(heading, status, selectionStatus, viewport);

const controls = document.createElement("section");
controls.className = "controls";
controls.append(
  fileInput,
  sampleSelect,
  selectionScopeControl,
  hideBodiesButton,
  faceColorControl,
  opacityControl,
  edgeThicknessControl,
  projectionSelect,
  lightingControl,
  fitButton,
  smoothEdgesControl,
);

app.append(viewer, controls);

const session = new ModelSession();
const commandManager = new CommandManager();
const selection = new SelectionModel();
const style = new StyleStateModel();
const view = new ViewStateModel();
let selectionScope: SelectionScope = "object";
let bodyFaces = new Map<number, number[]>();
let hiddenBodies = new Set<number>();
let updatingViewFromRenderer = false;
const renderer = createStepRenderer(viewport, (faceIndex, bodyIndex) => {
  if (faceIndex === undefined) {
    selection.clear();
  } else if (selectionScope === "object") {
    selection.toggleAll(bodyFaces.get(bodyIndex ?? faceIndex) ?? [faceIndex]);
  } else {
    selection.toggle(faceIndex);
  }
}, (state) => {
  updatingViewFromRenderer = true;
  try {
    view.setState(state);
  } finally {
    updatingViewFromRenderer = false;
  }
});
view.subscribe((state) => {
  projectionSelect.value = state.projection;
  if (!updatingViewFromRenderer) renderer.setViewState(state);
});
renderer.setViewState(view.state);
style.subscribe((state) => {
  renderer.setStyleState(state);
});
const initialStyle = style.state;
faceColorInput.value = `#${initialStyle.faceColor.toString(16).padStart(6, "0")}`;
opacitySlider.value = String(initialStyle.opacity);
opacityValue.value = `${Math.round(initialStyle.opacity * 100)}%`;
opacityValue.textContent = opacityValue.value;
renderer.setStyleState(initialStyle);
selection.subscribe((selectedFaceIndices) => {
  renderer.setSelectedFaces(selectedFaceIndices);
  const count = selectedFaceIndices.length;
  selectionStatus.textContent = `${count} face${count === 1 ? "" : "s"} selected`;
  updateBodyVisibilityControl();
});

function getSelectedBodyIndices(): number[] {
  const selectedFaces = new Set(selection.selectedFaces);
  return [...bodyFaces]
    .filter(([, faceIndices]) =>
      faceIndices.length > 0 &&
      faceIndices.every((faceIndex) => selectedFaces.has(faceIndex)),
    )
    .map(([bodyIndex]) => bodyIndex);
}

function updateBodyVisibilityControl(): void {
  const selectedBodies = getSelectedBodyIndices();
  const showAllBodies = selectedBodies.length === 0 && hiddenBodies.size > 0;
  hideBodiesButton.textContent = showAllBodies ? "Show All Bodies" : "Hide Bodies";
  hideBodiesButton.disabled = selectedBodies.length === 0 && !showAllBodies;
}

hideBodiesButton.addEventListener("click", () => {
  const selectedBodies = getSelectedBodyIndices();
  if (selectedBodies.length > 0) {
    for (const bodyIndex of selectedBodies) hiddenBodies.add(bodyIndex);
    renderer.setHiddenBodies([...hiddenBodies]);
    selection.clear();
  } else if (hiddenBodies.size > 0) {
    hiddenBodies.clear();
    renderer.setHiddenBodies([]);
  }
  updateBodyVisibilityControl();
});

selectionScopeControl.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  selectionScope = input.value === "object" ? "object" : "face";
  selection.clear();
  renderer.setSelectionScope(selectionScope);
});

fitButton.addEventListener("click", renderer.fitToView);
projectionSelect.addEventListener("change", () => {
  const projection: CameraProjection =
    projectionSelect.value === "perspective" ? "perspective" : "orthographic";
  renderer.setProjection(projection);
});
lightingToggle.addEventListener("change", () => {
  renderer.setShadingMode(lightingToggle.checked ? "original" : "flat");
});
faceColorInput.addEventListener("input", () => {
  const color = Number.parseInt(faceColorInput.value.slice(1), 16);
  const selectedFaces = selection.selectedFaces;
  renderer.setFaceColor(color, selectedFaces);
  if (selectedFaces.length === 0) {
    style.setState({ ...style.state, faceColor: color });
  }
});
opacitySlider.addEventListener("input", () => {
  const opacity = Number(opacitySlider.value);
  const selectedFaces = selection.selectedFaces;
  renderer.setFaceOpacity(opacity, selectedFaces);
  opacityValue.value = `${Math.round(opacity * 100)}%`;
  opacityValue.textContent = opacityValue.value;
  if (selectedFaces.length === 0) {
    style.setState({ ...style.state, opacity });
  }
});
edgeThicknessSlider.addEventListener("input", () => {
  const thickness = Number(edgeThicknessSlider.value);
  renderer.setEdgeThickness(thickness);
  edgeThicknessValue.value = `${thickness} px`;
  edgeThicknessValue.textContent = edgeThicknessValue.value;
});
smoothEdgesToggle.addEventListener("change", () => {
  renderer.setShowSmoothEdges(smoothEdgesToggle.checked);
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
    bodyFaces = new Map();
    for (const mesh of meshes) {
      const bodyIndex = mesh.bodyIndex ?? mesh.faceIndex;
      const faces = bodyFaces.get(bodyIndex) ?? [];
      faces.push(mesh.faceIndex);
      bodyFaces.set(bodyIndex, faces);
    }
    hiddenBodies = new Set();
    updateBodyVisibilityControl();
    renderer.renderMeshes(meshes, style.state);
    fitButton.disabled = false;
    status.textContent =
      `${name} — ${session.bodyCount} bodies, ${session.faceCount} faces`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The STEP file could not be loaded.";
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
